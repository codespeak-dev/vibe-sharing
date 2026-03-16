import { ClaudeCodeProvider } from "./agents/claude.js";
import { CodexProvider } from "./agents/codex.js";
import { GeminiProvider } from "./agents/gemini.js";
import { ClineProvider } from "./agents/cline.js";
import { CursorProvider } from "./agents/cursor.js";
import type { AgentProvider, DiscoveredProject } from "./types.js";
import { normalizePath } from "../utils/paths.js";

export interface GlobalDiscoveryResult {
  projects: DiscoveredProject[];
}

/**
 * All supported agent providers, same order as discovery.ts.
 */
function getAllProviders(): AgentProvider[] {
  return [
    new ClaudeCodeProvider(),
    new CursorProvider(),
    new CodexProvider(),
    new GeminiProvider(),
    new ClineProvider(),
  ];
}

/**
 * Discover all projects across all AI coding agents on the system.
 * Scans each agent's data directories to find project paths and session counts.
 */
export async function discoverAllProjects(): Promise<GlobalDiscoveryResult> {
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

  // Discover projects from all installed agents in parallel
  const perAgent = await Promise.all(
    installedProviders.map(async (p) => {
      const projects = await p.discoverProjects();
      return { provider: p, projects };
    }),
  );

  // Merge by normalized path
  const projectMap = new Map<
    string,
    { path: string; agents: string[]; sessionCounts: Record<string, number> }
  >();

  for (const { provider, projects } of perAgent) {
    for (const [rawPath, count] of projects) {
      if (count <= 0) continue;

      const normalized = normalizePath(rawPath);
      let project = projectMap.get(normalized);
      if (!project) {
        project = {
          path: rawPath, // Keep original casing
          agents: [],
          sessionCounts: {},
        };
        projectMap.set(normalized, project);
      }
      if (!project.agents.includes(provider.name)) {
        project.agents.push(provider.name);
      }
      project.sessionCounts[provider.slug] =
        (project.sessionCounts[provider.slug] ?? 0) + count;
    }
  }

  // Sort by total session count (descending) so most active projects appear first
  const projects = [...projectMap.values()]
    .sort((a, b) => {
      const totalA = Object.values(a.sessionCounts).reduce((sum, n) => sum + n, 0);
      const totalB = Object.values(b.sessionCounts).reduce((sum, n) => sum + n, 0);
      return totalB - totalA;
    })
    .map((p) => ({
      path: p.path,
      agents: p.agents,
      sessionCounts: p.sessionCounts,
    }));

  return { projects };
}
