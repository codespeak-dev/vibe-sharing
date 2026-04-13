import React, { useState } from "react";
import { Box, Text } from "ink";
import { SESSION_PREVIEW_ENABLED } from "../../../config.js";
import { ScrollableList, type ListItem } from "../../components/scrollable-list.js";
import { AgentTab } from "./agent-tab.js";
import type { DiscoveredProject } from "../../../sessions/types.js";

interface SessionsTabProps {
  project: DiscoveredProject;
  active?: boolean;
  onPreviewChange?: (active: boolean) => void;
  onBoundary?: (direction: "up" | "down") => void;
}

export function SessionsTab({ project, active = true, onPreviewChange, onBoundary }: SessionsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const agents = project.agents.map((agent, i) => {
    const slug = project.agentSlugs[i] ?? agent;
    const count = project.sessionCounts[slug] ?? 0;
    return { name: agent, slug, count };
  });

  // When preview is disabled, show static counts only
  if (!SESSION_PREVIEW_ENABLED) {
    return (
      <Box flexDirection="column">
        <Text bold>Agents</Text>
        {agents.map((a) => (
          <Text key={a.slug}>
            {"  "}
            {a.name.padEnd(16)}
            <Text color="cyan" bold>{a.count}</Text>
            {" "}session{a.count !== 1 ? "s" : ""}
          </Text>
        ))}
      </Box>
    );
  }

  // Preview enabled: drill into agent sessions
  if (selectedAgent) {
    return (
      <AgentTab
        projectPath={project.path}
        agentSlug={selectedAgent}
        active={active}
        onPreviewChange={onPreviewChange}
        onBoundary={(direction) => {
          if (direction === "up") {
            setSelectedAgent(null);
            onPreviewChange?.(false);
          } else {
            onBoundary?.(direction);
          }
        }}
      />
    );
  }

  const items: ListItem<string>[] = agents.map((a) => ({
    label: a.name,
    value: a.slug,
    suffix: `${a.count} session${a.count !== 1 ? "s" : ""}`,
  }));

  return (
    <Box flexDirection="column">
      <Text bold>Agents</Text>
      <ScrollableList
        items={items}
        onSelect={(slug) => setSelectedAgent(slug)}
        active={active}
        onBoundary={onBoundary}
      />
    </Box>
  );
}
