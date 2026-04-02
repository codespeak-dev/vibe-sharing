import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";

/**
 * Check whether a Claude Code session JSONL file references any plan files.
 * Looks for paths containing `.claude/plans/` in the session content.
 */
async function sessionHasPlans(
  sessionId: string,
  projectPath: string,
): Promise<boolean> {
  const filePath = await findSessionFile(sessionId, projectPath);
  if (!filePath) return false;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.includes(".claude/plans/");
  } catch {
    return false;
  }
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
 * For a list of sessions, detect which ones reference plan files.
 * Returns a Set of sessionIds that have plans.
 */
export async function detectSessionsWithPlans(
  sessions: Array<{ sessionId: string; agentName: string }>,
  projectPath: string,
): Promise<Set<string>> {
  const withPlans = new Set<string>();

  const claudeSessions = sessions.filter((s) => s.agentName === "Claude Code");

  const results = await Promise.all(
    claudeSessions.map(async (s) => {
      const hasPlans = await sessionHasPlans(s.sessionId, projectPath);
      return { sessionId: s.sessionId, hasPlans };
    }),
  );

  for (const { sessionId, hasPlans } of results) {
    if (hasPlans) {
      withPlans.add(sessionId);
    }
  }

  return withPlans;
}
