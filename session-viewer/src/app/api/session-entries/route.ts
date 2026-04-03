import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import {
  openCache,
  isSessionFresh,
  getEntries,
  getEntryCount,
  setEntries,
  setSessionMetadata,
} from "@/lib/cache-db";
import { findSessionFile } from "@/lib/session-metadata";

export interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

/**
 * Parse a JSONL file into SessionEntry[].
 * Also stores results in SQLite so subsequent requests are instant.
 */
async function loadAndCacheEntries(
  filePath: string,
  sessionId: string,
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const stat = await fs.stat(filePath);
  const entries: SessionEntry[] = [];
  let lineIndex = 0;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      entries.push({
        lineIndex,
        type: obj.type ?? "unknown",
        timestamp: obj.timestamp ?? null,
        raw: obj,
      });
    } catch {
      // Skip unparseable lines
    }
    lineIndex++;
  }

  const db = openCache();

  // Ensure a sessions row exists so the FK on entries is satisfied.
  // Use a minimal upsert that only sets mtime (metadata extraction fills the rest).
  db.prepare(
    `INSERT INTO sessions (file_path, session_id, mtime_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET mtime_ms = excluded.mtime_ms`,
  ).run(filePath, sessionId, stat.mtimeMs);

  setEntries(db, filePath, entries);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const encodedProjectPath = searchParams.get("projectPath");
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = parseInt(searchParams.get("limit") ?? "100", 10);

  if (!sessionId || !encodedProjectPath) {
    return Response.json(
      { error: "sessionId and projectPath are required" },
      { status: 400 },
    );
  }

  const projectPath = Buffer.from(encodedProjectPath, "base64url").toString("utf-8");

  const filePath = await findSessionFile(sessionId, projectPath);
  if (!filePath) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const db = openCache();
    const stat = await fs.stat(filePath);

    // If cache is stale or empty, re-ingest
    if (!isSessionFresh(db, filePath, stat.mtimeMs)) {
      await loadAndCacheEntries(filePath, sessionId);
    }

    // Serve from SQLite — pagination handled by SQL
    const entries = getEntries(db, filePath, offset, limit);
    const total = getEntryCount(db, filePath);

    return Response.json({
      entries,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to read session", detail: String(err) },
      { status: 500 },
    );
  }
}
