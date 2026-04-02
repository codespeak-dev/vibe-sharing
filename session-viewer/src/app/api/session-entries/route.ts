import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";

export interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

interface CacheEntry {
  mtime: number;
  entries: SessionEntry[];
}

// Simple in-memory cache keyed by file path
const cache = new Map<string, CacheEntry>();

async function findSessionFile(
  sessionId: string,
  projectPath: string,
): Promise<string | null> {
  // Try primary encoded path first
  const encoded = encodeProjectPath(projectPath);
  const primary = path.join(CLAUDE_PROJECTS_DIR, encoded, `${sessionId}.jsonl`);
  try {
    await fs.access(primary);
    return primary;
  } catch {}

  // Fallback: scan all project directories (session UUIDs are globally unique)
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

async function loadEntries(filePath: string): Promise<SessionEntry[]> {
  // Check cache by mtime
  const stat = await fs.stat(filePath);
  const mtime = stat.mtimeMs;
  const cached = cache.get(filePath);
  if (cached && cached.mtime === mtime) {
    return cached.entries;
  }

  const content = await fs.readFile(filePath, "utf-8");
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

  cache.set(filePath, { mtime, entries });
  return entries;
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
    const allEntries = await loadEntries(filePath);
    const slice = allEntries.slice(offset, offset + limit);
    return Response.json({
      entries: slice,
      total: allEntries.length,
      hasMore: offset + limit < allEntries.length,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to read session", detail: String(err) },
      { status: 500 },
    );
  }
}
