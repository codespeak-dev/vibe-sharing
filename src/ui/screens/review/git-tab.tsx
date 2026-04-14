import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { ScrollableList, type ListItem } from "../../components/scrollable-list.js";
import { Spinner } from "../../components/spinner.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverAllSessions } from "../../../sessions/discovery.js";
import { getGitRemoteUrl, getGitWorktrees } from "../../../utils/paths.js";
import { computeCommitCoverage, computeWriteFileCoverage } from "../../../completeness/metrics.js";
import type { DiscoveredSession } from "../../../sessions/types.js";

const execFileAsync = promisify(execFile);

interface GitTabProps {
  projectPath: string;
  active?: boolean;
  onBoundary?: (direction: "up" | "down") => void;
}

interface BranchInfo {
  name: string;
  commits: string[];
}

interface CoverageMetrics {
  commitCoverage: number | null;
  writeFileCoverage: number | null;
  writeCodeFileCoverage: number | null;
  writeFileWeightedCoverage: number | null;
  writeCodeFileWeightedCoverage: number | null;
}

function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function GitTab({ projectPath, active = true, onBoundary }: GitTabProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Loading git info...");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CoverageMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Get branches
        const { stdout: branchOut } = await execFileAsync(
          "git",
          ["branch", "-a", "--format=%(refname:short)"],
          { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
        );

        const branchNames = branchOut
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(0, 50); // Limit to 50 branches

        if (cancelled) return;

        // Get recent commits for each branch (up to 20)
        const results: BranchInfo[] = [];
        for (let bi = 0; bi < branchNames.length; bi++) {
          const name = branchNames[bi]!;
          if (cancelled) return;
          setLoadingStatus(`Loading branch ${bi + 1} of ${branchNames.length}...`);
          try {
            const { stdout: logOut } = await execFileAsync(
              "git",
              ["log", "--oneline", "-20", name, "--"],
              { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
            );
            results.push({
              name,
              commits: logOut.trim().split("\n").filter(Boolean),
            });
          } catch {
            results.push({ name, commits: [] });
          }
        }

        if (!cancelled) {
          setBranches(results);
          if (results.length > 0) setSelectedBranch(results[0]!.name);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const worktrees = await getGitWorktrees(projectPath).catch(() => [
          { path: projectPath, branch: null },
        ]);
        const gitRemoteUrl = await getGitRemoteUrl(projectPath).catch(() => null);

        const discovery = await discoverAllSessions({
          worktreePaths: worktrees.map((wt) => wt.path),
          gitRemoteUrl,
        });

        if (cancelled) return;

        // Collect all sessions from all agents for commit coverage timestamps
        const allSessions: Array<Pick<DiscoveredSession, "created" | "modified">> = [];
        const allJsonlPaths: string[] = [];

        for (const { provider, sessions } of discovery.byAgent.values()) {
          allSessions.push(...sessions);
          if (provider.getProviderFiles) {
            const files = await provider.getProviderFiles();
            for (const f of files) {
              if (f.endsWith(".jsonl")) allJsonlPaths.push(f);
            }
          }
        }

        if (cancelled) return;

        const [commitCoverage, wfc] = await Promise.all([
          computeCommitCoverage(projectPath, allSessions),
          computeWriteFileCoverage(projectPath, allJsonlPaths),
        ]);

        if (!cancelled) {
          setMetrics({
            commitCoverage,
            writeFileCoverage: wfc.all,
            writeCodeFileCoverage: wfc.code,
            writeFileWeightedCoverage: wfc.allWeighted,
            writeCodeFileWeightedCoverage: wfc.codeWeighted,
          });
          setMetricsLoading(false);
        }
      } catch {
        if (!cancelled) setMetricsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (loading) return <Spinner label={loadingStatus} />;

  if (branches.length === 0) {
    return <Text dimColor>No branches found.</Text>;
  }

  const branchItems: ListItem<string>[] = branches.map((b) => ({
    label: b.name,
    value: b.name,
    suffix: `(${b.commits.length} commits)`,
  }));

  const selected = branches.find((b) => b.name === selectedBranch);

  return (
    <Box flexDirection="column">
      {/* Coverage metrics */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">Coverage</Text>
        {metricsLoading ? (
          <Text dimColor>  Computing...</Text>
        ) : (
          <>
            <Text>
              {"  "}{"Commits".padEnd(22)}
              <Text color="cyan" bold>{formatPercent(metrics?.commitCoverage ?? null)}</Text>
              <Text dimColor>  vibed / total</Text>
            </Text>
            <Text>
              {"  "}{"Files (all)".padEnd(22)}
              <Text color="cyan" bold>{formatPercent(metrics?.writeFileCoverage ?? null)}</Text>
              {metrics?.writeFileWeightedCoverage != null && (
                <><Text dimColor> / </Text><Text color="cyan">{formatPercent(metrics.writeFileWeightedCoverage)}w</Text></>
              )}
              <Text dimColor>  files / lines</Text>
            </Text>
            <Text>
              {"  "}{"Files (code only)".padEnd(22)}
              <Text color="cyan" bold>{formatPercent(metrics?.writeCodeFileCoverage ?? null)}</Text>
              {metrics?.writeCodeFileWeightedCoverage != null && (
                <><Text dimColor> / </Text><Text color="cyan">{formatPercent(metrics.writeCodeFileWeightedCoverage)}w</Text></>
              )}
              <Text dimColor>  files / lines</Text>
            </Text>
          </>
        )}
      </Box>

      <Text bold>Branches ({branches.length}):</Text>
      <ScrollableList
        items={branchItems}
        onSelect={(name) => setSelectedBranch(name)}
        pageSize={10}
        active={active}
        onBoundary={onBoundary}
      />

      {selected && selected.commits.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Recent commits on {selected.name}:
          </Text>
          {selected.commits.slice(0, 15).map((commit, i) => (
            <Text key={i} dimColor>
              {"  "}
              {commit}
            </Text>
          ))}
          {selected.commits.length > 15 && (
            <Text dimColor>  ... and {selected.commits.length - 15} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
