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
  onSelect,
  onQuit,
}: ProjectListScreenProps) {
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    getFirstName().then(setFirstName).catch(() => setFirstName(null));
  }, []);

  const items: ListItem<string>[] = projects.map((p) => {
    const isShared = sharedPaths.has(p.path);
    const agents = p.agents
      .map((a) => {
        const agentSlug = a.toLowerCase().replace(/\s+/g, "-");
        const slug = Object.keys(p.sessionCounts).find(
          (s) => agentSlug.includes(s) || s.includes(agentSlug),
        );
        const count = slug ? p.sessionCounts[slug] : 0;
        return `${a} (${count})`;
      })
      .join("  ");

    return {
      label: shortenPath(p.path),
      value: p.path,
      dimmed: isShared,
      suffix: isShared ? "[Shared]" : agents,
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
