// Tiny static file server for the backend/web-ui directory.
// Used by playwright to serve the admin pages on http://127.0.0.1:<port>.
//
// Also intercepts /api/* and returns whatever the test set up via window.fetch
// stub via the special X-Vibe-Test-Mock header (we use page.route() instead, so
// /api/* requests below just 404 by default).

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "backend", "web-ui");
const PORT = Number(process.argv[2] ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  // /api/* requests are handled via page.route() in tests; reject unmocked ones.
  if (pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "no test mock for " + pathname }));
    return;
  }

  // Special test-only config endpoint: returns whatever ?config= query string sets,
  // so tests can swap window.VIBE_SHARE_CONFIG without rebuilding the file.
  if (pathname === "/config.js") {
    const cfg = url.searchParams.get("config");
    const body = cfg
      ? `window.VIBE_SHARE_CONFIG = ${cfg};`
      : `window.VIBE_SHARE_CONFIG = {
          apiBaseUrl: "/api-not-set",
          cognitoDomain: "test.auth.eu-north-1.amazoncognito.com",
          clientId: "test-client-id",
          redirectUri: "http://127.0.0.1:${PORT}/callback.html",
        };`;
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(body);
    return;
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`web-ui test server listening on http://127.0.0.1:${PORT}`);
});
