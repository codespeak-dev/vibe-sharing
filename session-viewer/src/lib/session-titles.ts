import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";

/**
 * Extract the ai-title from a Claude Code session JSONL file.
 * Scans from the end of the file since ai-title is typically appended last.
 * Returns null if not found.
 */
async function extractAiTitle(
  sessionId: string,
  projectPath: string,
): Promise<string | null> {
  const filePath = await findSessionFile(sessionId, projectPath);
  if (!filePath) return null;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    // Scan lines from the end since ai-title is usually near the bottom
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      // Quick string check before parsing JSON
      if (!line.includes('"ai-title"')) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
          return obj.aiTitle;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // File unreadable
  }
  return null;
}

async function findSessionFile(
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
 * For a list of sessions, extract ai-titles in parallel.
 * Returns a map of sessionId -> aiTitle.
 */
export async function extractAiTitles(
  sessions: Array<{ sessionId: string; agentName: string }>,
  projectPath: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();

  // Only extract for Claude Code sessions
  const claudeSessions = sessions.filter((s) => s.agentName === "Claude Code");

  const results = await Promise.all(
    claudeSessions.map(async (s) => {
      const title = await extractAiTitle(s.sessionId, projectPath);
      return { sessionId: s.sessionId, title };
    }),
  );

  for (const { sessionId, title } of results) {
    if (title) {
      titles.set(sessionId, title);
    }
  }

  return titles;
}
