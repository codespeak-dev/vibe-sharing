import fs from "node:fs/promises";
import path from "node:path";
import { discoverAllProjects, type GlobalDiscoveryResult } from "codespeak-vibe-share/sessions/global-discovery";
import { discoverAllSessions, type DiscoveryInput, type DiscoveryResult } from "codespeak-vibe-share/sessions/discovery";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";
import {
  openCache,
  getCachedSessionsForProject,
  type CachedSessionInfo,
} from "./cache-db";
import { extractMetadata } from "./session-metadata";
import type { AgentProvider, DiscoveredSession, ProjectContext } from "codespeak-vibe-share/sessions/types";

const TTL_MS = 30_000; // 30 seconds

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let projectsCache: CacheEntry<GlobalDiscoveryResult> | null = null;
const sessionsCache = new Map<string, CacheEntry<DiscoveryResult>>();

export async function cachedDiscoverAllProjects(): Promise<GlobalDiscoveryResult> {
  const now = Date.now();
  if (projectsCache && now - projectsCache.timestamp < TTL_MS) {
    return projectsCache.data;
  }
  const data = await discoverAllProjects();
  projectsCache = { data, timestamp: now };
  return data;
}

/**
 * Fast session discovery that uses SQLite cache as primary source.
 *
 * Strategy:
 * 1. Get all cached sessions for this project from SQLite (instant)
 * 2. Scan the session directory for JSONL files not yet cached
 * 3. Only parse uncached files (the slow part)
 * 4. Merge cached + freshly discovered sessions
 *
 * Falls back to full discovery if the fast path fails.
 */
export async function cachedDiscoverAllSessions(input: DiscoveryInput): Promise<DiscoveryResult> {
  const now = Date.now();
  const key = JSON.stringify(input);
  const cached = sessionsCache.get(key);
  if (cached && now - cached.timestamp < TTL_MS) {
    return cached.data;
  }

  let data: DiscoveryResult;
  try {
    data = await fastDiscoverSessions(input);
  } catch {
    // Fall back to full discovery
    data = await discoverAllSessions(input);
  }

  sessionsCache.set(key, { data, timestamp: now });
  return data;
}

async function fastDiscoverSessions(input: DiscoveryInput): Promise<DiscoveryResult> {
  const db = openCache();
  const projectPath = input.worktreePaths[0]!;

  // Step 1: Get sessions already in SQLite
  const cachedSessions = getCachedSessionsForProject(db, projectPath);
  const cachedFileSet = new Set(cachedSessions.map((s) => s.filePath));

  // Step 2: Find uncached JSONL files in the session directory
  const encoded = encodeProjectPath(projectPath);
  const sessionDir = path.join(CLAUDE_PROJECTS_DIR, encoded);
  const uncachedFiles: Array<{ sessionId: string; filePath: string }> = [];

  try {
    const dirEntries = await fs.readdir(sessionDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const filePath = path.join(sessionDir, entry.name);
      const sessionId = entry.name.replace(".jsonl", "");

      if (cachedFileSet.has(filePath)) {
        // Check if file changed (mtime mismatch)
        const cachedInfo = cachedSessions.find((s) => s.filePath === filePath);
        if (cachedInfo) {
          try {
            const stat = await fs.stat(filePath);
            if (stat.mtimeMs !== cachedInfo.mtimeMs) {
              uncachedFiles.push({ sessionId, filePath });
            }
          } catch {
            // File gone — skip
          }
        }
      } else {
        uncachedFiles.push({ sessionId, filePath });
      }
    }
  } catch {
    // Session dir doesn't exist — fall through with just cached data
  }

  // Step 3: Parse uncached files (the only slow part — only for new/changed files)
  // After extractMetadata caches entries, check cwd to verify project membership
  const belongsStmt = db.prepare(
    `SELECT 1 FROM entries
     WHERE file_path = ? AND (cwd = ? OR cwd LIKE ? || '/%')
     LIMIT 1`,
  );

  const freshSessions: Array<{ sessionId: string; info: CachedSessionInfo }> = [];
  await Promise.all(
    uncachedFiles.map(async ({ sessionId, filePath }) => {
      // extractMetadata handles caching internally (writes entries to SQLite)
      const metadata = await extractMetadata(sessionId, projectPath);
      if (metadata.messageCount === 0) return;

      // Check if any entry in this file has a matching cwd
      const match = belongsStmt.get(filePath, projectPath, projectPath);
      if (!match) return;

      freshSessions.push({
        sessionId,
        info: {
          filePath,
          sessionId,
          mtimeMs: 0,
          aiTitle: metadata.aiTitle,
          hasPlans: metadata.hasPlans,
          firstPlanLineIndex: metadata.firstPlanLineIndex,
          userPromptCount: metadata.userPromptCount,
          messageCount: metadata.messageCount,
          created: metadata.created,
          modified: metadata.modified,
          sizeBytes: metadata.sizeBytes,
        },
      });
    }),
  );

  // Step 4: Convert to DiscoveryResult format
  const allSessionInfos = [...cachedSessions, ...freshSessions.map((f) => f.info)];
  const sessions: DiscoveredSession[] = [];

  // For cached sessions, extract firstPrompt from entries table
  const firstPromptStmt = db.prepare(
    `SELECT json_extract(raw_json, '$.message.content') as content
     FROM entries
     WHERE file_path = ? AND type = 'user'
     ORDER BY line_index
     LIMIT 5`,
  );

  for (const info of allSessionInfos) {
    let firstPrompt: string | null = null;

    // Try to get firstPrompt from cached entries
    const rows = firstPromptStmt.all(info.filePath) as Array<{ content: string | null }>;
    for (const row of rows) {
      if (!row.content) continue;
      try {
        const content = JSON.parse(row.content) as Array<{ type: string; text?: string }>;
        // Skip pure tool_result messages
        if (content.length > 0 && content.every((b) => b.type === "tool_result")) continue;
        const textBlock = content.find((b) => b.type === "text");
        if (textBlock?.text) {
          firstPrompt = stripIdeTags(textBlock.text).slice(0, 200) || null;
          break;
        }
      } catch {
        // skip
      }
    }

    sessions.push({
      agentName: "Claude Code",
      sessionId: info.sessionId,
      summary: null,
      firstPrompt,
      messageCount: info.messageCount,
      created: info.created,
      modified: info.modified,
      sizeBytes: info.sizeBytes,
    });
  }

  // Run non-Claude agents directly (skip Claude Code to avoid re-discovery)
  const otherProviders = await getNonClaudeProviders();
  const otherResults = await Promise.all(
    otherProviders.map(async (p) => {
      const context: ProjectContext = {
        projectPath,
        gitRemoteUrl: input.gitRemoteUrl,
        allWorktreePaths: input.worktreePaths,
      };
      const found = await p.findSessions(context);
      return { provider: p, sessions: found };
    }),
  );

  const byAgent = new Map<string, { provider: AgentProvider; sessions: DiscoveredSession[] }>();

  if (sessions.length > 0) {
    byAgent.set("Claude Code", {
      provider: { name: "Claude Code", slug: "claude-code" } as AgentProvider,
      sessions,
    });
  }

  for (const result of otherResults) {
    if (result.sessions.length > 0) {
      byAgent.set(result.provider.name, result);
    }
  }

  let totalSessions = 0;
  for (const { sessions: s } of byAgent.values()) {
    totalSessions += s.length;
  }

  return { byAgent, totalSessions };
}

async function getNonClaudeProviders(): Promise<AgentProvider[]> {
  // Dynamically import to avoid loading all agents at top level
  const [
    { CursorProvider },
    { CodexProvider },
    { GeminiProvider },
    { ClineProvider },
  ] = await Promise.all([
    import("codespeak-vibe-share/sessions/agents/cursor"),
    import("codespeak-vibe-share/sessions/agents/codex"),
    import("codespeak-vibe-share/sessions/agents/gemini"),
    import("codespeak-vibe-share/sessions/agents/cline"),
  ]);

  const providers: AgentProvider[] = [
    new CursorProvider(),
    new CodexProvider(),
    new GeminiProvider(),
    new ClineProvider(),
  ];

  const results = await Promise.all(
    providers.map(async (p) => ({ provider: p, detected: await p.detect() })),
  );

  return results.filter((r) => r.detected).map((r) => r.provider);
}

function stripIdeTags(text: string): string {
  return text.replace(/<ide_\w+>[\s\S]*?<\/ide_\w+>/g, "").trim();
}
