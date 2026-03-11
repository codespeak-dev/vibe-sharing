import { ClaudeCodeProvider } from "./agents/claude.js";
import { CodexProvider } from "./agents/codex.js";
import { GeminiProvider } from "./agents/gemini.js";
import { ClineProvider } from "./agents/cline.js";
import type { AgentProvider, DiscoveredSession } from "./types.js";

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
    new CodexProvider(),
    new GeminiProvider(),
    new ClineProvider(),
  ];
}

/**
 * Discover AI coding sessions for a project across all supported agents.
 * Scans all agents in parallel for speed.
 */
export async function discoverAllSessions(
  projectPath: string,
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

  // Find sessions from all installed agents, in parallel
  const results = await Promise.all(
    installedProviders.map(async (p) => ({
      provider: p,
      sessions: await p.findSessions(projectPath),
    })),
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
