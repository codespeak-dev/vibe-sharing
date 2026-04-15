import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import os from "node:os";
import type { DiscoveredProject } from "../../sessions/types.js";
import { Header } from "../components/header.js";
import { KeyHint } from "../components/key-hint.js";
import { ScrollableList, type ListItem } from "../components/scrollable-list.js";
import { getFirstName } from "../../utils/user-info.js";

interface ProjectListScreenProps {
  projects: DiscoveredProject[];
  sharedPaths: Set<string>;
  currentProjectPath?: string;
  onSelect: (path: string) => void;
  onQuit: () => void;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

export function ProjectListScreen({
  projects,
  sharedPaths,
  currentProjectPath,
  onSelect,
  onQuit,
}: ProjectListScreenProps) {
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    getFirstName().then(setFirstName).catch(() => setFirstName(null));
  }, []);

  // Sort: current dir first, then original order
  const sorted = currentProjectPath
    ? [...projects].sort((a, b) => {
        if (a.path === currentProjectPath) return -1;
        if (b.path === currentProjectPath) return 1;
        return 0;
      })
    : projects;

  const items: ListItem<string>[] = sorted.map((p) => {
    const isShared = sharedPaths.has(p.path);
    const isCurrent = p.path === currentProjectPath;
    const agents = p.agents
      .map((a, i) => {
        const slug = p.agentSlugs[i];
        const count = slug !== undefined ? (p.sessionCounts[slug] ?? 0) : 0;
        return `${a} (${count})`;
      })
      .join("  ");

    const tag = isCurrent ? "(current dir)  " : "";
    return {
      label: shortenPath(p.path),
      value: p.path,
      dimmed: isShared,
      suffix: isShared ? "[Shared]" : tag + agents,
    };
  });

  if (projects.length === 0) {
    return (
      <Box flexDirection="column">
        <Header firstName={firstName} />
        <Text dimColor>No projects with AI coding sessions found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header firstName={firstName} />
      <Text bold>{sharedPaths.size > 0 ? "Share another project:" : "Discovered projects:"}</Text>
      <Box marginTop={1}>
        <ScrollableList
          items={items}
          onSelect={onSelect}
          onKey={(input) => {
            if (input === "q" || input === "Q") {
              onQuit();
              return true;
            }
            return false;
          }}
        />
      </Box>
      <KeyHint
        hints={[
          { key: "↑↓", label: "navigate" },
          { key: "Enter", label: "select", primary: true },
          { key: "Q", label: "quit" },
        ]}
      />
    </Box>
  );
}
