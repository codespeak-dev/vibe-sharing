import fs from "node:fs/promises";
import path from "node:path";
import { GEMINI_DIR, GEMINI_CONVERSATIONS_DIR, GEMINI_BRAIN_DIR } from "../../config.js";
import {
  directoryExists,
  fileExists,
  getFileSize,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession } from "../types.js";

// Map from sessionId → list of absolute file paths
const sessionFileCache = new Map<string, string[]>();

export class GeminiProvider implements AgentProvider {
  readonly name = "Gemini CLI";
  readonly slug = "gemini";

  async detect(): Promise<boolean> {
    return directoryExists(GEMINI_DIR);
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    if (!(await directoryExists(GEMINI_CONVERSATIONS_DIR))) return [];

    let entries;
    try {
      entries = await fs.readdir(GEMINI_CONVERSATIONS_DIR, {
        withFileTypes: true,
      });
    } catch {
      return [];
    }

    const sessions: DiscoveredSession[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".pb")) continue;

      const pbPath = path.join(GEMINI_CONVERSATIONS_DIR, entry.name);
      const sessionId = entry.name.replace(".pb", "");

      // Grep the binary protobuf file for the project path
      // Paths appear as plain text strings in protobuf encoding
      if (!(await this.pbContainsPath(pbPath, projectPath))) continue;

      const files = await this.collectSessionFiles(sessionId, pbPath);
      sessionFileCache.set(sessionId, files);

      let totalSize = 0;
      for (const f of files) {
        totalSize += await getFileSize(f);
      }

      sessions.push({
        agentName: this.name,
        sessionId,
        summary: null,
        firstPrompt: null,
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

  private async pbContainsPath(
    pbPath: string,
    projectPath: string,
  ): Promise<boolean> {
    try {
      const buffer = await fs.readFile(pbPath);
      // Search for the project path as a plain string in the binary data
      const searchBytes = Buffer.from(projectPath, "utf-8");
      return buffer.includes(searchBytes);
    } catch {
      return false;
    }
  }

  private async collectSessionFiles(
    sessionId: string,
    pbPath: string,
  ): Promise<string[]> {
    const files: string[] = [pbPath];

    // Check for implicit context file
    const implicitDir = path.join(
      GEMINI_DIR,
      "antigravity",
      "implicit",
    );
    if (await directoryExists(implicitDir)) {
      const implicitPath = path.join(implicitDir, `${sessionId}.pb`);
      if (await fileExists(implicitPath)) {
        files.push(implicitPath);
      }
    }

    // Check for brain directory (screenshots, context)
    const brainDir = path.join(GEMINI_BRAIN_DIR, sessionId);
    if (await directoryExists(brainDir)) {
      try {
        const brainEntries = await fs.readdir(brainDir);
        for (const name of brainEntries) {
          files.push(path.join(brainDir, name));
        }
      } catch {
        // Skip
      }
    }

    return files;
  }
}
