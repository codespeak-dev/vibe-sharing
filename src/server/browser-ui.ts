/**
 * Entry point for the default `codespeak-vibe-share` mode.
 * Detects installed agents, starts the local HTTP server, and opens the browser.
 * All session discovery, vibeness, and bundling logic runs in the browser
 * using the CLI server as a filesystem proxy.
 */
import { startCliServer, detectAgentDirs, generateToken } from "./server.js";
import type { ServerState } from "./server.js";

const WEBSITE_URL = process.env["VIBE_SHARE_WEBSITE_URL"] ?? "https://vibe-share.codespeak.dev";

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const platform = process.platform;
  const command =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32"  ? `start "" "${url}"` :
                            `xdg-open "${url}"`;
  try {
    await execAsync(command);
  } catch { /* user will see URL in console */ }
}

export async function startBrowserUI(): Promise<void> {
  console.log("\nCodeSpeak Vibe Share");

  const os = await import("node:os");
  const token = generateToken();
  const agents = await detectAgentDirs();

  const state: ServerState = { agents, token, homedir: os.homedir() };
  const { server, port } = await startCliServer(state);

  const apiBase = `http://127.0.0.1:${port}`;
  const browserUrl = `${WEBSITE_URL}/share?cliBase=${encodeURIComponent(apiBase)}&cliToken=${encodeURIComponent(token)}`;

  const agentNames = agents.map((a) => a.name).join(", ") || "none detected";
  console.log(`Detected agents: ${agentNames}`);
  console.log(`Opening browser…`);
  console.log(`If it doesn't open automatically: ${browserUrl}\n`);
  await openBrowser(browserUrl);

  console.log("Press Ctrl+C to stop.\n");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => { server.close(() => resolve()); });
    process.on("SIGTERM", () => { server.close(() => resolve()); });
  });
}
