import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CURSOR_DIR,
  CURSOR_CHATS_DIR,
  CURSOR_PLANS_DIR,
  CURSOR_PROJECTS_DIR,
  CURSOR_GLOBAL_STATE_DB,
  CURSOR_WORKSPACE_STORAGE_DIR,
} from "../../config.js";
import {
  directoryExists,
  fileExists,
  getFileSize,
  safeReadJson,
  walkDirectoryAbsolute,
  readLines,
} from "../../utils/fs-helpers.js";
import {
  hasSqliteCli,
  sqliteQuery,
  sqliteCreateFiltered,
  getSqliteInstallInstructions,
} from "../../utils/sqlite.js";
import type {
  AgentProvider,
  DiscoveredSession,
  ProjectContext,
} from "../types.js";

interface CursorSessionMeta {
  agentId: string;
  name?: string;
  mode?: string;
  createdAt?: number;
  lastUsedModel?: string;
}

interface PlanRegistryEntry {
  id: string;
  name: string;
  uri: { path: string; scheme: string };
  createdBy?: string;
  editedBy?: string[];
}

interface DiscoveredPlan {
  id: string | null;
  name: string | null;
  filePath: string;
  discoveredVia: "blob-content-scan" | "registry";
  createdByComposerId?: string;
  registryUri?: string;
  referencedInStoreDb?: string;
}

export interface CursorInstallConfig {
  workspaceStorageDir: string;
  globalStateDb: string;
  /** Display name suffix, e.g. "Brixy" for Cursor-Brixy. null for the main install. */
  nameSuffix: string | null;
}

/**
 * Detect all Cursor installations by scanning the filesystem.
 *
 * Two locations are checked:
 *
 * 1. Platform app support dir (e.g. ~/Library/Application Support/Cursor*) — catches
 *    standard installs and named variants like Cursor-Brixy that live there.
 *
 * 2. Home directory top-level — catches installs launched with a custom
 *    --user-data-dir pointing to a home-dir folder whose name contains "cursor"
 *    (e.g. ~/cursor-work-profile).  Only directories that have the expected
 *    User/workspaceStorage structure are included, to avoid false positives.
 */
export async function detectCursorInstalls(): Promise<CursorInstallConfig[]> {
  const home = os.homedir();
  const seen = new Map<string, CursorInstallConfig>(); // keyed by workspaceStorageDir

  // --- Location 1: platform app support dir ---
  const appSupportDir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? path.join(
            process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
          )
        : path.join(home, ".config");

  await addInstallsFromDir(appSupportDir, seen, (name) => {
    if (!name.startsWith("Cursor")) return null; // skip non-Cursor
    const suffix = name.replace(/^Cursor-?/, "");
    return { include: true, nameSuffix: suffix || null };
  });

  // --- Location 2: home directory top-level ---
  await addInstallsFromDir(home, seen, (name) => {
    // Only include dirs whose name contains "cursor" (case-insensitive)
    if (!name.toLowerCase().includes("cursor")) return null;
    // Strip any "cursor" prefix/component to derive a suffix, e.g.
    // "cursor-work-profile" → "work-profile", ".cursor-brixy" → "brixy"
    const stripped = name.replace(/^\.?cursor-?/i, "");
    return { include: true, nameSuffix: stripped || null };
  });

  return [...seen.values()];
}

/**
 * Scan one directory level of `baseDir`, calling `classify` on each entry name.
 * Returns `{ include: true, nameSuffix }` to add the entry as a Cursor install,
 * or `null` to skip it.
 * Adds valid installs to `seen` (keyed by workspaceStorageDir to deduplicate).
 */
async function addInstallsFromDir(
  baseDir: string,
  seen: Map<string, CursorInstallConfig>,
  classify: (name: string) => { include: boolean; nameSuffix: string | null } | null,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const result = classify(entry.name);
    if (!result?.include) continue;

    const appDataDir = path.join(baseDir, entry.name);
    const workspaceStorageDir = path.join(appDataDir, "User", "workspaceStorage");
    const globalStateDb = path.join(appDataDir, "User", "globalStorage", "state.vscdb");

    if (seen.has(workspaceStorageDir)) continue;
    if (!(await directoryExists(workspaceStorageDir))) continue;

    seen.set(workspaceStorageDir, {
      workspaceStorageDir,
      globalStateDb,
      nameSuffix: result.nameSuffix,
    });
  }
}

export class CursorProvider implements AgentProvider {
  readonly name: string;
  readonly slug: string;

  private readonly _workspaceStorageDir: string;
  private readonly _globalStateDb: string;

  constructor(install?: CursorInstallConfig) {
    if (install?.nameSuffix) {
      this.name = `Cursor (${install.nameSuffix})`;
      this.slug = `cursor-${install.nameSuffix.toLowerCase()}`;
    } else {
      this.name = "Cursor";
      this.slug = "cursor";
    }
    this._workspaceStorageDir = install?.workspaceStorageDir ?? CURSOR_WORKSPACE_STORAGE_DIR;
    this._globalStateDb = install?.globalStateDb ?? CURSOR_GLOBAL_STATE_DB;
  }

  /** Matched chat directories (~/.cursor/chats/<hash>/) */
  private chatDirs: string[] = [];
  /** Project slug for ~/.cursor/projects/<slug>/ */
  private projectSlugs: string[] = [];
  /** All provider files (cached after first call) */
  private _providerFiles: string[] | null = null;
  /** Discovered session store.db paths keyed by sessionId */
  private sessionDbPaths = new Map<string, string>();
  /** Whether sqlite3 CLI is available */
  private sqliteAvailable = false;
  /** Matched workspace storage directory */
  private workspaceStorageDir: string | null = null;
  /** Path to the matched workspace.json */
  private workspaceJsonPath: string | null = null;
  /** Cached workspace composerIds */
  private workspaceComposerIds: Set<string> | null = null;
  /** Temp file path for filtered state.vscdb */
  private stateExtractPath: string | null = null;
  /** Discovered plans with metadata for the manifest */
  private discoveredPlans: DiscoveredPlan[] = [];
  /** The project path used for discovery */
  private projectPath: string | null = null;

  async detect(): Promise<boolean> {
    const hasChats = await directoryExists(CURSOR_CHATS_DIR);
    const hasWorkspaceStorage = await directoryExists(this._workspaceStorageDir);

    if (!hasChats && !hasWorkspaceStorage) return false;

    const hasCli = await hasSqliteCli();
    if (!hasCli) {
      // Try node:sqlite as fallback
      // For now, we just require the CLI
      console.warn(
        `\n⚠ Cursor sessions found but sqlite3 is not installed.\n${getSqliteInstallInstructions()}\n`,
      );
      return false;
    }

    this.sqliteAvailable = true;
    return true;
  }

  getArchiveRoot(): string {
    return CURSOR_DIR;
  }

  async discoverProjects(): Promise<Map<string, number>> {
    const projects = new Map<string, number>();

    try {
      // Step 1: Scan workspace.json files → build hashToPath AND collect workspace dirs
      const hashToPath = new Map<string, string>();
      const workspaceDirs: Array<{ folderPath: string; wsDir: string }> = [];

      if (await directoryExists(this._workspaceStorageDir)) {
        let wsEntries: import("node:fs").Dirent[];
        try {
          wsEntries = await fs.readdir(this._workspaceStorageDir, {
            withFileTypes: true,
          });
        } catch {
          wsEntries = [];
        }

        for (const wsEntry of wsEntries) {
          if (!wsEntry.isDirectory()) continue;
          const wsJsonPath = path.join(
            this._workspaceStorageDir,
            wsEntry.name,
            "workspace.json",
          );
          const wsJson = await safeReadJson<{ folder?: string }>(wsJsonPath);
          if (!wsJson?.folder) continue;

          // folder is "file:///absolute/path"
          let folderPath: string;
          try {
            folderPath = new URL(wsJson.folder).pathname;
          } catch {
            continue;
          }
          if (!folderPath) continue;

          const hash = md5Hash(folderPath);
          hashToPath.set(hash, folderPath);
          workspaceDirs.push({
            folderPath,
            wsDir: path.join(this._workspaceStorageDir, wsEntry.name),
          });
        }
      }

      // Step 2: List chat directories and match against the hash map
      let chatEntries: import("node:fs").Dirent[] = [];
      if (await directoryExists(CURSOR_CHATS_DIR)) {
        try {
          chatEntries = await fs.readdir(CURSOR_CHATS_DIR, {
            withFileTypes: true,
          });
        } catch {
          chatEntries = [];
        }

        for (const chatEntry of chatEntries) {
          if (!chatEntry.isDirectory()) continue;

          const projectPath = hashToPath.get(chatEntry.name);
          if (!projectPath) continue;

          // Count session subdirectories (each contains a store.db)
          const chatDir = path.join(CURSOR_CHATS_DIR, chatEntry.name);
          let sessionCount = 0;
          try {
            const sessionEntries = await fs.readdir(chatDir, {
              withFileTypes: true,
            });
            for (const se of sessionEntries) {
              if (!se.isDirectory()) continue;
              const dbPath = path.join(chatDir, se.name, "store.db");
              if (await fileExists(dbPath)) {
                sessionCount++;
              }
            }
          } catch {
            continue;
          }

          if (sessionCount > 0) {
            projects.set(
              projectPath,
              (projects.get(projectPath) ?? 0) + sessionCount,
            );
          }
        }
      }

      // Step 2b: Recover orphaned chat dirs (no matching workspace.json)
      // by reading workspace path from store.db blobs
      if (this.sqliteAvailable) {
        for (const chatEntry of chatEntries) {
          if (!chatEntry.isDirectory()) continue;
          if (hashToPath.has(chatEntry.name)) continue; // Already matched

          const chatDir = path.join(CURSOR_CHATS_DIR, chatEntry.name);
          let sessionEntries: import("node:fs").Dirent[];
          try {
            sessionEntries = await fs.readdir(chatDir, { withFileTypes: true });
          } catch {
            continue;
          }

          let recoveredPath: string | null = null;
          let sessionCount = 0;
          for (const se of sessionEntries) {
            if (!se.isDirectory()) continue;
            const dbPath = path.join(chatDir, se.name, "store.db");
            if (!(await fileExists(dbPath))) continue;
            sessionCount++;

            if (!recoveredPath) {
              try {
                const result = await sqliteQuery(
                  dbPath,
                  `SELECT cast(data as text) FROM blobs WHERE cast(data as text) LIKE '%Workspace Path:%' LIMIT 1;`,
                );
                const match = result.match(/Workspace Path:\s*(.+?)[\n"]/);
                if (match?.[1]) {
                  const candidate = match[1].trim();
                  if (await directoryExists(candidate)) {
                    recoveredPath = candidate;
                  }
                }
              } catch {
                /* skip */
              }
            }
          }

          if (recoveredPath && sessionCount > 0) {
            projects.set(
              recoveredPath,
              (projects.get(recoveredPath) ?? 0) + sessionCount,
            );
          }
        }
      }

      // Step 3: Count Composer sessions from workspace state.vscdb
      // Catches projects where the user used Cursor Composer but no
      // chat sessions exist in ~/.cursor/chats/
      if (this.sqliteAvailable) {
        for (const { folderPath, wsDir } of workspaceDirs) {
          if (projects.has(folderPath)) continue;

          const stateDbPath = path.join(wsDir, "state.vscdb");
          if (!(await fileExists(stateDbPath))) continue;

          try {
            const raw = await sqliteQuery(
              stateDbPath,
              "SELECT value FROM ItemTable WHERE key='composer.composerData';",
            );
            const trimmed = raw.trim();
            if (!trimmed) continue;

            const data = JSON.parse(trimmed) as {
              allComposers?: Array<unknown>;
            };
            const count = data.allComposers?.length ?? 0;
            if (count > 0) {
              projects.set(
                folderPath,
                (projects.get(folderPath) ?? 0) + count,
              );
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Never throw
    }

    return projects;
  }

  async findSessions(context: ProjectContext): Promise<DiscoveredSession[]> {
    this.projectPath = context.projectPath;
    const seenIds = new Set<string>();
    const sessions: DiscoveredSession[] = [];

    // Strategy A: MD5 hash lookup (fast)
    for (const projectPath of context.allWorktreePaths) {
      const hash = md5Hash(projectPath);
      const chatDir = path.join(CURSOR_CHATS_DIR, hash);

      if (await directoryExists(chatDir)) {
        if (!this.chatDirs.includes(chatDir)) {
          this.chatDirs.push(chatDir);
        }
        this.addProjectSlug(projectPath);

        const found = await this.scanChatDir(chatDir);
        for (const s of found) {
          if (!seenIds.has(s.sessionId)) {
            seenIds.add(s.sessionId);
            sessions.push(s);
          }
        }
      }
    }

    // Strategy B: Blob content scan (catches moved/renamed projects)
    if (sessions.length === 0) {
      const found = await this.scanAllChatDirsForPath(
        context.projectPath,
      );
      for (const s of found) {
        if (!seenIds.has(s.sessionId)) {
          seenIds.add(s.sessionId);
          sessions.push(s);
        }
      }
    }

    // Find workspace storage directory (for plan registry + state extraction)
    await this.findWorkspaceStorageDir(context.projectPath);

    // Strategy C: Discover Composer sessions from workspace state.vscdb
    const composerSessions = await this.findComposerSessions(seenIds);
    sessions.push(...composerSessions);

    return sessions;
  }

  async getSessionFiles(_session: DiscoveredSession): Promise<string[]> {
    // All files returned via getProviderFiles()
    return [];
  }

  async getProviderFiles(): Promise<string[]> {
    if (this._providerFiles) return this._providerFiles;

    const files: string[] = [];

    // 1. store.db files for discovered sessions
    for (const dbPath of this.sessionDbPaths.values()) {
      files.push(dbPath);
    }

    // 2. Project-level files (transcripts, terminals)
    for (const slug of this.projectSlugs) {
      const projectDir = path.join(CURSOR_PROJECTS_DIR, slug);
      if (!(await directoryExists(projectDir))) continue;

      // Agent transcripts
      const transcriptsDir = path.join(projectDir, "agent-transcripts");
      if (await directoryExists(transcriptsDir)) {
        const transcriptFiles = await walkDirectoryAbsolute(transcriptsDir);
        files.push(...transcriptFiles);
      }

      // Terminal logs
      const terminalsDir = path.join(projectDir, "terminals");
      if (await directoryExists(terminalsDir)) {
        const terminalFiles = await walkDirectoryAbsolute(terminalsDir);
        files.push(...terminalFiles);
      }
    }

    // 3. Referenced plan files (blob scan + registry)
    const planFiles = await this.discoverReferencedPlanFiles(files);
    files.push(...planFiles);

    // 4. Filtered state.vscdb extract (outside archive root → sessions/cursor/)
    const extractPath = await this.createStateExtract();
    if (extractPath) {
      files.push(extractPath);
    }

    // 5. Workspace.json (outside archive root → sessions/cursor/)
    if (this.workspaceJsonPath && (await fileExists(this.workspaceJsonPath))) {
      files.push(this.workspaceJsonPath);
    }

    this._providerFiles = files;
    return this._providerFiles;
  }

  async getVirtualFiles(): Promise<
    Array<{ relativePath: string; content: string }>
  > {
    const virtualFiles: Array<{ relativePath: string; content: string }> = [];

    // 1. Generate decoded sessions-summary.json
    const summaries: Record<string, CursorSessionMeta> = {};
    for (const [sessionId, dbPath] of this.sessionDbPaths) {
      const meta = await this.readSessionMeta(dbPath);
      if (meta) {
        summaries[sessionId] = meta;
      }
    }
    if (Object.keys(summaries).length > 0) {
      virtualFiles.push({
        relativePath: "sessions-summary.json",
        content: JSON.stringify(summaries, null, 2),
      });
    }

    // 2. Generate discovery-manifest.json
    const manifest = this.buildDiscoveryManifest();
    virtualFiles.push({
      relativePath: "discovery-manifest.json",
      content: JSON.stringify(manifest, null, 2),
    });

    return virtualFiles;
  }

  // --- Internal methods ---

  private addProjectSlug(projectPath: string): void {
    const slug = projectPathToSlug(projectPath);
    if (!this.projectSlugs.includes(slug)) {
      this.projectSlugs.push(slug);
    }
  }

  /**
   * Scan a chat directory for session store.db files and extract metadata.
   */
  private async scanChatDir(chatDir: string): Promise<DiscoveredSession[]> {
    let entries;
    try {
      entries = await fs.readdir(chatDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const sessions: DiscoveredSession[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dbPath = path.join(chatDir, entry.name, "store.db");
      if (!(await fileExists(dbPath))) continue;

      const meta = await this.readSessionMeta(dbPath);
      if (!meta) continue;

      const sessionId = meta.agentId ?? entry.name;
      this.sessionDbPaths.set(sessionId, dbPath);

      const stat = await fs.stat(dbPath).catch(() => null);
      const sizeBytes = stat?.size ?? 0;
      const modified = stat?.mtime?.toISOString() ?? null;

      // Try to extract firstPrompt and messageCount from blobs
      const { firstPrompt, messageCount } =
        await this.extractUserBlobInfo(dbPath);

      sessions.push({
        agentName: this.name,
        sessionId,
        summary: meta.name && meta.name !== "New Agent" ? meta.name : null,
        firstPrompt,
        messageCount,
        created: meta.createdAt
          ? new Date(meta.createdAt).toISOString()
          : null,
        modified,
        sizeBytes,
      });
    }

    return sessions;
  }

  /**
   * Read and decode the hex-encoded meta row from a store.db.
   * The value column already contains hex-encoded JSON text.
   */
  private async readSessionMeta(
    dbPath: string,
  ): Promise<CursorSessionMeta | null> {
    if (!this.sqliteAvailable) return null;

    try {
      const raw = await sqliteQuery(
        dbPath,
        "SELECT value FROM meta WHERE key='0';",
      );
      const hexStr = raw.trim();
      if (!hexStr) return null;

      const json = Buffer.from(hexStr, "hex").toString("utf-8");
      return JSON.parse(json) as CursorSessionMeta;
    } catch {
      return null;
    }
  }

  /**
   * Extract first user prompt and message count from JSON blobs.
   */
  private async extractUserBlobInfo(
    dbPath: string,
  ): Promise<{ firstPrompt: string | null; messageCount: number | null }> {
    if (!this.sqliteAvailable) {
      return { firstPrompt: null, messageCount: null };
    }

    try {
      // Count user message blobs
      const countRaw = await sqliteQuery(
        dbPath,
        `SELECT count(*) FROM blobs WHERE cast(data as text) LIKE '%"role":"user"%';`,
      );
      const messageCount = parseInt(countRaw.trim(), 10) || null;

      // Get first user prompt text — check a few user blobs
      const promptRaw = await sqliteQuery(
        dbPath,
        `SELECT cast(data as text) FROM blobs WHERE cast(data as text) LIKE '%"role":"user"%' LIMIT 5;`,
      );

      let firstPrompt: string | null = null;
      // sqlite3 returns one result per line
      for (const line of promptRaw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const blob = JSON.parse(trimmed);
          const text = extractUserText(blob);
          if (text) {
            firstPrompt = text.slice(0, 200);
            break;
          }
        } catch {
          // Non-JSON blob, skip
        }
      }

      return { firstPrompt, messageCount };
    } catch {
      return { firstPrompt: null, messageCount: null };
    }
  }

  /**
   * Strategy B: Scan all chat directories for blobs containing the project path.
   */
  private async scanAllChatDirsForPath(
    projectPath: string,
  ): Promise<DiscoveredSession[]> {
    if (!this.sqliteAvailable) return [];

    let chatDirEntries;
    try {
      chatDirEntries = await fs.readdir(CURSOR_CHATS_DIR, {
        withFileTypes: true,
      });
    } catch {
      return [];
    }

    const allSessions: DiscoveredSession[] = [];

    for (const dirEntry of chatDirEntries) {
      if (!dirEntry.isDirectory()) continue;

      const chatDir = path.join(CURSOR_CHATS_DIR, dirEntry.name);
      // Skip already-discovered directories
      if (this.chatDirs.includes(chatDir)) continue;

      // Pick one store.db to check for workspace path match
      const matched = await this.chatDirMatchesPath(chatDir, projectPath);
      if (!matched) continue;

      this.chatDirs.push(chatDir);
      this.addProjectSlug(projectPath);

      const sessions = await this.scanChatDir(chatDir);
      allSessions.push(...sessions);
    }

    return allSessions;
  }

  /**
   * Check if any session in a chat directory belongs to the given project path.
   */
  private async chatDirMatchesPath(
    chatDir: string,
    projectPath: string,
  ): Promise<boolean> {
    let entries;
    try {
      entries = await fs.readdir(chatDir, { withFileTypes: true });
    } catch {
      return false;
    }

    // Check up to 3 sessions for a match
    let checked = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || checked >= 3) break;
      const dbPath = path.join(chatDir, entry.name, "store.db");
      if (!(await fileExists(dbPath))) continue;

      checked++;
      try {
        const escapedPath = projectPath.replace(/'/g, "''");
        const result = await sqliteQuery(
          dbPath,
          `SELECT 1 FROM blobs WHERE cast(data as text) LIKE '%Workspace Path: ${escapedPath}%' LIMIT 1;`,
        );
        if (result.trim()) return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Scan store.db blob content and plan registry for plan files.
   * Always runs both strategies and merges results.
   */
  private async discoverReferencedPlanFiles(
    existingFiles: string[],
  ): Promise<string[]> {
    const plansPrefix = CURSOR_PLANS_DIR + path.sep;
    const escapedPlansPrefix = escapeRegex(plansPrefix);
    const pattern = new RegExp(`${escapedPlansPrefix}[^"\\\\\\s]+`, "g");

    const found = new Map<string, DiscoveredPlan>();

    // Strategy 1: Scan store.db blobs for plan path references
    for (const [, dbPath] of this.sessionDbPaths) {
      try {
        const escapedDir = CURSOR_PLANS_DIR.replace(/'/g, "''");
        const result = await sqliteQuery(
          dbPath,
          `SELECT cast(data as text) FROM blobs WHERE cast(data as text) LIKE '%${escapedDir}%';`,
        );
        for (const match of result.matchAll(pattern)) {
          const filePath = match[0];
          if (!found.has(filePath)) {
            found.set(filePath, {
              id: null,
              name: null,
              filePath,
              discoveredVia: "blob-content-scan",
              referencedInStoreDb: dbPath,
            });
          }
        }
      } catch {
        // Skip
      }
    }

    // Also scan transcript files for plan references
    for (const file of existingFiles) {
      if (!file.endsWith(".txt")) continue;
      try {
        for await (const line of readLines(file)) {
          for (const match of line.matchAll(pattern)) {
            const filePath = match[0];
            if (!found.has(filePath)) {
              found.set(filePath, {
                id: null,
                name: null,
                filePath,
                discoveredVia: "blob-content-scan",
                referencedInStoreDb: file,
              });
            }
          }
        }
      } catch {
        // Skip
      }
    }

    // Strategy 2: Query plan registry from global state.vscdb
    const registryPlans = await this.discoverPlansFromRegistry();
    for (const plan of registryPlans) {
      if (!found.has(plan.filePath)) {
        found.set(plan.filePath, plan);
      }
    }

    // Verify files exist and collect results
    const existing: string[] = [];
    for (const [filePath, plan] of found) {
      if (await fileExists(filePath)) {
        existing.push(filePath);
        this.discoveredPlans.push(plan);
      }
    }
    return existing;
  }

  /**
   * Find workspace storage directory by scanning workspace.json files.
   */
  private async findWorkspaceStorageDir(
    projectPath: string,
  ): Promise<void> {
    if (!(await directoryExists(this._workspaceStorageDir))) return;

    let entries;
    try {
      entries = await fs.readdir(this._workspaceStorageDir, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    const expectedFolder = `file://${projectPath}`;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const wsJsonPath = path.join(
        this._workspaceStorageDir,
        entry.name,
        "workspace.json",
      );
      const wsJson = await safeReadJson<{ folder?: string }>(wsJsonPath);
      if (!wsJson?.folder) continue;

      if (wsJson.folder === expectedFolder) {
        this.workspaceStorageDir = path.join(
          this._workspaceStorageDir,
          entry.name,
        );
        this.workspaceJsonPath = wsJsonPath;
        return;
      }
    }
  }

  /**
   * Discover Composer sessions from workspace state.vscdb.
   * These are separate from chat sessions in ~/.cursor/chats/.
   */
  private async findComposerSessions(
    seenIds: Set<string>,
  ): Promise<DiscoveredSession[]> {
    if (!this.workspaceStorageDir || !this.sqliteAvailable) return [];

    const wsStateDb = path.join(this.workspaceStorageDir, "state.vscdb");
    if (!(await fileExists(wsStateDb))) return [];

    try {
      const raw = await sqliteQuery(
        wsStateDb,
        "SELECT value FROM ItemTable WHERE key='composer.composerData';",
      );
      const trimmed = raw.trim();
      if (!trimmed) return [];

      const data = JSON.parse(trimmed) as {
        allComposers?: Array<{
          composerId?: string;
          name?: string;
          createdAt?: number;
          lastUpdatedAt?: number;
          subtitle?: string;
        }>;
      };

      const sessions: DiscoveredSession[] = [];
      for (const composer of data.allComposers ?? []) {
        if (!composer.composerId || seenIds.has(composer.composerId)) continue;
        seenIds.add(composer.composerId);

        sessions.push({
          agentName: this.name,
          sessionId: composer.composerId,
          summary: composer.name && composer.name !== "New Composer" ? composer.name : null,
          firstPrompt: composer.subtitle ?? null,
          messageCount: null,
          created: composer.createdAt
            ? new Date(composer.createdAt).toISOString()
            : null,
          modified: composer.lastUpdatedAt
            ? new Date(composer.lastUpdatedAt).toISOString()
            : null,
          sizeBytes: 0,
        });
      }

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Get all composerIds from the workspace state.vscdb.
   */
  private async getWorkspaceComposerIds(): Promise<Set<string>> {
    if (this.workspaceComposerIds) return this.workspaceComposerIds;
    this.workspaceComposerIds = new Set();

    if (!this.workspaceStorageDir || !this.sqliteAvailable) {
      return this.workspaceComposerIds;
    }

    const wsStateDb = path.join(this.workspaceStorageDir, "state.vscdb");
    if (!(await fileExists(wsStateDb))) return this.workspaceComposerIds;

    try {
      const raw = await sqliteQuery(
        wsStateDb,
        "SELECT value FROM ItemTable WHERE key='composer.composerData';",
      );
      const trimmed = raw.trim();
      if (!trimmed) return this.workspaceComposerIds;

      const data = JSON.parse(trimmed) as {
        allComposers?: Array<{ composerId?: string }>;
      };
      for (const composer of data.allComposers ?? []) {
        if (composer.composerId) {
          this.workspaceComposerIds.add(composer.composerId);
        }
      }
    } catch {
      // Skip
    }

    return this.workspaceComposerIds;
  }

  /**
   * Query the global plan registry for plans belonging to this workspace.
   */
  private async discoverPlansFromRegistry(): Promise<DiscoveredPlan[]> {
    if (!this.sqliteAvailable) return [];
    if (!(await fileExists(this._globalStateDb))) return [];

    const composerIds = await this.getWorkspaceComposerIds();
    if (composerIds.size === 0) return [];

    try {
      const raw = await sqliteQuery(
        this._globalStateDb,
        "SELECT value FROM ItemTable WHERE key='composer.planRegistry';",
      );
      const trimmed = raw.trim();
      if (!trimmed) return [];

      const registry = JSON.parse(trimmed) as Record<
        string,
        PlanRegistryEntry
      >;
      const plans: DiscoveredPlan[] = [];

      for (const [, entry] of Object.entries(registry)) {
        const createdByMatch =
          entry.createdBy && composerIds.has(entry.createdBy);
        const editedByMatch = entry.editedBy?.some((id) =>
          composerIds.has(id),
        );

        if (!createdByMatch && !editedByMatch) continue;

        const filePath = entry.uri?.path;
        if (!filePath) continue;

        plans.push({
          id: entry.id,
          name: entry.name,
          filePath,
          discoveredVia: "registry",
          createdByComposerId: entry.createdBy,
          registryUri: `${entry.uri.scheme}://${entry.uri.path}`,
        });
      }

      return plans;
    } catch {
      return [];
    }
  }

  /**
   * Create a filtered copy of state.vscdb containing only project-relevant rows.
   */
  private async createStateExtract(): Promise<string | null> {
    if (!this.sqliteAvailable) return null;
    if (!(await fileExists(this._globalStateDb))) return null;

    const composerIds = await this.getWorkspaceComposerIds();

    try {
      const tmpPath = path.join(os.tmpdir(), `cursor-state-${Date.now()}.vscdb`);

      // Build SQL operations
      const escapedGlobalPath = this._globalStateDb.replace(/'/g, "''");
      const sqlParts: string[] = [
        `ATTACH DATABASE '${escapedGlobalPath}' AS source;`,
        "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
        "CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
        // Plan registry
        "INSERT INTO ItemTable SELECT * FROM source.ItemTable WHERE key = 'composer.planRegistry';",
      ];

      // composerData rows for workspace's composers
      if (composerIds.size > 0) {
        const inClause = [...composerIds]
          .map((id) => `'composerData:${id.replace(/'/g, "''")}'`)
          .join(",");
        sqlParts.push(
          `INSERT INTO cursorDiskKV SELECT * FROM source.cursorDiskKV WHERE key IN (${inClause});`,
        );
      }

      sqlParts.push("DETACH source;");

      // Also copy workspace-level composer.composerData if available
      if (this.workspaceStorageDir) {
        const wsStateDb = path.join(this.workspaceStorageDir, "state.vscdb");
        if (await fileExists(wsStateDb)) {
          const escapedWsPath = wsStateDb.replace(/'/g, "''");
          sqlParts.push(
            `ATTACH DATABASE '${escapedWsPath}' AS wsource;`,
            "INSERT OR REPLACE INTO ItemTable SELECT * FROM wsource.ItemTable WHERE key = 'composer.composerData';",
            "DETACH wsource;",
          );
        }
      }

      await sqliteCreateFiltered(tmpPath, sqlParts.join("\n"));
      this.stateExtractPath = tmpPath;
      return tmpPath;
    } catch {
      return null;
    }
  }

  /**
   * Build the discovery manifest with all intermediate findings.
   */
  private buildDiscoveryManifest(): Record<string, unknown> {
    const projectPath = this.projectPath ?? "";
    const chatHashes = this.chatDirs.map((d) => path.basename(d));

    const manifest: Record<string, unknown> = {
      project: {
        path: projectPath,
        chatHashes,
        chatHashAlgorithm: "MD5(projectPath)",
        projectSlugs: this.projectSlugs,
        projectSlugAlgorithm: "path.replace(/^\\//, '').replace(/\\//g, '-')",
      },
      workspaceStorage: this.workspaceStorageDir
        ? {
            hash: path.basename(this.workspaceStorageDir),
            dir: this.workspaceStorageDir,
            workspaceJsonPath: this.workspaceJsonPath,
            stateDbPath: path.join(this.workspaceStorageDir, "state.vscdb"),
            composerIds: [...(this.workspaceComposerIds ?? [])],
            composerIdsSource:
              "ItemTable key='composer.composerData' → allComposers[].composerId",
          }
        : null,
      globalState: {
        path: this._globalStateDb,
        planRegistryKey: "ItemTable key='composer.planRegistry'",
        composerDataKeyPattern: "cursorDiskKV key='composerData:<composerId>'",
      },
      sessions: [...this.sessionDbPaths.entries()].map(
        ([agentId, dbPath]) => ({
          agentId,
          storeDbPath: dbPath,
          discoveryStrategy: this.chatDirs.some((d) =>
            dbPath.startsWith(d),
          )
            ? "md5-hash-lookup"
            : "blob-content-scan",
        }),
      ),
      plans: this.discoveredPlans,
      stateExtract: this.stateExtractPath
        ? {
            description:
              "Filtered copy of state.vscdb containing only project-relevant rows",
            tempPath: this.stateExtractPath,
            includedFromGlobal: {
              ItemTable: ["composer.planRegistry"],
              cursorDiskKV: [...(this.workspaceComposerIds ?? [])].map(
                (id) => `composerData:${id}`,
              ),
            },
            includedFromWorkspace: this.workspaceStorageDir
              ? { ItemTable: ["composer.composerData"] }
              : null,
          }
        : null,
    };

    return manifest;
  }
}

/**
 * Compute MD5 hash of a string. Cursor uses MD5(projectPath) as the chat directory name.
 */
function md5Hash(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

/**
 * Convert a project path to the Cursor project slug format.
 * /Users/foo/project → Users-foo-project
 */
function projectPathToSlug(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  // Remove leading slash, then replace all / with -
  return normalized.replace(/^\//g, "").replace(/\//g, "-");
}

/**
 * Extract the user's actual message text from a Cursor user blob.
 * Cursor user blobs have two formats:
 * - String content: "<user_info>...</user_info>\n<project_layout>...\n<user_query>actual message</user_query>"
 * - Array content: [{type: "text", text: "<user_query>actual message</user_query>"}]
 * Returns null if this blob is just context (no user query).
 */
function extractUserText(
  blob: { content?: string | Array<{ type?: string; text?: string }> },
): string | null {
  if (Array.isArray(blob.content)) {
    // Array format: find the text block with <user_query>
    for (const block of blob.content) {
      if (block.type === "text" && block.text) {
        const queryMatch = block.text.match(
          /<user_query>\s*([\s\S]*?)\s*<\/user_query>/,
        );
        if (queryMatch?.[1]) return queryMatch[1].trim();
      }
    }
    return null;
  }

  if (typeof blob.content === "string") {
    // String format: look for <user_query> tag
    const queryMatch = blob.content.match(
      /<user_query>\s*([\s\S]*?)\s*<\/user_query>/,
    );
    if (queryMatch?.[1]) return queryMatch[1].trim();
    return null;
  }

  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
