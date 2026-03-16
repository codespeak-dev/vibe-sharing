import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DiscoveredProject } from "../../sessions/types.js";
import { TabBar } from "../components/tab-bar.js";
import { ActionBar } from "../components/action-bar.js";
import { AgentTab } from "./review/agent-tab.js";
import { CodeTab } from "./review/code-tab.js";
import { GitTab } from "./review/git-tab.js";

interface ReviewScreenProps {
  projectPath: string;
  activeTab: string;
  projects: DiscoveredProject[];
  onSwitchTab: (tab: string) => void;
  onShare: () => void;
  onBack: () => void;
}

type FocusZone = "tabs" | "content" | "actions";

export function ReviewScreen({
  projectPath,
  activeTab,
  projects,
  onSwitchTab,
  onShare,
  onBack,
}: ReviewScreenProps) {
  const project = projects.find((p) => p.path === projectPath);
  const [hasActivePreview, setHasActivePreview] = useState(false);
  const [focusZone, setFocusZone] = useState<FocusZone>("content");

  // Build tabs: one per agent + Code + git
  const agentTabs = (project?.agents ?? []).map((a) => {
    const slug = Object.keys(project?.sessionCounts ?? {}).find((s) =>
      a.toLowerCase().replace(/\s+/g, "-").includes(s),
    ) ?? a;
    const count = project?.sessionCounts[slug] ?? 0;
    return { id: `agent:${slug}`, label: `${a} (${count})` };
  });
  const tabs = [
    ...agentTabs,
    { id: "code", label: "Code" },
    { id: "git", label: "git" },
  ];

  useInput((input, key) => {
    if (hasActivePreview) return;
    if (key.tab) {
      const zones: FocusZone[] = ["tabs", "content", "actions"];
      const idx = zones.indexOf(focusZone);
      setFocusZone(zones[(idx + 1) % zones.length]!);
    } else if (key.downArrow && focusZone === "tabs") {
      setFocusZone("content");
    } else if (key.upArrow && focusZone === "content") {
      setFocusZone("tabs");
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} />

      <TabBar tabs={tabs} activeTab={activeTab} onSwitch={onSwitchTab} active={focusZone === "tabs" && !hasActivePreview} />
      <Text dimColor>{"─".repeat(50)}</Text>

      <Box marginTop={1} flexDirection="column">
        {activeTab.startsWith("agent:") && (
          <AgentTab
            projectPath={projectPath}
            agentSlug={activeTab.replace("agent:", "")}
            active={focusZone === "content" || hasActivePreview}
            onPreviewChange={setHasActivePreview}
          />
        )}
        {activeTab === "code" && (
          <CodeTab
            projectPath={projectPath}
            active={focusZone === "content" || hasActivePreview}
            onPreviewChange={setHasActivePreview}
          />
        )}
        {activeTab === "git" && <GitTab projectPath={projectPath} active={focusZone === "content"} />}
      </Box>

      <ActionBar
        actions={[
          { label: "Share", onAction: onShare, primary: true },
          { label: "Back", onAction: onBack },
        ]}
        active={focusZone === "actions" && !hasActivePreview}
      />

      {!hasActivePreview && (
        <Box marginTop={1}>
          <Text dimColor>
            {"Tab "}
            <Text color={focusZone === "tabs" ? "cyan" : undefined} dimColor={focusZone !== "tabs"}>tabs</Text>
            {" / "}
            <Text color={focusZone === "content" ? "cyan" : undefined} dimColor={focusZone !== "content"}>list</Text>
            {" / "}
            <Text color={focusZone === "actions" ? "cyan" : undefined} dimColor={focusZone !== "actions"}>actions</Text>
            {"   ↑↓ zone   Esc back"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
