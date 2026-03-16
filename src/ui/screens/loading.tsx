import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { Screen } from "../app.js";
import type { DiscoveredProject } from "../../sessions/types.js";
import { GooseDecoration } from "../components/goose-decoration.js";
import { Spinner } from "../components/spinner.js";
import { determineRoute } from "../../routing.js";

interface LoadingScreenProps {
  onDiscoverProjects: (onProgress: (status: string) => void) => Promise<DiscoveredProject[]>;
  onDone: (projects: DiscoveredProject[], route: Screen) => void;
}

export function LoadingScreen({ onDiscoverProjects, onDone }: LoadingScreenProps) {
  const [status, setStatus] = useState("Discovering projects across all AI coding agents...");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const projects = await onDiscoverProjects((s) => {
          if (!cancelled) setStatus(s);
        });
        if (cancelled) return;

        setStatus("Determining route...");
        const cwd = process.cwd();
        const route = await determineRoute(cwd, projects);

        if (cancelled) return;
        onDone(projects, route);
      } catch (err) {
        if (cancelled) return;
        setStatus(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onDiscoverProjects, onDone]);

  return (
    <Box flexDirection="row">
      <GooseDecoration animate />
      <Box flexDirection="column" justifyContent="center">
        <Text color="cyan" bold>
          codespeak-vibe-share
        </Text>
        <Spinner label={status} />
      </Box>
    </Box>
  );
}
