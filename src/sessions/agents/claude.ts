import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_PROJECTS_DIR,
  CLAUDE_HISTORY_FILE,
  CLAUDE_DIR,
} from "../../config.js";
import { encodeProjectPath, decodeProjectPath } from "../../utils/paths.js";
import {
  directoryExists,
  fileExists,
  safeReadJson,
  readJsonl,
  readLines,
  getFileSize,
  walkDirectoryAbsolute,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession, ProjectContext } from "../types.js";

interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  projectPath?: string;
}

interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
}

interface ClaudeMessage {
  type?: string;
  cwd?: string;
  sessionId?: string;
  message?: { role?: string; content?: unknown[] };
  timestamp?: string;
}

interface HistoryEntry {
  project?: string;
  sessionId?: string;
  display?: string;
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = "Claude Code";
  readonly slug = "claude-code";

  private _sessionDirs: string[] = [];
  private _providerFiles: string[] | null = null;

  async detect(): Promise<boolean> {
    return directoryExists(CLAUDE_PROJECTS_DIR);
  }

  getSessionDir(): string | null {
    return this._sessionDirs[0] ?? null;
  }

  getArchiveRoot(): string {
    return CLAUDE_DIR;
  }

  async discoverProjects(): Promise<Map<string, number>> {
    const projects = new Map<string, number>();

    try {
      // Strategy 1: Scan project directories
      let dirs: string[];
      try {
        const entries = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
        dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        dirs = [];
      }

      for (const dirName of dirs) {
        const decoded = decodeProjectPath(dirName);
        if (!(await directoryExists(decoded))) continue;

        const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
        let jsonlCount = 0;
        try {
          const files = await fs.readdir(dirPath);
          jsonlCount = files.filter((f) => f.endsWith(".jsonl")).length;
        } catch {
          continue;
        }

        if (jsonlCount > 0) {
          projects.set(decoded, jsonlCount);
        }
      }

      // Strategy 2: Supplement from history.jsonl
      if (await fileExists(CLAUDE_HISTORY_FILE)) {
        try {
          for await (const entry of readJsonl<HistoryEntry>(CLAUDE_HISTORY_FILE)) {
            if (entry.project && !projects.has(entry.project)) {
              projects.set(entry.project, (projects.get(entry.project) ?? 0) + 1);
            }
          }
        } catch {
          // Skip unreadable history
        }
      }
    } catch {
      // Never throw
    }

    return projects;
  }

  async findSessions(context: ProjectContext): Promise<DiscoveredSession[]> {
    const { projectPath } = context;
    // Strategy 1: Compute encoded path
    const encoded = encodeProjectPath(projectPath);
    const sessionDir = path.join(CLAUDE_PROJECTS_DIR, encoded);

    if (await directoryExists(sessionDir)) {
      if (!this._sessionDirs.includes(sessionDir)) {
        this._sessionDirs.push(sessionDir);
      }
      const sessions = await this.scanSessionDir(sessionDir, projectPath);
      if (sessions.length > 0) return sessions;
    }

    // Strategy 2: Scan history.jsonl for matching project paths
    return this.scanHistory(projectPath);
  }

  async getSessionFiles(_session: DiscoveredSession): Promise<string[]> {
    // All files are returned via getProviderFiles() instead
    return [];
  }

  async getProviderFiles(): Promise<string[]> {
    if (this._providerFiles) return this._providerFiles;
    if (this._sessionDirs.length === 0) return [];

    // Walk all session directories (one per worktree path)
    const allDirFiles: string[] = [];
    for (const dir of this._sessionDirs) {
      const files = await walkDirectoryAbsolute(dir);
      allDirFiles.push(...files);
    }

    // Discover referenced plan/debug files from JSONL content
    const referencedFiles = await this.discoverReferencedFiles(allDirFiles);

    this._providerFiles = [...allDirFiles, ...referencedFiles];
    return this._providerFiles;
  }

  private async scanSessionDir(
    sessionDir: string,
    projectPath: string,
  ): Promise<DiscoveredSession[]> {
    // Try sessions-index.json first
    const indexPath = path.join(sessionDir, "sessions-index.json");
    const index = await safeReadJson<SessionIndex>(indexPath);

    if (index?.entries) {
      // Verify at least one entry matches our project path
      const matching = index.entries.filter(
        (e) => !e.projectPath || e.projectPath === projectPath,
      );

      if (matching.length > 0) {
        const sessions: DiscoveredSession[] = [];
        for (const entry of matching) {
          const jsonlPath = path.join(sessionDir, `${entry.sessionId}.jsonl`);
          const sizeBytes = await getFileSize(jsonlPath);

          sessions.push({
            agentName: this.name,
            sessionId: entry.sessionId,
            summary: entry.summary ?? null,
            firstPrompt: entry.firstPrompt ? stripIdeTags(entry.firstPrompt) : null,
            messageCount: entry.messageCount ?? null,
            created: entry.created ?? null,
            modified: entry.modified ?? null,
            sizeBytes,
          });
        }
        return sessions;
      }
    }

    // No index or no match — scan JSONL files directly
    return this.scanJsonlFiles(sessionDir, projectPath);
  }

  private async scanJsonlFiles(
    sessionDir: string,
    projectPath: string,
  ): Promise<DiscoveredSession[]> {
    let entries;
    try {
      entries = await fs.readdir(sessionDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const sessions: DiscoveredSession[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      const jsonlPath = path.join(sessionDir, entry.name);
      const sessionId = entry.name.replace(".jsonl", "");

      // Verify this session belongs to our project by checking cwd
      let belongsToProject = false;
      let firstPrompt: string | null = null;
      let messageCount = 0;
      let created: string | null = null;
      let modified: string | null = null;

      try {
        for await (const msg of readJsonl<ClaudeMessage>(jsonlPath)) {
          if (msg.type === "user") {
            messageCount++;
            if (!created && msg.timestamp) created = msg.timestamp;
            if (msg.timestamp) modified = msg.timestamp;

            if (!belongsToProject && msg.cwd) {
              belongsToProject = msg.cwd === projectPath ||
                msg.cwd.startsWith(projectPath + "/") ||
                msg.cwd.startsWith(projectPath + "\\");
            }

            if (!firstPrompt && msg.message?.content) {
              const textBlock = msg.message.content.find(
                (c: unknown) =>
                  typeof c === "object" &&
                  c !== null &&
                  "type" in c &&
                  (c as { type: string }).type === "text",
              ) as { text?: string } | undefined;
              if (textBlock?.text) {
                firstPrompt = stripIdeTags(textBlock.text).slice(0, 200);
              }
            }
          }
        }
      } catch {
        // Skip unreadable files
        continue;
      }

      if (!belongsToProject) continue;

      const sizeBytes = await getFileSize(jsonlPath);

      sessions.push({
        agentName: this.name,
        sessionId,
        summary: null,
        firstPrompt,
        messageCount,
        created,
        modified,
        sizeBytes,
      });
    }

    return sessions;
  }

  /**
   * Scan JSONL files for references to ~/.claude/plans/ and ~/.claude/debug/ files.
   * Returns absolute paths of referenced files that exist on disk.
   */
  private async discoverReferencedFiles(allFiles: string[]): Promise<string[]> {
    const homeDir = os.homedir();
    const plansDir = path.join(homeDir, ".claude", "plans");
    const debugDir = path.join(homeDir, ".claude", "debug");
    // Escape for regex: replace path separators and special chars
    const plansPrefix = plansDir + path.sep;
    const debugPrefix = debugDir + path.sep;

    const found = new Set<string>();

    // Build regex that matches absolute paths to plan/debug files
    const escapedPlans = escapeRegex(plansPrefix);
    const escapedDebug = escapeRegex(debugPrefix);
    const pattern = new RegExp(
      `(?:${escapedPlans}|${escapedDebug})[^"\\\\\\s]+`,
      "g",
    );

    for (const file of allFiles) {
      if (!file.endsWith(".jsonl")) continue;

      try {
        for await (const line of readLines(file)) {
          for (const match of line.matchAll(pattern)) {
            found.add(match[0]);
          }
        }
      } catch {
        // Skip unreadable files
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

  private async scanHistory(
    projectPath: string,
  ): Promise<DiscoveredSession[]> {
    if (!(await fileExists(CLAUDE_HISTORY_FILE))) return [];

    const sessionIds = new Set<string>();

    try {
      for await (const entry of readJsonl<HistoryEntry>(CLAUDE_HISTORY_FILE)) {
        if (entry.project === projectPath && entry.sessionId) {
          sessionIds.add(entry.sessionId);
        }
      }
    } catch {
      return [];
    }

    if (sessionIds.size === 0) return [];

    // Try to find session files in any project directory
    const sessions: DiscoveredSession[] = [];
    try {
      const projectDirs = await fs.readdir(CLAUDE_PROJECTS_DIR);
      for (const dir of projectDirs) {
        const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir);
        for (const sid of sessionIds) {
          const jsonlPath = path.join(dirPath, `${sid}.jsonl`);
          if (await fileExists(jsonlPath)) {
            if (!this._sessionDirs.includes(dirPath)) {
              this._sessionDirs.push(dirPath);
            }
            const sizeBytes = await getFileSize(jsonlPath);

            sessions.push({
              agentName: this.name,
              sessionId: sid,
              summary: null,
              firstPrompt: null,
              messageCount: null,
              created: null,
              modified: null,
              sizeBytes,
            });
            sessionIds.delete(sid);
          }
        }
      }
    } catch {
      // Can't read projects dir
    }

    return sessions;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip IDE context tags (e.g. <ide_selection>...</ide_selection>) from text.
 * These are injected by VS Code/Cursor extensions and clutter the display.
 */
function stripIdeTags(text: string): string {
  return text.replace(/<ide_\w+>[\s\S]*?<\/ide_\w+>/g, "").trim();
}
