import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { ScrollableList, type ListItem } from "../../components/scrollable-list.js";
import { Spinner } from "../../components/spinner.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export function GitTab({ projectPath, active = true, onBoundary }: GitTabProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Loading git info...");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

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
