import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import {
  openCache,
  isSessionFresh,
  getEntries,
  getEntryCount,
  loadAndCacheFile,
} from "@/lib/cache-db";
import { findSessionFile } from "@/lib/session-metadata";

export interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
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
      await loadAndCacheFile(db, filePath, sessionId);
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
