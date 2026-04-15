/**
 * Local HTTP server for the CLI browser UI.
 * Exposes a minimal REST API so the browser ShareFlow can fetch sessions,
 * calculate vibeness, and create bundles — all using the local filesystem.
 */
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import type { AgentProvider, DiscoveredProject, DiscoveredSession } from "../sessions/types.js";
import { calculateVibenessNode } from "./vibeness.js";
import { createServerBundle } from "./bundle.js";

export interface ServerState {
  project: DiscoveredProject;
  sessions: DiscoveredSession[];
  providers: AgentProvider[];
  token: string;
}

/** Origins allowed to make cross-origin requests to this server. */
const ALLOWED_ORIGINS = [
  "https://vibe-share.codespeak.dev",
  "http://localhost:3000", // local dev
];

function setCORS(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin ?? "";
  if (ALLOWED_ORIGINS.includes(origin)) {
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

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
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

/**
 * Create and return the HTTP server. Call server.listen(port, cb) to start.
 */
export function createCliServer(state: ServerState): http.Server {
  const server = http.createServer(async (req, res) => {
    setCORS(req, res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Token authentication
    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${state.token}`) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const urlPath = req.url?.split("?")[0] ?? "/";

    try {
      // GET /api/state — initial state for the browser UI
      if (urlPath === "/api/state" && req.method === "GET") {
        jsonResponse(res, 200, {
          project: state.project,
          sessions: state.sessions,
        });
        return;
      }

      // POST /api/vibeness — server-side vibeness calculation
      if (urlPath === "/api/vibeness" && req.method === "POST") {
        const body = await readBody(req);
        const { sessionIds } = JSON.parse(body) as { sessionIds: string[] };
        const idSet = new Set(sessionIds);
        const selectedSessions = state.sessions.filter((s) => idSet.has(s.sessionId));

        // Collect JSONL paths for selected sessions
        const jsonlPaths: string[] = [];
        for (const provider of state.providers) {
          for (const session of selectedSessions.filter((s) => s.agentName === provider.name)) {
            try {
              const files = await provider.getSessionFiles(session);
              jsonlPaths.push(...files.filter((f) => f.endsWith(".jsonl")));
            } catch { /* skip */ }
          }
        }

        const result = await calculateVibenessNode({
          projectPath: state.project.path,
          sessionJsonlPaths: jsonlPaths,
        });
        jsonResponse(res, 200, result);
        return;
      }

      // POST /api/bundle — create and stream a zip bundle
      if (urlPath === "/api/bundle" && req.method === "POST") {
        const body = await readBody(req);
        const { sessionIds, metadata } = JSON.parse(body) as {
          sessionIds: string[];
          metadata?: Record<string, unknown>;
        };
        const idSet = new Set(sessionIds);
        const selectedSessions = state.sessions.filter((s) => idSet.has(s.sessionId));

        const { zipPath, sizeBytes } = await createServerBundle({
          projectPath: state.project.path,
          selectedSessions,
          providers: state.providers,
          metadata: { ...metadata, source: "cli-browser" },
        });

        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": String(sizeBytes),
          "Content-Disposition": `attachment; filename="${encodeURIComponent(state.project.path.split("/").pop() ?? "bundle")}-${Date.now()}.zip"`,
        });

        const fileStream = fs.createReadStream(zipPath);
        fileStream.pipe(res);
        fileStream.on("close", () => {
          fs.unlink(zipPath, () => { /* cleanup tmp file */ });
        });
        return;
      }

      jsonResponse(res, 404, { error: "Not found" });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  return server;
}

/**
 * Start the CLI server on a random available port.
 * Returns the bound port.
 */
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
