import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { ScrollableList, type ListItem } from "../../components/scrollable-list.js";
import { SessionPreview } from "../../components/session-preview.js";
import { discoverAllSessions } from "../../../sessions/discovery.js";
import { getGitRemoteUrl, getGitWorktrees } from "../../../utils/paths.js";
import type { DiscoveredSession } from "../../../sessions/types.js";

interface AgentTabProps {
  projectPath: string;
  agentSlug: string;
  onPreviewChange?: (active: boolean) => void;
}

export function AgentTab({ projectPath, agentSlug, onPreviewChange }: AgentTabProps) {
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const worktrees = await getGitWorktrees(projectPath).catch(() => [
          { path: projectPath, branch: null },
        ]);
        const gitRemoteUrl = await getGitRemoteUrl(projectPath).catch(
          () => null,
        );
        const discovery = await discoverAllSessions({
          worktreePaths: worktrees.map((wt) => wt.path),
          gitRemoteUrl,
        });

        if (cancelled) return;

        // Find sessions for this agent
        for (const [name, { sessions: agentSessions }] of discovery.byAgent) {
          const slug = name.toLowerCase().replace(/\s+/g, "-");
          if (slug === agentSlug || slug.includes(agentSlug) || agentSlug.includes(slug)) {
            setSessions(agentSessions);
            break;
          }
        }
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath, agentSlug]);

  const openPreview = (sessionId: string) => {
    setPreviewSessionId(sessionId);
    onPreviewChange?.(true);
  };

  const closePreview = () => {
    setPreviewSessionId(null);
    onPreviewChange?.(false);
  };

  if (loading) {
    return <Text dimColor>Loading sessions...</Text>;
  }

  if (sessions.length === 0) {
    return <Text dimColor>No sessions found.</Text>;
  }

  if (previewSessionId) {
    return (
      <SessionPreview
        sessionId={previewSessionId}
        agentSlug={agentSlug}
        projectPath={projectPath}
        onBack={closePreview}
      />
    );
  }

  const items: ListItem<string>[] = sessions.map((s) => {
    const desc = s.summary ?? s.firstPrompt ?? s.sessionId;
    const truncated = desc.length > 60 ? desc.slice(0, 57) + "..." : desc;
    const meta: string[] = [];
    if (s.messageCount) meta.push(`${s.messageCount} msgs`);
    if (s.created) meta.push(new Date(s.created).toLocaleDateString());

    return {
      label: truncated,
      value: s.sessionId,
      suffix: meta.length ? `(${meta.join(", ")})` : undefined,
    };
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Sessions ({sessions.length}):
      </Text>
      <ScrollableList items={items} onSelect={openPreview} />
    </Box>
  );
}
