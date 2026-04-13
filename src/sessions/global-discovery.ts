import { ClaudeCodeProvider } from "./agents/claude.js";
import { CodexProvider } from "./agents/codex.js";
import { GeminiProvider } from "./agents/gemini.js";
import { ClineProvider } from "./agents/cline.js";
import { CursorProvider, detectCursorInstalls } from "./agents/cursor.js";
import type { AgentProvider, DiscoveredProject } from "./types.js";
import { normalizePath, getGitWorktrees } from "../utils/paths.js";

export interface GlobalDiscoveryResult {
  projects: DiscoveredProject[];
}

/**
 * All supported agent providers, same order as discovery.ts.
 * Creates one CursorProvider per detected Cursor installation.
 */
async function getAllProviders(): Promise<AgentProvider[]> {
  const cursorInstalls = await detectCursorInstalls();
  const cursorProviders = cursorInstalls.length > 0
    ? cursorInstalls.map((install) => new CursorProvider(install))
    : [new CursorProvider()];

  return [
    new ClaudeCodeProvider(),
    ...cursorProviders,
    new CodexProvider(),
    new GeminiProvider(),
    new ClineProvider(),
  ];
}

/**
 * Discover all projects across all AI coding agents on the system.
 * Scans each agent's data directories to find project paths and session counts.
 */
export async function discoverAllProjects(
  onProgress?: (status: string) => void,
): Promise<GlobalDiscoveryResult> {
  const providers = await getAllProviders();

  onProgress?.("Detecting installed agents...");

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

  onProgress?.(`Found ${installedProviders.length} agents. Scanning projects...`);

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
    { path: string; agents: string[]; agentSlugs: string[]; sessionCounts: Record<string, number> }
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
          agentSlugs: [],
          sessionCounts: {},
        };
        projectMap.set(normalized, project);
      }
      if (!project.agents.includes(provider.name)) {
        project.agents.push(provider.name);
        project.agentSlugs.push(provider.slug);
      }
      project.sessionCounts[provider.slug] =
        (project.sessionCounts[provider.slug] ?? 0) + count;
    }
  }

  onProgress?.(`Found ${projectMap.size} projects. Merging worktrees...`);

  // Merge worktrees of the same repository into a single entry
  const processed = new Set<string>();
  let mergeCount = 0;
  const mergedMap = new Map<
    string,
    { path: string; agents: string[]; agentSlugs: string[]; sessionCounts: Record<string, number> }
  >();

  for (const [normalized, project] of projectMap) {
    if (processed.has(normalized)) continue;
    processed.add(normalized);
    mergeCount++;
    if (mergeCount % 10 === 0) {
      onProgress?.(`Merging worktrees (${mergeCount}/${projectMap.size})...`);
    }

    const merged = { ...project, agents: [...project.agents], agentSlugs: [...project.agentSlugs], sessionCounts: { ...project.sessionCounts } };

    try {
      const worktrees = await getGitWorktrees(project.path);
      // Use main worktree path (first entry) as canonical path
      if (worktrees.length > 0 && worktrees[0]!.path !== project.path) {
        merged.path = worktrees[0]!.path;
      }

      for (const wt of worktrees) {
        const wtNorm = normalizePath(wt.path);
        if (wtNorm === normalized) continue;
        const other = projectMap.get(wtNorm);
        if (other) {
          for (let i = 0; i < other.agents.length; i++) {
            if (!merged.agents.includes(other.agents[i]!)) {
              merged.agents.push(other.agents[i]!);
              merged.agentSlugs.push(other.agentSlugs[i]!);
            }
          }
          for (const [slug, count] of Object.entries(other.sessionCounts)) {
            merged.sessionCounts[slug] = (merged.sessionCounts[slug] ?? 0) + count;
          }
          processed.add(wtNorm);
        }
      }
    } catch {
      // Not a git repo — keep as-is
    }

    mergedMap.set(normalizePath(merged.path), merged);
  }

  // Sort by total session count (descending) so most active projects appear first
  const projects = [...mergedMap.values()]
    .sort((a, b) => {
      const totalA = Object.values(a.sessionCounts).reduce((sum, n) => sum + n, 0);
      const totalB = Object.values(b.sessionCounts).reduce((sum, n) => sum + n, 0);
      return totalB - totalA;
    })
    .map((p) => ({
      path: p.path,
      agents: p.agents,
      agentSlugs: p.agentSlugs,
      sessionCounts: p.sessionCounts,
    }));

  return { projects };
}
