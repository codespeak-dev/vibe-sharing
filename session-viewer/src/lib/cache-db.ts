import Database from "better-sqlite3";
import path from "node:path";
import { CLAUDE_DIR } from "codespeak-vibe-share/config";
import type { SessionMetadata } from "./session-metadata";
import type { SessionEntry } from "../app/api/session-entries/route";

const DB_PATH = path.join(CLAUDE_DIR, ".session-viewer-cache.db");

let _db: Database.Database | null = null;

/** Open (or create) the cache database. Returns a singleton. */
export function openCache(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      file_path             TEXT PRIMARY KEY,
      session_id            TEXT NOT NULL,
      mtime_ms              INTEGER NOT NULL,
      ai_title              TEXT,
      has_plans             INTEGER NOT NULL DEFAULT 0,
      first_plan_line_index INTEGER,
      user_prompt_count     INTEGER NOT NULL DEFAULT 0,
      message_count         INTEGER NOT NULL DEFAULT 0,
      created               TEXT,
      modified              TEXT,
      size_bytes            INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_session_id
      ON sessions(session_id);

    CREATE TABLE IF NOT EXISTS entries (
      file_path   TEXT NOT NULL REFERENCES sessions(file_path) ON DELETE CASCADE,
      line_index  INTEGER NOT NULL,
      raw_json    TEXT NOT NULL,
      type        TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.type')) STORED,
      timestamp   TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.timestamp')) STORED,
      cwd         TEXT GENERATED ALWAYS AS (json_extract(raw_json, '$.cwd')) STORED,
      PRIMARY KEY (file_path, line_index)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_type
      ON entries(file_path, type);
    CREATE INDEX IF NOT EXISTS idx_entries_timestamp
      ON entries(timestamp);

    CREATE TABLE IF NOT EXISTS entry_tags (
      file_path   TEXT NOT NULL,
      line_index  INTEGER NOT NULL,
      tag         TEXT NOT NULL,
      FOREIGN KEY (file_path, line_index)
        REFERENCES entries(file_path, line_index) ON DELETE CASCADE,
      PRIMARY KEY (file_path, line_index, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_entry_tags_tag
      ON entry_tags(tag);

    CREATE INDEX IF NOT EXISTS idx_entries_cwd
      ON entries(cwd);
  `);

  return _db;
}

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

/** Get cached metadata if mtime matches. Returns null on miss. */
export function getSessionMetadata(
  db: Database.Database,
  filePath: string,
  currentMtimeMs: number,
): SessionMetadata | null {
  const row = db
    .prepare(
      `SELECT ai_title, has_plans, first_plan_line_index, user_prompt_count,
              message_count, created, modified, size_bytes, mtime_ms
       FROM sessions WHERE file_path = ?`,
    )
    .get(filePath) as
    | {
        ai_title: string | null;
        has_plans: number;
        first_plan_line_index: number | null;
        user_prompt_count: number;
        message_count: number;
        created: string | null;
        modified: string | null;
        size_bytes: number;
        mtime_ms: number;
      }
    | undefined;

  if (!row || row.mtime_ms !== currentMtimeMs) return null;

  return {
    aiTitle: row.ai_title,
    hasPlans: row.has_plans === 1,
    firstPlanLineIndex: row.first_plan_line_index,
    userPromptCount: row.user_prompt_count,
    messageCount: row.message_count,
    created: row.created,
    modified: row.modified,
    sizeBytes: row.size_bytes,
  };
}

/** Upsert session metadata into the cache. */
export function setSessionMetadata(
  db: Database.Database,
  filePath: string,
  sessionId: string,
  mtimeMs: number,
  metadata: SessionMetadata,
): void {
  db.prepare(
    `INSERT INTO sessions (file_path, session_id, mtime_ms, ai_title, has_plans,
       first_plan_line_index, user_prompt_count, message_count, created, modified, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       session_id = excluded.session_id,
       mtime_ms = excluded.mtime_ms,
       ai_title = excluded.ai_title,
       has_plans = excluded.has_plans,
       first_plan_line_index = excluded.first_plan_line_index,
       user_prompt_count = excluded.user_prompt_count,
       message_count = excluded.message_count,
       created = excluded.created,
       modified = excluded.modified,
       size_bytes = excluded.size_bytes`,
  ).run(
    filePath,
    sessionId,
    mtimeMs,
    metadata.aiTitle,
    metadata.hasPlans ? 1 : 0,
    metadata.firstPlanLineIndex,
    metadata.userPromptCount,
    metadata.messageCount,
    metadata.created,
    metadata.modified,
    metadata.sizeBytes,
  );
}

// ---------------------------------------------------------------------------
// Session entries
// ---------------------------------------------------------------------------

/** Check whether the cached entries for a file are still fresh. */
export function isSessionFresh(
  db: Database.Database,
  filePath: string,
  currentMtimeMs: number,
): boolean {
  const row = db
    .prepare(`SELECT mtime_ms FROM sessions WHERE file_path = ?`)
    .get(filePath) as { mtime_ms: number } | undefined;
  return row?.mtime_ms === currentMtimeMs;
}

/** Get total entry count for a session file. */
export function getEntryCount(
  db: Database.Database,
  filePath: string,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM entries WHERE file_path = ?`)
    .get(filePath) as { cnt: number };
  return row.cnt;
}

/** Get paginated entries from cache. */
export function getEntries(
  db: Database.Database,
  filePath: string,
  offset: number,
  limit: number,
): SessionEntry[] {
  const rows = db
    .prepare(
      `SELECT line_index, type, timestamp, raw_json
       FROM entries
       WHERE file_path = ?
       ORDER BY line_index
       LIMIT ? OFFSET ?`,
    )
    .all(filePath, limit, offset) as Array<{
    line_index: number;
    type: string;
    timestamp: string | null;
    raw_json: string;
  }>;

  return rows.map((r) => ({
    lineIndex: r.line_index,
    type: r.type ?? "unknown",
    timestamp: r.timestamp,
    raw: JSON.parse(r.raw_json),
  }));
}

/** Bulk-insert entries and their tags for a session file. Replaces any existing data. */
export function setEntries(
  db: Database.Database,
  filePath: string,
  entries: SessionEntry[],
): void {
  const insertEntry = db.prepare(
    `INSERT INTO entries (file_path, line_index, raw_json) VALUES (?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO entry_tags (file_path, line_index, tag) VALUES (?, ?, ?)`,
  );

  // Delete old entries (cascade deletes tags too)
  db.prepare(`DELETE FROM entries WHERE file_path = ?`).run(filePath);

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const rawJson = JSON.stringify(entry.raw);
      insertEntry.run(filePath, entry.lineIndex, rawJson);

      // Assign tags based on entry content
      const tags = computeTags(entry);
      for (const tag of tags) {
        insertTag.run(filePath, entry.lineIndex, tag);
      }
    }
  });
  tx();
}

// ---------------------------------------------------------------------------
// Project-level queries
// ---------------------------------------------------------------------------

export interface CachedSessionInfo {
  filePath: string;
  sessionId: string;
  mtimeMs: number;
  aiTitle: string | null;
  hasPlans: boolean;
  firstPlanLineIndex: number | null;
  userPromptCount: number;
  messageCount: number;
  created: string | null;
  modified: string | null;
  sizeBytes: number;
}

/**
 * Find all cached sessions whose entries have a cwd matching a project path.
 * This avoids re-reading JSONL files just to check cwd.
 */
export function getCachedSessionsForProject(
  db: Database.Database,
  projectPath: string,
): CachedSessionInfo[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.file_path, s.session_id, s.mtime_ms,
              s.ai_title, s.has_plans, s.first_plan_line_index,
              s.user_prompt_count, s.message_count, s.created, s.modified, s.size_bytes
       FROM sessions s
       WHERE EXISTS (
         SELECT 1 FROM entries e
         WHERE e.file_path = s.file_path
           AND (e.cwd = ? OR e.cwd LIKE ? || '/%')
       )`,
    )
    .all(projectPath, projectPath) as Array<{
    file_path: string;
    session_id: string;
    mtime_ms: number;
    ai_title: string | null;
    has_plans: number;
    first_plan_line_index: number | null;
    user_prompt_count: number;
    message_count: number;
    created: string | null;
    modified: string | null;
    size_bytes: number;
  }>;

  return rows.map((r) => ({
    filePath: r.file_path,
    sessionId: r.session_id,
    mtimeMs: r.mtime_ms,
    aiTitle: r.ai_title,
    hasPlans: r.has_plans === 1,
    firstPlanLineIndex: r.first_plan_line_index,
    userPromptCount: r.user_prompt_count,
    messageCount: r.message_count,
    created: r.created,
    modified: r.modified,
    sizeBytes: r.size_bytes,
  }));
}

/**
 * Get the set of all cached file paths, so we know which files to skip during discovery.
 */
export function getAllCachedFilePaths(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT file_path FROM sessions`)
    .all() as Array<{ file_path: string }>;
  return new Set(rows.map((r) => r.file_path));
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/** Remove a single session and all its entries/tags from cache. */
export function invalidateSession(
  db: Database.Database,
  filePath: string,
): void {
  // entries + tags cascade-deleted via FK
  db.prepare(`DELETE FROM sessions WHERE file_path = ?`).run(filePath);
}

/** Clear the entire cache. */
export function clearAll(db: Database.Database): void {
  db.exec(`DELETE FROM sessions`); // cascades to entries + tags
}

// ---------------------------------------------------------------------------
// Tagging logic
// ---------------------------------------------------------------------------

function computeTags(entry: SessionEntry): string[] {
  const tags: string[] = [];
  const raw = entry.raw;

  // Tag tool-result entries
  if (raw.type === "tool-result") {
    tags.push("tool-result");
  }

  // Tag tool uses within assistant messages
  if (raw.type === "assistant" && raw.message) {
    const content = (raw.message as { content?: unknown[] }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          (block as { type: string }).type === "tool_use" &&
          "name" in block
        ) {
          tags.push(`tool:${(block as { name: string }).name}`);
        }
      }
    }
  }

  // Tag plan references (any entry mentioning .claude/plans/)
  const rawJson = JSON.stringify(raw);
  if (rawJson.includes(".claude/plans/")) {
    tags.push("plan_reference");
  }

  // Tag result/completion entries
  if (raw.type === "result") {
    tags.push("task_completion");
  }

  return tags;
}
