import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import os from "node:os";
import type { DiscoveredProject } from "../../sessions/types.js";
import { Header } from "../components/header.js";
import { ActionBar } from "../components/action-bar.js";
import { getGitRemoteUrl, getGitWorktrees, type GitWorktree } from "../../utils/paths.js";
import { getProjectStats, type ProjectStats } from "../../utils/project-stats.js";
import { getFirstName } from "../../utils/user-info.js";

interface ShareProjectScreenProps {
  projectPath: string;
  projects: DiscoveredProject[];
  showHeader?: boolean;
  onShare: () => void;
  onReview: () => void;
  onBack: () => void;
  onAllProjects: () => void;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

export function ShareProjectScreen({
  projectPath,
  projects,
  showHeader = false,
  onShare,
  onReview,
  onBack,
  onAllProjects,
}: ShareProjectScreenProps) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const { stdout } = useStdout();
  const width = Math.min(60, (stdout.columns ?? 80) - 4);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getProjectStats(projectPath),
      getGitRemoteUrl(projectPath).catch(() => null),
      showHeader ? getFirstName() : Promise.resolve(null),
      getGitWorktrees(projectPath).catch(() => [{ path: projectPath, branch: null }] as GitWorktree[]),
    ]).then(([s, url, name, wt]) => {
      if (cancelled) return;
      setStats(s);
      setRepoUrl(url);
      setFirstName(name);
      setWorktrees(wt);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath, showHeader]);

  // Aggregate sessions across all worktrees
  const worktreePaths = new Set(worktrees.map((wt) => wt.path));
  const relatedProjects = projects.filter((p) => worktreePaths.has(p.path));
  const aggregatedAgents = new Set<string>();
  const aggregatedCounts: Record<string, number> = {};
  for (const rp of relatedProjects) {
    for (const agent of rp.agents) aggregatedAgents.add(agent);
    for (const [slug, count] of Object.entries(rp.sessionCounts)) {
      aggregatedCounts[slug] = (aggregatedCounts[slug] ?? 0) + count;
    }
  }
  // Fall back to direct match if no worktree aggregation
  const directProject = projects.find((p) => p.path === projectPath);
  const effectiveAgents = aggregatedAgents.size > 0 ? [...aggregatedAgents] : directProject?.agents ?? [];
  const effectiveCounts = Object.keys(aggregatedCounts).length > 0 ? aggregatedCounts : directProject?.sessionCounts ?? {};

  const separator = "─".repeat(width);

  return (
    <Box flexDirection="column">
      {showHeader && <Header firstName={firstName} />}
      <Text bold color="cyan">
        {shortenPath(projectPath)}
      </Text>
      {repoUrl && <Text dimColor>{repoUrl}</Text>}
      {worktrees.length > 1 && (
        <Text dimColor>{worktrees.length} worktrees</Text>
      )}
      <Text dimColor>{separator}</Text>

      {/* Agent sessions */}
      {effectiveAgents.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Agents</Text>
          {effectiveAgents.map((agent) => {
            const slug = Object.keys(effectiveCounts).find((s) =>
              agent.toLowerCase().replace(/\s+/g, "-").includes(s) ||
              s.includes(agent.toLowerCase().replace(/\s+/g, "-")),
            );
            const count = slug ? effectiveCounts[slug] : 0;
            return (
              <Text key={agent}>
                {"  "}
                {agent.padEnd(16)}
                <Text color="cyan" bold>{count}</Text>
                {" "}session{count !== 1 ? "s" : ""}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Code stats */}
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>Loading project stats...</Text>
        </Box>
      )}
      {stats && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Code</Text>
          {stats.languages.map((lang) => (
            <Text key={lang.name}>
              {"  "}
              {lang.name.padEnd(16)}
              {String(lang.files).padStart(5)} files
              {"  "}
              {lang.loc.toLocaleString().padStart(8)} LOC
              {"  "}
              <Text dimColor>{lang.percent.toFixed(1).padStart(5)}%</Text>
            </Text>
          ))}
          {stats.languages.length > 0 && (
            <Text dimColor>
              {"  "}
              {"Total".padEnd(16)}
              {String(stats.totalFiles).padStart(5)} files
              {"  "}
              {stats.totalLoc.toLocaleString().padStart(8)} LOC
            </Text>
          )}
        </Box>
      )}

      {/* Git stats */}
      {stats && stats.isGitRepo && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Git</Text>
          <Text>  Branches: <Text color="cyan" bold>{stats.branchCount}</Text></Text>
          <Text>
            {"  "}Commits: <Text color="cyan" bold>{stats.commitCount}</Text> (across all branches)
          </Text>
          {stats.activitySummary && (
            <Text>  Activity: {stats.activitySummary}</Text>
          )}
          <Text>  Untracked: {stats.untrackedCount} files</Text>
          <Text>  Uncommitted: {stats.uncommittedCount} files</Text>
        </Box>
      )}

      <ActionBar
        actions={[
          { label: "Share", onAction: onShare, primary: true },
          { label: "Review", onAction: onReview },
          { label: "All Projects", onAction: onAllProjects },
        ]}
        onEsc={onAllProjects}
      />
      <Text dimColor>  {"←→"} navigate   Enter select   Esc back</Text>
    </Box>
  );
}
