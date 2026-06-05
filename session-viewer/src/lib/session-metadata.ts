import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "codespeak-vibe-share/config";
import { encodeProjectPath } from "codespeak-vibe-share/utils/paths";

export interface SessionMetadata {
  aiTitle: string | null;
  hasPlans: boolean;
  userPromptCount: number;
}

/**
 * Extract metadata from a single Claude Code session JSONL in one pass:
 * - ai-title (scanned from end)
 * - whether it references plan files
 * - count of user prompts that are not pure tool-result messages
 */
async function extractMetadata(
  sessionId: string,
  projectPath: string,
): Promise<SessionMetadata> {
  const result: SessionMetadata = { aiTitle: null, hasPlans: false, userPromptCount: 0 };

  const filePath = await findSessionFile(sessionId, projectPath);
  if (!filePath) return result;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    // Forward pass: detect plans and count user prompts
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (!result.hasPlans && line.includes(".claude/plans/")) {
        result.hasPlans = true;
      }

      // Count user prompts that aren't pure tool_result messages
      if (line.includes('"user"')) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "user") {
            const blocks: Array<{ type: string }> = obj.message?.content ?? [];
            const allToolResult =
              blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
            if (!allToolResult) {
              result.userPromptCount++;
            }
          }
        } catch {
          // skip
        }
      }
    }

    // Reverse pass for ai-title (usually near the end)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      if (!line.includes('"ai-title"')) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
          result.aiTitle = obj.aiTitle;
          break;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // File unreadable
  }

  return result;
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
 * Extract metadata for all Claude Code sessions in parallel.
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
