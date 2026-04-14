/**
 * Aggregate session discovery across all agent handles.
 */
import type { AgentHandle, DiscoveredProject, DiscoveredSession } from "./types.js";
import {
  discoverClaudeProjects, findClaudeSessions,
  discoverClaudeProjectFromDir, findClaudeSessionsFromDir,
} from "./providers/claude.js";
import { discoverCursorProjects, findCursorSessions } from "./providers/cursor.js";
import { discoverCodexProjects, findCodexSessions } from "./providers/codex.js";

/**
 * Discover all projects across all granted agent directories.
 * Merges results by project path; projects appearing in multiple agents are combined.
 */
export async function discoverAllProjects(
  handles: AgentHandle[],
): Promise<DiscoveredProject[]> {
  const projectMap = new Map<
    string,
    { agents: string[]; agentSlugs: string[]; sessionCounts: Record<string, number> }
  >();

  const merge = (path: string, agentName: string, slug: string, count: number) => {
    let entry = projectMap.get(path);
    if (!entry) {
      entry = { agents: [], agentSlugs: [], sessionCounts: {} };
      projectMap.set(path, entry);
    }
    if (!entry.agents.includes(agentName)) {
      entry.agents.push(agentName);
      entry.agentSlugs.push(slug);
    }
    entry.sessionCounts[slug] = (entry.sessionCounts[slug] ?? 0) + count;
  };

  await Promise.all(
    handles.map(async (ah) => {
      try {
        let projects: Map<string, number>;
        if (ah.slug === "claude") {
          projects = await discoverClaudeProjects(ah.handle);
        } else if (ah.slug === "claude-project") {
          projects = await discoverClaudeProjectFromDir(ah.handle);
        } else if (ah.slug === "codex") {
          projects = await discoverCodexProjects(ah.handle);
        } else {
          // cursor or cursor-work-profile: handle is the "User" dir
          projects = await discoverCursorProjects(ah.handle, ah.name);
        }
        for (const [path, count] of projects) {
          if (count > 0) merge(path, ah.name, ah.slug, count);
        }
      } catch {
        // Never let one provider crash the whole discovery
      }
    }),
  );

  return [...projectMap.entries()]
    .map(([path, data]) => ({ path, ...data }))
    .sort((a, b) => {
      const sumA = Object.values(a.sessionCounts).reduce((s, n) => s + n, 0);
      const sumB = Object.values(b.sessionCounts).reduce((s, n) => s + n, 0);
      return sumB - sumA;
    });
}

/**
 * Find all sessions for a specific project across all agent handles.
 * Deduplicates by sessionId within each agent.
 */
export async function findProjectSessions(
  handles: AgentHandle[],
  projectPath: string,
): Promise<DiscoveredSession[]> {
  const allSessions: DiscoveredSession[] = [];
  const seenBySlug = new Map<string, Set<string>>();

  await Promise.all(
    handles.map(async (ah) => {
      try {
        let sessions: DiscoveredSession[];
        if (ah.slug === "claude") {
          sessions = await findClaudeSessions(ah.handle, projectPath);
        } else if (ah.slug === "claude-project") {
          sessions = await findClaudeSessionsFromDir(ah.handle, projectPath);
        } else if (ah.slug === "codex") {
          sessions = await findCodexSessions(ah.handle, projectPath);
        } else {
          sessions = await findCursorSessions(ah.handle, projectPath, ah.name, ah.slug);
        }

        const seen = seenBySlug.get(ah.slug) ?? new Set<string>();
        seenBySlug.set(ah.slug, seen);

        for (const s of sessions) {
          if (!seen.has(s.sessionId)) {
            seen.add(s.sessionId);
            allSessions.push(s);
          }
        }
      } catch {
        // skip
      }
    }),
  );

  return allSessions;
}
