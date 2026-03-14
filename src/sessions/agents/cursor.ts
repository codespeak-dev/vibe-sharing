import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CURSOR_DIR,
  CURSOR_CHATS_DIR,
  CURSOR_PLANS_DIR,
  CURSOR_PROJECTS_DIR,
} from "../../config.js";
import {
  directoryExists,
  fileExists,
  getFileSize,
  walkDirectoryAbsolute,
  readLines,
} from "../../utils/fs-helpers.js";
import {
  hasSqliteCli,
  sqliteQuery,
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

export class CursorProvider implements AgentProvider {
  readonly name = "Cursor";
  readonly slug = "cursor";

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

  async detect(): Promise<boolean> {
    if (!(await directoryExists(CURSOR_CHATS_DIR))) return false;

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

  async findSessions(context: ProjectContext): Promise<DiscoveredSession[]> {
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

    // 3. Referenced plan files
    const planFiles = await this.discoverReferencedPlanFiles(files);
    files.push(...planFiles);

    this._providerFiles = files;
    return this._providerFiles;
  }

  async getVirtualFiles(): Promise<
    Array<{ relativePath: string; content: string }>
  > {
    // Generate decoded sessions-summary.json
    const summaries: Record<string, CursorSessionMeta> = {};

    for (const [sessionId, dbPath] of this.sessionDbPaths) {
      const meta = await this.readSessionMeta(dbPath);
      if (meta) {
        summaries[sessionId] = meta;
      }
    }

    if (Object.keys(summaries).length === 0) return [];

    return [
      {
        relativePath: "sessions-summary.json",
        content: JSON.stringify(summaries, null, 2),
      },
    ];
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
   * Scan store.db blob content for references to ~/.cursor/plans/ files.
   */
  private async discoverReferencedPlanFiles(
    existingFiles: string[],
  ): Promise<string[]> {
    const plansPrefix = CURSOR_PLANS_DIR + path.sep;
    const escapedPlansPrefix = escapeRegex(plansPrefix);
    const pattern = new RegExp(`${escapedPlansPrefix}[^"\\\\\\s]+`, "g");

    const found = new Set<string>();

    // Scan store.db blobs for plan path references
    for (const dbPath of this.sessionDbPaths.values()) {
      try {
        // Query all blobs that mention the plans directory
        const escapedDir = CURSOR_PLANS_DIR.replace(/'/g, "''");
        const result = await sqliteQuery(
          dbPath,
          `SELECT cast(data as text) FROM blobs WHERE cast(data as text) LIKE '%${escapedDir}%';`,
        );
        for (const match of result.matchAll(pattern)) {
          found.add(match[0]);
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
            found.add(match[0]);
          }
        }
      } catch {
        // Skip
      }
    }

    // Verify files exist
    const existing: string[] = [];
    for (const f of found) {
      if (await fileExists(f)) {
        existing.push(f);
      }
    }
    return existing;
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
