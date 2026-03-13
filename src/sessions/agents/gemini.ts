import fs from "node:fs/promises";
import path from "node:path";
import {
  GEMINI_DIR,
  GEMINI_CONVERSATIONS_DIR,
  GEMINI_BRAIN_DIR,
  GEMINI_PROJECTS_FILE,
  GEMINI_TMP_DIR,
  GEMINI_HISTORY_DIR,
} from "../../config.js";
import {
  directoryExists,
  fileExists,
  getFileSize,
  safeReadJson,
} from "../../utils/fs-helpers.js";
import type { AgentProvider, DiscoveredSession } from "../types.js";

interface GeminiProjectsJson {
  projects?: Record<string, string>;
}

interface GeminiChatSession {
  sessionId?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
}

interface GeminiMessage {
  type?: string;
  content?: Array<{ text?: string }> | string;
}

// Map from sessionId → list of absolute file paths (for old-format sessions)
const sessionFileCache = new Map<string, string[]>();

export class GeminiProvider implements AgentProvider {
  readonly name = "Gemini CLI";
  readonly slug = "gemini";

  private discoveredSlugs = new Set<string>();
  private hasOldFormatSessions = false;

  async detect(): Promise<boolean> {
    return directoryExists(GEMINI_DIR);
  }

  getArchiveRoot(): string {
    return GEMINI_DIR;
  }

  async findSessions(projectPath: string): Promise<DiscoveredSession[]> {
    // Try new format first
    const sessions = await this.findNewFormatSessions(projectPath);
    if (sessions.length > 0) return sessions;

    // Fall back to old .pb format
    return this.findOldFormatSessions(projectPath);
  }

  async getSessionFiles(session: DiscoveredSession): Promise<string[]> {
    // Old-format sessions use the cache; new-format handled via getProviderFiles
    return sessionFileCache.get(session.sessionId) ?? [];
  }

  async getProviderFiles(): Promise<string[]> {
    const files: string[] = [];

    // New-format files for each discovered slug
    for (const slug of this.discoveredSlugs) {
      // Chat session files
      const chatsDir = path.join(GEMINI_TMP_DIR, slug, "chats");
      if (await directoryExists(chatsDir)) {
        try {
          const entries = await fs.readdir(chatsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.startsWith("session-") && entry.name.endsWith(".json")) {
              files.push(path.join(chatsDir, entry.name));
            }
          }
        } catch {
          // Skip
        }
      }

      // logs.json
      const logsPath = path.join(GEMINI_TMP_DIR, slug, "logs.json");
      if (await fileExists(logsPath)) {
        files.push(logsPath);
      }

      // tmp/{slug}/.project_root
      const tmpProjectRoot = path.join(GEMINI_TMP_DIR, slug, ".project_root");
      if (await fileExists(tmpProjectRoot)) {
        files.push(tmpProjectRoot);
      }

      // history/{slug}/.project_root
      const historyProjectRoot = path.join(GEMINI_HISTORY_DIR, slug, ".project_root");
      if (await fileExists(historyProjectRoot)) {
        files.push(historyProjectRoot);
      }
    }

    // Old-format files from cache
    if (this.hasOldFormatSessions) {
      for (const cachedFiles of sessionFileCache.values()) {
        files.push(...cachedFiles);
      }
    }

    return files;
  }

  async getVirtualFiles(): Promise<Array<{ relativePath: string; content: string }>> {
    if (this.discoveredSlugs.size === 0) return [];

    const projectsData = await safeReadJson<GeminiProjectsJson>(GEMINI_PROJECTS_FILE);
    if (!projectsData?.projects) return [];

    // Filter to only entries whose slug is in discoveredSlugs
    const filtered: Record<string, string> = {};
    for (const [projectPath, slug] of Object.entries(projectsData.projects)) {
      if (this.discoveredSlugs.has(slug)) {
        filtered[projectPath] = slug;
      }
    }

    if (Object.keys(filtered).length === 0) return [];

    return [{
      relativePath: "projects.json",
      content: JSON.stringify({ projects: filtered }, null, 2),
    }];
  }

  // --- New format ---

  private async resolveProjectSlug(projectPath: string): Promise<string | null> {
    // Strategy 1: Look up in projects.json
    const projectsData = await safeReadJson<GeminiProjectsJson>(GEMINI_PROJECTS_FILE);
    if (projectsData?.projects?.[projectPath]) {
      return projectsData.projects[projectPath];
    }

    // Strategy 2: Scan tmp/ subdirs for .project_root matching the path
    if (await directoryExists(GEMINI_TMP_DIR)) {
      try {
        const entries = await fs.readdir(GEMINI_TMP_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const projectRootFile = path.join(GEMINI_TMP_DIR, entry.name, ".project_root");
          if (!(await fileExists(projectRootFile))) continue;
          try {
            const content = (await fs.readFile(projectRootFile, "utf-8")).trim();
            if (content === projectPath) {
              return entry.name;
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Skip
      }
    }

    return null;
  }

  private async findNewFormatSessions(projectPath: string): Promise<DiscoveredSession[]> {
    const slug = await this.resolveProjectSlug(projectPath);
    if (!slug) return [];

    const chatsDir = path.join(GEMINI_TMP_DIR, slug, "chats");
    if (!(await directoryExists(chatsDir))) return [];

    let entries;
    try {
      entries = await fs.readdir(chatsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const sessions: DiscoveredSession[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("session-") || !entry.name.endsWith(".json")) continue;

      const filePath = path.join(chatsDir, entry.name);
      const chatData = await safeReadJson<GeminiChatSession>(filePath);
      if (!chatData) continue;

      const sessionId = chatData.sessionId ?? entry.name.replace(".json", "");
      const created = chatData.startTime ?? null;
      const modified = chatData.lastUpdated ?? null;

      let firstPrompt: string | null = null;
      let messageCount = 0;
      let totalSize = await getFileSize(filePath);

      if (chatData.messages) {
        for (const msg of chatData.messages) {
          if (msg.type === "user") {
            messageCount++;
            if (!firstPrompt && Array.isArray(msg.content) && msg.content.length > 0) {
              const text = msg.content[0]?.text;
              if (text) {
                firstPrompt = text.slice(0, 200);
              }
            }
          }
        }
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

    if (sessions.length > 0) {
      this.discoveredSlugs.add(slug);
    }

    return sessions;
  }

  // --- Old format (.pb) ---

  private async findOldFormatSessions(projectPath: string): Promise<DiscoveredSession[]> {
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

      if (!(await this.pbContainsPath(pbPath, projectPath))) continue;

      const files = await this.collectOldSessionFiles(sessionId, pbPath);
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

    if (sessions.length > 0) {
      this.hasOldFormatSessions = true;
    }

    return sessions;
  }

  private async pbContainsPath(
    pbPath: string,
    projectPath: string,
  ): Promise<boolean> {
    try {
      const buffer = await fs.readFile(pbPath);
      const searchBytes = Buffer.from(projectPath, "utf-8");
      return buffer.includes(searchBytes);
    } catch {
      return false;
    }
  }

  private async collectOldSessionFiles(
    sessionId: string,
    pbPath: string,
  ): Promise<string[]> {
    const files: string[] = [pbPath];

    const implicitDir = path.join(GEMINI_DIR, "antigravity", "implicit");
    if (await directoryExists(implicitDir)) {
      const implicitPath = path.join(implicitDir, `${sessionId}.pb`);
      if (await fileExists(implicitPath)) {
        files.push(implicitPath);
      }
    }

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
