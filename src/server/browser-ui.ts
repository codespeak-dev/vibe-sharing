/**
 * Entry point for the `codespeak-vibe-share --browser` mode.
 * Discovers sessions for the current project, starts a local HTTP server,
 * and opens the browser UI at https://vibe-share.codespeak.dev/share.
 */
import path from "node:path";
import { getGitWorktrees, getGitRemoteUrl } from "../utils/paths.js";
import { discoverAllSessions } from "../sessions/discovery.js";
import { startCliServer, generateToken } from "./server.js";
import type { DiscoveredProject } from "../sessions/types.js";

const WEBSITE_URL = "https://vibe-share.codespeak.dev";

async function openBrowser(url: string): Promise<void> {
  // Dynamic import to avoid top-level side effects
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const platform = process.platform;
  let command: string;
  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  try {
    await execAsync(command);
  } catch {
    // Silently ignore — the user will see the URL in the console
  }
}

export async function startBrowserUI(): Promise<void> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);

  console.log(`\nCodeSpeak Vibe Share — browser mode`);
  console.log(`Project: ${cwd}\n`);
  console.log("Discovering sessions…");

  // Get worktrees and remote URL for session discovery
  const [worktrees, remoteUrl] = await Promise.all([
    getGitWorktrees(cwd).catch(() => [{ path: cwd, branch: null }]),
    getGitRemoteUrl(cwd).catch(() => null),
  ]);

  const worktreePaths = worktrees.map((w) => w.path);
  if (!worktreePaths.includes(cwd)) worktreePaths.unshift(cwd);

  const discovery = await discoverAllSessions({
    worktreePaths,
    gitRemoteUrl: remoteUrl,
  });

  const allSessions = [...discovery.byAgent.values()]
    .flatMap(({ sessions }) => sessions);

  const providers = [...discovery.byAgent.values()].map(({ provider }) => provider);

  if (allSessions.length === 0) {
    console.log("No sessions found for this project. Make sure you're in a project directory that has AI coding session history.");
    return;
  }

  console.log(`Found ${allSessions.length} session${allSessions.length !== 1 ? "s" : ""} across ${providers.length} agent${providers.length !== 1 ? "s" : ""}.\n`);

  // Build a DiscoveredProject for this project
  const sessionCountsByAgent: Record<string, number> = {};
  const agentNames: string[] = [];
  const agentSlugs: string[] = [];
  for (const [agentName, { provider, sessions }] of discovery.byAgent) {
    sessionCountsByAgent[provider.slug] = sessions.length;
    agentNames.push(agentName);
    agentSlugs.push(provider.slug);
  }

  const project: DiscoveredProject = {
    path: cwd,
    agents: agentNames,
    agentSlugs,
    sessionCounts: sessionCountsByAgent,
  };

  // Start the local HTTP server
  const token = generateToken();
  const { server, port } = await startCliServer({
    project,
    sessions: allSessions,
    providers,
    token,
  });

  const apiBase = `http://127.0.0.1:${port}`;
  const browserUrl = `${WEBSITE_URL}/share?cliBase=${encodeURIComponent(apiBase)}&cliToken=${encodeURIComponent(token)}`;

  console.log(`Local server running at ${apiBase}`);
  console.log(`Opening browser…`);
  console.log(`\nIf the browser does not open automatically, visit:\n  ${browserUrl}\n`);

  await openBrowser(browserUrl);

  console.log("Press Ctrl+C to stop the server when you are done.\n");

  // Keep the process alive until interrupted
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\nStopping server…");
      server.close(() => resolve());
    });
    process.on("SIGTERM", () => {
      server.close(() => resolve());
    });
  });
}
