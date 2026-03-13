import fs from "node:fs/promises";
import os from "node:os";
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
  items?: Array<{ role?: string; content?: unknown[] }>;
}

// New JSONL format — entries have a top-level `type` and `payload`
interface CodexJsonlEntry {
  type?: string;
  payload?: Record<string, unknown>;
}

// Secret patterns to filter from shell snapshots
const SECRET_PATTERNS =
  /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|_KEY=|_SECRET=/i;

// Map from sessionId → absolute file path
const sessionFileMap = new Map<string, string>();

export class CodexProvider implements AgentProvider {
  readonly name = "Codex";
  readonly slug = "codex";

  private _tempFiles: string[] = [];

  async detect(): Promise<boolean> {
    return directoryExists(CODEX_DIR);
  }

  getArchiveRoot(): string {
    return CODEX_DIR;
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    if (!(await directoryExists(CODEX_SESSIONS_DIR))) return [];

    const sessions: DiscoveredSession[] = [];
    await this.scanDir(CODEX_SESSIONS_DIR, projectPath, sessions);
    return sessions;
  }

  async getSessionFiles(session: DiscoveredSession): Promise<string[]> {
    const files: string[] = [];
    const file = sessionFileMap.get(session.sessionId);
    if (file) files.push(file);

    // Include filtered shell snapshot if it exists
    const snapshotPath = path.join(
      CODEX_DIR,
      "shell_snapshots",
      `${session.sessionId}.sh`,
    );
    if (await fileExists(snapshotPath)) {
      const filtered = await this.filterShellSnapshot(snapshotPath);
      if (filtered) files.push(filtered);
    }

    return files;
  }

  async getProviderFiles(): Promise<string[]> {
    const files: string[] = [];

    const candidates = [
      path.join(CODEX_DIR, "config.toml"),
      path.join(CODEX_DIR, "instructions.md"),
      path.join(CODEX_DIR, "history.jsonl"),
    ];

    for (const f of candidates) {
      if (await fileExists(f)) {
        files.push(f);
      }
    }

    return files;
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
    const modified = await this.getModifiedTime(filePath);

    // Extract firstPrompt and user message count from items
    let firstPrompt: string | null = null;
    let messageCount = 0;
    if (data.items) {
      for (const item of data.items) {
        if (item.role === "user") {
          messageCount++;
          if (!firstPrompt && item.content) {
            firstPrompt = this.extractTextFromContent(item.content);
          }
        }
      }
    }

    sessionFileMap.set(sessionId, filePath);

    return {
      agentName: this.name,
      sessionId,
      summary: null,
      firstPrompt,
      messageCount,
      created: data.session.timestamp ?? null,
      modified,
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
    let firstPrompt: string | null = null;
    let messageCount = 0;

    try {
      for await (const entry of readJsonl<CodexJsonlEntry>(filePath)) {
        if (!entry.type || !entry.payload) continue;

        if (entry.type === "session_meta") {
          const p = entry.payload as {
            id?: string;
            timestamp?: string;
            cwd?: string;
          };
          sessionId = p.id ?? null;
          created = p.timestamp ?? null;
          cwd = p.cwd ?? null;
        } else if (entry.type === "response_item") {
          const p = entry.payload as {
            type?: string;
            role?: string;
            content?: unknown[];
          };
          if (p.role === "user") {
            messageCount++;
            if (!firstPrompt && p.content) {
              firstPrompt = this.extractTextFromContent(p.content);
            }
          }
        } else if (entry.type === "turn_context") {
          // turn_context can also carry cwd (updated per turn)
          const p = entry.payload as { cwd?: string };
          if (p.cwd) cwd = p.cwd;
        }
      }
    } catch {
      return null;
    }

    if (!cwd || !this.cwdMatches(cwd, projectPath)) return null;

    const id = sessionId ?? path.basename(filePath, ".jsonl");
    const sizeBytes = await getFileSize(filePath);
    const modified = await this.getModifiedTime(filePath);

    sessionFileMap.set(id, filePath);

    return {
      agentName: this.name,
      sessionId: id,
      summary: null,
      firstPrompt,
      messageCount,
      created,
      modified,
      sizeBytes,
    };
  }

  private extractTextFromContent(content: unknown[]): string | null {
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type: string }).type === "input_text" &&
        "text" in block
      ) {
        const text = (block as { text: string }).text;
        return text.slice(0, 200);
      }
    }
    return null;
  }

  private async getModifiedTime(filePath: string): Promise<string | null> {
    try {
      const stat = await fs.stat(filePath);
      return stat.mtime.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Read a shell snapshot, strip lines containing secret patterns,
   * and write the filtered content to a temp file that mirrors the
   * original path under CODEX_DIR so the archiver preserves the path.
   */
  private async filterShellSnapshot(
    snapshotPath: string,
  ): Promise<string | null> {
    try {
      const content = await fs.readFile(snapshotPath, "utf-8");
      const filtered = content
        .split("\n")
        .filter((line) => !SECRET_PATTERNS.test(line))
        .join("\n");

      // Write filtered content to a temp file. The archiver falls back
      // to sessions/codex/{sessionId}/{filename} for the archive path.
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "codex-filtered-"),
      );
      const tmpFile = path.join(tmpDir, path.basename(snapshotPath));
      await fs.writeFile(tmpFile, filtered, "utf-8");
      this._tempFiles.push(tmpFile);

      return tmpFile;
    } catch {
      return null;
    }
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
