import fs from "node:fs/promises";
import path from "node:path";
import { CLINE_DIR, CLINE_TASKS_DIR, CLINE_HISTORY_FILE } from "../../config.js";
import {
  directoryExists,
  safeReadJson,
  getFileSize,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession } from "../types.js";

interface ClineTaskHistoryEntry {
  id: string;
  task?: string;
  tokensIn?: number;
  tokensOut?: number;
  cwdOnTaskInitialization?: string;
  modelId?: string;
}

// Map from sessionId → list of absolute file paths
const sessionFileCache = new Map<string, string[]>();

export class ClineProvider implements AgentProvider {
  readonly name = "Cline";
  readonly slug = "cline";

  async detect(): Promise<boolean> {
    return directoryExists(CLINE_DIR);
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    const history = await safeReadJson<ClineTaskHistoryEntry[]>(
      CLINE_HISTORY_FILE,
    );
    if (!history || !Array.isArray(history)) return [];

    const sessions: DiscoveredSession[] = [];

    for (const entry of history) {
      if (!entry.cwdOnTaskInitialization) continue;

      if (!this.cwdMatches(entry.cwdOnTaskInitialization, projectPath))
        continue;

      const taskDir = path.join(CLINE_TASKS_DIR, entry.id);
      if (!(await directoryExists(taskDir))) continue;

      const files = await this.collectTaskFiles(taskDir);
      sessionFileCache.set(entry.id, files);

      let totalSize = 0;
      for (const f of files) {
        totalSize += await getFileSize(f);
      }

      sessions.push({
        agentName: this.name,
        sessionId: entry.id,
        summary: entry.task ?? null,
        firstPrompt: entry.task ?? null,
        messageCount: null,
        created: null,
        modified: null,
        sizeBytes: totalSize,
      });
    }

    return sessions;
  }

  async getSessionFiles(session: DiscoveredSession): Promise<string[]> {
    return sessionFileCache.get(session.sessionId) ?? [];
  }

  private async collectTaskFiles(taskDir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await fs.readdir(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(path.join(taskDir, entry.name));
        }
      }
    } catch {
      // Skip unreadable
    }
    return files;
  }

  private cwdMatches(cwd: string, projectPath: string): boolean {
    const normalized = cwd.replace(/\\/g, "/");
    const normalizedProject = projectPath.replace(/\\/g, "/");
    return (
      normalized === normalizedProject ||
      normalized.startsWith(normalizedProject + "/")
    );
  }
}
