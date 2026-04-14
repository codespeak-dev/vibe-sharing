import { ClaudeCodeProvider } from "./agents/claude.js";
import { CodexProvider } from "./agents/codex.js";
import { GeminiProvider } from "./agents/gemini.js";
import { ClineProvider } from "./agents/cline.js";
import { CursorProvider } from "./agents/cursor.js";
import { OpenCodeProvider } from "./agents/opencode.js";
import type { AgentProvider, DiscoveredSession, ProjectContext } from "./types.js";

export interface DiscoveryInput {
  worktreePaths: string[];
  gitRemoteUrl: string | null;
}

export interface DiscoveryResult {
  /** Agent name → sessions found */
  byAgent: Map<string, { provider: AgentProvider; sessions: DiscoveredSession[] }>;
  /** Total sessions found across all agents */
  totalSessions: number;
}

/**
 * All supported agent providers, in order of popularity/likelihood.
 */
function getAllProviders(): AgentProvider[] {
  return [
    new ClaudeCodeProvider(),
    new CursorProvider(),
    new CodexProvider(),
    new GeminiProvider(),
    new ClineProvider(),
    new OpenCodeProvider(),
  ];
}

/**
 * Discover AI coding sessions for a project across all supported agents.
 * Accepts worktree paths and an optional git remote URL for cross-clone matching.
 * Scans all agents in parallel for speed.
 */
export async function discoverAllSessions(
  input: DiscoveryInput,
): Promise<DiscoveryResult> {
  const providers = getAllProviders();

  // Detect which agents are installed, in parallel
  const detections = await Promise.all(
    providers.map(async (p) => ({
      provider: p,
      detected: await p.detect(),
    })),
  );

  const installedProviders = detections
    .filter((d) => d.detected)
    .map((d) => d.provider);

  // Find sessions from all installed agents × all project paths, in parallel
  const results = await Promise.all(
    installedProviders.map(async (p) => {
      const seenIds = new Set<string>();
      const merged: DiscoveredSession[] = [];

      for (const worktreePath of input.worktreePaths) {
        const context: ProjectContext = {
          projectPath: worktreePath,
          gitRemoteUrl: input.gitRemoteUrl,
          allWorktreePaths: input.worktreePaths,
        };
        const sessions = await p.findSessions(context);
        for (const s of sessions) {
          if (!seenIds.has(s.sessionId)) {
            seenIds.add(s.sessionId);
            merged.push(s);
          }
        }
      }

      return { provider: p, sessions: merged };
    }),
  );

  const byAgent = new Map<
    string,
    { provider: AgentProvider; sessions: DiscoveredSession[] }
  >();
  let totalSessions = 0;

  for (const result of results) {
    if (result.sessions.length > 0) {
      byAgent.set(result.provider.name, result);
      totalSessions += result.sessions.length;
    }
  }

  return { byAgent, totalSessions };
}
