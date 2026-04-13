import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";
import {
  openCache,
  getSessionMetadata,
  setSessionMetadata,
  setEntries,
  isSessionFresh,
} from "./cache-db";
import type { SessionEntry } from "../app/api/session-entries/route";

export interface SessionMetadata {
  aiTitle: string | null;
  hasPlans: boolean;
  /** Line index of the first entry that references a plan file, or null */
  firstPlanLineIndex: number | null;
  userPromptCount: number;
  /** Total number of entries (non-empty lines) in the session */
  messageCount: number;
  /** Timestamp of the first entry */
  created: string | null;
  /** Timestamp of the last entry */
  modified: string | null;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * Extract metadata from a single Claude Code session JSONL.
 * Checks SQLite cache first; on miss, parses the file in a single pass
 * and populates both the metadata and entries cache.
 */
export async function extractMetadata(
  sessionId: string,
  projectPath: string,
): Promise<SessionMetadata> {
  const empty: SessionMetadata = {
    aiTitle: null, hasPlans: false, firstPlanLineIndex: null,
    userPromptCount: 0, messageCount: 0, created: null, modified: null, sizeBytes: 0,
  };

  const filePath = await findSessionFile(sessionId, projectPath);
  if (!filePath) return empty;

  const db = openCache();

  // Check cache by mtime
  try {
    const stat = await fs.stat(filePath);
    const mtimeMs = stat.mtimeMs;

    const cached = getSessionMetadata(db, filePath, mtimeMs);
    if (cached) return cached;

    // Cache miss — parse file in one pass, store metadata + entries
    const { metadata, entries } = await parseSessionFile(filePath);
    setSessionMetadata(db, filePath, sessionId, mtimeMs, metadata);
    setEntries(db, filePath, entries);

    return metadata;
  } catch {
    return empty;
  }
}

/**
 * Parse a JSONL session file in a single pass, producing both metadata and entries.
 */
async function parseSessionFile(
  filePath: string,
): Promise<{ metadata: SessionMetadata; entries: SessionEntry[] }> {
  const metadata: SessionMetadata = {
    aiTitle: null, hasPlans: false, firstPlanLineIndex: null,
    userPromptCount: 0, messageCount: 0, created: null, modified: null, sizeBytes: 0,
  };
  const entries: SessionEntry[] = [];

  const content = await fs.readFile(filePath, "utf-8");
  metadata.sizeBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");

  let lineIndex = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      lineIndex++;
      continue;
    }

    const type = (parsed.type as string) ?? "unknown";
    const timestamp = (parsed.timestamp as string) ?? null;

    // Collect entry for entries table
    entries.push({ lineIndex, type, timestamp, raw: parsed });

    // Track timestamps
    if (timestamp) {
      if (!firstTimestamp) firstTimestamp = timestamp;
      lastTimestamp = timestamp;
    }

    // Detect plan references
    if (!metadata.hasPlans && line.includes(".claude/plans/") && line.includes('"tool_use"')) {
      const blocks: Array<{ type: string; input?: { file_path?: string } }> =
        (parsed.message as { content?: unknown[] })?.content as
          Array<{ type: string; input?: { file_path?: string } }> ?? [];
      const planBlock = blocks.find(
        (b) =>
          b.type === "tool_use" &&
          typeof b.input?.file_path === "string" &&
          b.input.file_path.includes(".claude/plans/"),
      );
      if (planBlock) {
        metadata.hasPlans = true;
        metadata.firstPlanLineIndex = lineIndex;
      }
    }

    // Count user prompts that aren't pure tool_result messages
    if (type === "user") {
      const blocks: Array<{ type: string }> =
        (parsed.message as { content?: Array<{ type: string }> })?.content ?? [];
      const allToolResult =
        blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
      if (!allToolResult) {
        metadata.userPromptCount++;
      }
    }

    // Track ai-title (last one wins — replaces the old reverse pass)
    if (type === "ai-title" && typeof (parsed as { aiTitle?: unknown }).aiTitle === "string") {
      metadata.aiTitle = (parsed as { aiTitle: string }).aiTitle;
    }

    lineIndex++;
  }

  metadata.messageCount = lineIndex;
  metadata.created = firstTimestamp;
  metadata.modified = lastTimestamp;

  return { metadata, entries };
}

export async function findSessionFile(
  sessionId: string,
  projectPath: string,
): Promise<string | null> {
  const encoded = encodeProjectPath(projectPath);
  const primary = path.join(CLAUDE_PROJECTS_DIR, encoded, `${sessionId}.jsonl`);
  try {
    await fs.access(primary);
    return primary;
  } catch {}

  try {
    const dirs = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const candidate = path.join(CLAUDE_PROJECTS_DIR, dir.name, `${sessionId}.jsonl`);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  } catch {}

  return null;
}

/**
 * Extract metadata for all Claude Code sessions.
 * Uses SQLite cache — only re-parses sessions whose files have changed.
 * Returns a map of sessionId -> SessionMetadata.
 */
export async function extractAllSessionMetadata(
  sessions: Array<{ sessionId: string; agentName: string }>,
  projectPath: string,
): Promise<Map<string, SessionMetadata>> {
  const metadataMap = new Map<string, SessionMetadata>();

  const claudeSessions = sessions.filter((s) => s.agentName === "Claude Code");

  const results = await Promise.all(
    claudeSessions.map(async (s) => {
      const metadata = await extractMetadata(s.sessionId, projectPath);
      return { sessionId: s.sessionId, metadata };
    }),
  );

  for (const { sessionId, metadata } of results) {
    metadataMap.set(sessionId, metadata);
  }

  return metadataMap;
}
