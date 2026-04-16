/**
 * Local HTTP server for the CLI browser UI.
 *
 * The browser runs all session discovery, vibeness, and bundling logic itself.
 * This server is a thin filesystem proxy:
 *
 *   GET  /api/state          → detected agent base directories (fast, no scanning)
 *   GET  /api/fs/list?path=  → directory listing (name, isDir for each entry)
 *   GET  /api/fs/read?path=  → raw file bytes
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface AgentDirInfo {
  slug: string;
  name: string;
  path: string;
}

export interface ServerState {
  agents: AgentDirInfo[];
  token: string;
  homedir: string;
}

/** Origins allowed to make cross-origin requests to this server. */
function isAllowedOrigin(origin: string): boolean {
  if (origin === "https://vibe-share.codespeak.dev") return true;
  // Allow any localhost port — server is local-only and bearer-token protected
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  return false;
}

function setCORS(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin ?? "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += String(chunk); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

/** Generate a random bearer token (32 hex chars). */
export function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createCliServer(state: ServerState): http.Server {
  const server = http.createServer(async (req, res) => {
    setCORS(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${state.token}`) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", "http://x");
    const urlPath = parsedUrl.pathname;

    try {
      // GET /api/state — detected agent directories, ready immediately
      if (urlPath === "/api/state" && req.method === "GET") {
        jsonResponse(res, 200, { status: "ready", agents: state.agents, homedir: state.homedir });
        return;
      }

      // POST /api/shutdown — browser tab closed; exit the CLI process
      if (urlPath === "/api/shutdown" && req.method === "POST") {
        jsonResponse(res, 200, { ok: true });
        // Give the response a moment to flush before exiting
        setTimeout(() => process.exit(0), 100);
        return;
      }

      // GET /api/git/user — global git user.name and user.email
      if (urlPath === "/api/git/user" && req.method === "GET") {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        const runGit = async (key: string): Promise<string> => {
          try {
            const { stdout } = await execAsync(`git config --global ${key}`);
            return stdout.trim();
          } catch {
            return "";
          }
        };
        const [name, email] = await Promise.all([runGit("user.name"), runGit("user.email")]);
        jsonResponse(res, 200, { name, email });
        return;
      }

      // GET /api/fs/list?path=<encoded> — directory listing
      // Returns { entries, notFound: true } with status 200 (not 404) when the
      // path doesn't exist, so the browser does not log a console error.
      if (urlPath === "/api/fs/list" && req.method === "GET") {
        const targetPath = parsedUrl.searchParams.get("path") ?? "";
        try {
          const entries = await fsp.readdir(targetPath, { withFileTypes: true });
          jsonResponse(res, 200, {
            entries: entries.map((e) => ({ name: e.name, isDir: e.isDirectory() })),
          });
        } catch {
          jsonResponse(res, 200, { entries: [], notFound: true });
        }
        return;
      }

      // GET /api/fs/read?path=<encoded> — file bytes
      // Returns JSON { notFound: true } with status 200 (not 404) when the path
      // doesn't exist or is a directory, so the browser does not log a console error.
      // Client detects this case by checking Content-Type: application/json.
      if (urlPath === "/api/fs/read" && req.method === "GET") {
        const targetPath = parsedUrl.searchParams.get("path") ?? "";
        let stat: fs.Stats;
        try {
          stat = await fsp.stat(targetPath);
        } catch {
          jsonResponse(res, 200, { notFound: true });
          return;
        }
        if (!stat.isFile()) {
          jsonResponse(res, 200, { notFound: true });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(stat.size),
        });
        const fileStream = fs.createReadStream(targetPath);
        fileStream.on("error", () => res.destroy());
        fileStream.pipe(res);
        return;
      }

      jsonResponse(res, 404, { error: "Not found" });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  return server;
}

export function startCliServer(state: ServerState): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createCliServer(state);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

/**
 * Detect which agent directories exist on this machine.
 * Returns immediately — no filesystem scanning needed.
 */
export async function detectAgentDirs(): Promise<AgentDirInfo[]> {
  const os = await import("node:os");
  const home = os.homedir();

  const cursorUserDir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Cursor", "User")
      : process.platform === "win32"
        ? path.join(
            process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"),
            "Cursor",
            "User",
          )
        : path.join(home, ".config", "Cursor", "User");

  const candidates: AgentDirInfo[] = [
    { slug: "claude", name: "Claude Code", path: path.join(home, ".claude") },
    { slug: "codex",  name: "Codex",       path: path.join(home, ".codex") },
    { slug: "cursor", name: "Cursor",      path: cursorUserDir },
  ];

  const results: AgentDirInfo[] = [];
  for (const c of candidates) {
    const exists = await fsp.access(c.path).then(() => true, () => false);
    if (exists) results.push(c);
  }
  return results;
}
