import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_SESSIONS_DIR, CODEX_DIR } from "../../config.js";
import {
  directoryExists,
  fileExists,
  safeReadJson,
  readJsonl,
  getFileSize,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession } from "../types.js";

interface CodexSessionMeta {
  id?: string;
  timestamp?: string;
  cwd?: string;
  git?: { branch?: string };
}

// Old JSON format
interface CodexJsonSession {
  session?: CodexSessionMeta;
  items?: unknown[];
}

// New JSONL format
interface CodexJsonlEntry {
  session_meta?: CodexSessionMeta;
  response_item?: { role?: string; content?: unknown[] };
}

// Map from sessionId → absolute file path
const sessionFileMap = new Map<string, string>();

export class CodexProvider implements AgentProvider {
  readonly name = "Codex";
  readonly slug = "codex";

  async detect(): Promise<boolean> {
    return directoryExists(CODEX_DIR);
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    if (!(await directoryExists(CODEX_SESSIONS_DIR))) return [];

    const sessions: DiscoveredSession[] = [];
    await this.scanDir(CODEX_SESSIONS_DIR, projectPath, sessions);
    return sessions;
  }

  async getSessionFiles(session: DiscoveredSession): Promise<string[]> {
    const file = sessionFileMap.get(session.sessionId);
    return file ? [file] : [];
  }

  private async scanDir(
    dir: string,
    projectPath: string,
    results: DiscoveredSession[],
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into date directories (YYYY/MM/DD)
        await this.scanDir(fullPath, projectPath, results);
        continue;
      }

      if (!entry.isFile()) continue;

      if (entry.name.endsWith(".json") && entry.name.startsWith("rollout-")) {
        const session = await this.parseJsonSession(fullPath, projectPath);
        if (session) results.push(session);
      } else if (
        entry.name.endsWith(".jsonl") &&
        entry.name.startsWith("rollout-")
      ) {
        const session = await this.parseJsonlSession(fullPath, projectPath);
        if (session) results.push(session);
      }
    }
  }

  private async parseJsonSession(
    filePath: string,
    projectPath: string,
  ): Promise<DiscoveredSession | null> {
    const data = await safeReadJson<CodexJsonSession>(filePath);
    if (!data?.session?.cwd) return null;

    if (!this.cwdMatches(data.session.cwd, projectPath)) return null;

    const sessionId =
      data.session.id ?? path.basename(filePath, ".json");
    const sizeBytes = await getFileSize(filePath);

    sessionFileMap.set(sessionId, filePath);

    return {
      agentName: this.name,
      sessionId,
      summary: null,
      firstPrompt: null,
      messageCount: data.items?.length ?? null,
      created: data.session.timestamp ?? null,
      modified: null,
      sizeBytes,
    };
  }

  private async parseJsonlSession(
    filePath: string,
    projectPath: string,
  ): Promise<DiscoveredSession | null> {
    let sessionId: string | null = null;
    let created: string | null = null;
    let cwd: string | null = null;
    let messageCount = 0;

    try {
      for await (const entry of readJsonl<CodexJsonlEntry>(filePath)) {
        if (entry.session_meta) {
          sessionId = entry.session_meta.id ?? null;
          created = entry.session_meta.timestamp ?? null;
          cwd = entry.session_meta.cwd ?? null;
        }
        if (entry.response_item) {
          messageCount++;
        }
      }
    } catch {
      return null;
    }

    if (!cwd || !this.cwdMatches(cwd, projectPath)) return null;

    const id = sessionId ?? path.basename(filePath, ".jsonl");
    const sizeBytes = await getFileSize(filePath);

    sessionFileMap.set(id, filePath);

    return {
      agentName: this.name,
      sessionId: id,
      summary: null,
      firstPrompt: null,
      messageCount,
      created,
      modified: null,
      sizeBytes,
    };
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
