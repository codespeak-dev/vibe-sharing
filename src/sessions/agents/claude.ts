import fs from "node:fs/promises";
import path from "node:path";
import {
  CLAUDE_PROJECTS_DIR,
  CLAUDE_HISTORY_FILE,
} from "../../config.js";
import { encodeProjectPath } from "../../utils/paths.js";
import {
  directoryExists,
  fileExists,
  safeReadJson,
  readJsonl,
  getFileSize,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession } from "../types.js";

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

// Map from sessionId → list of absolute file paths
const sessionFileCache = new Map<string, string[]>();

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = "Claude Code";
  readonly slug = "claude-code";

  async detect(): Promise<boolean> {
    return directoryExists(CLAUDE_PROJECTS_DIR);
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    // Strategy 1: Compute encoded path
    const encoded = encodeProjectPath(projectPath);
    const sessionDir = path.join(CLAUDE_PROJECTS_DIR, encoded);

    if (await directoryExists(sessionDir)) {
      const sessions = await this.scanSessionDir(sessionDir, projectPath);
      if (sessions.length > 0) return sessions;
    }

    // Strategy 2: Scan history.jsonl for matching project paths
    return this.scanHistory(projectPath);
  }

  async getSessionFiles(session: DiscoveredSession): Promise<string[]> {
    return sessionFileCache.get(session.sessionId) ?? [];
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
          const files = await this.collectSessionFiles(
            sessionDir,
            entry.sessionId,
          );
          sessionFileCache.set(entry.sessionId, files);

          let totalSize = 0;
          for (const f of files) {
            totalSize += await getFileSize(f);
          }

          sessions.push({
            agentName: this.name,
            sessionId: entry.sessionId,
            summary: entry.summary ?? null,
            firstPrompt: entry.firstPrompt ?? null,
            messageCount: entry.messageCount ?? null,
            created: entry.created ?? null,
            modified: entry.modified ?? null,
            sizeBytes: totalSize,
          });
        }

        // Also cache the index file itself
        if (await fileExists(indexPath)) {
          for (const s of sessions) {
            const existing = sessionFileCache.get(s.sessionId) ?? [];
            if (!existing.includes(indexPath)) {
              existing.push(indexPath);
              sessionFileCache.set(s.sessionId, existing);
            }
          }
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
                firstPrompt = textBlock.text.slice(0, 200);
              }
            }
          }
        }
      } catch {
        // Skip unreadable files
        continue;
      }

      if (!belongsToProject) continue;

      const files = await this.collectSessionFiles(sessionDir, sessionId);
      sessionFileCache.set(sessionId, files);

      let totalSize = 0;
      for (const f of files) {
        totalSize += await getFileSize(f);
      }

      sessions.push({
        agentName: this.name,
        sessionId,
        summary: null,
        firstPrompt,
        messageCount,
        created,
        modified,
        sizeBytes: totalSize,
      });
    }

    return sessions;
  }

  private async collectSessionFiles(
    sessionDir: string,
    sessionId: string,
  ): Promise<string[]> {
    const files: string[] = [];

    // Main JSONL file
    const jsonlPath = path.join(sessionDir, `${sessionId}.jsonl`);
    if (await fileExists(jsonlPath)) {
      files.push(jsonlPath);
    }

    // Subagent directory
    const subagentsDir = path.join(sessionDir, sessionId, "subagents");
    if (await directoryExists(subagentsDir)) {
      try {
        const subEntries = await fs.readdir(subagentsDir);
        for (const sub of subEntries) {
          files.push(path.join(subagentsDir, sub));
        }
      } catch {
        // Skip if unreadable
      }
    }

    return files;
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
            const files = await this.collectSessionFiles(dirPath, sid);
            sessionFileCache.set(sid, files);

            let totalSize = 0;
            for (const f of files) {
              totalSize += await getFileSize(f);
            }

            sessions.push({
              agentName: this.name,
              sessionId: sid,
              summary: null,
              firstPrompt: null,
              messageCount: null,
              created: null,
              modified: null,
              sizeBytes: totalSize,
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
