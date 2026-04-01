import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { DiscoveredProject } from "../../sessions/types.js";
import { TabBar } from "../components/tab-bar.js";
import { ActionBar } from "../components/action-bar.js";
import { SessionsTab } from "./review/sessions-tab.js";
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

  // Build tabs: Sessions (if any agents) + Code + git
  const hasAgents = (project?.agents ?? []).length > 0;
  const totalSessions = Object.values(project?.sessionCounts ?? {}).reduce((a, b) => a + b, 0);
  const tabs = [
    ...(hasAgents ? [{ id: "sessions", label: `Sessions (${totalSessions})` }] : []),
    { id: "code", label: "Code" },
    { id: "git", label: "git" },
  ];

  const handleContentBoundary = useCallback((direction: "up" | "down") => {
    if (direction === "up") {
      setFocusZone("tabs");
    } else {
      setFocusZone("actions");
    }
  }, []);

  useInput((input, key) => {
    if (hasActivePreview) return;
    if (key.tab) {
      const zones: FocusZone[] = ["tabs", "content", "actions"];
      const idx = zones.indexOf(focusZone);
      setFocusZone(zones[(idx + 1) % zones.length]!);
    } else if (key.downArrow && focusZone === "tabs") {
      setFocusZone("content");
    } else if (key.upArrow && focusZone === "actions") {
      setFocusZone("content");
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{projectPath}</Text>
      </Box>

      <TabBar tabs={tabs} activeTab={activeTab} onSwitch={onSwitchTab} active={focusZone === "tabs" && !hasActivePreview} />
      <Text dimColor>{"─".repeat(50)}</Text>

      <Box marginTop={1} flexDirection="column">
        {activeTab === "sessions" && project && (
          <SessionsTab
            project={project}
            active={focusZone === "content" || hasActivePreview}
            onPreviewChange={setHasActivePreview}
            onBoundary={handleContentBoundary}
          />
        )}
        {activeTab === "code" && (
          <CodeTab
            projectPath={projectPath}
            active={focusZone === "content" || hasActivePreview}
            onPreviewChange={setHasActivePreview}
            onBoundary={handleContentBoundary}
          />
        )}
        {activeTab === "git" && <GitTab projectPath={projectPath} active={focusZone === "content"} onBoundary={handleContentBoundary} />}
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
