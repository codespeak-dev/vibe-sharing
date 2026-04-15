/**
 * Server-side bundle creation for the browser UI.
 * Creates a zip containing project files + session JSONL files + manifest,
 * matching the format produced by the website's browser-side createBundle().
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import archiver from "archiver";
import type { AgentProvider, DiscoveredSession } from "../sessions/types.js";
import { TOOL_VERSION } from "../config.js";

const DEFAULT_SIZE_THRESHOLD = 100 * 1024 * 1024; // 100 MB

const EXCLUDED_DIRS = new Set([
  "node_modules", ".venv", "venv", "__pycache__", ".hg", ".svn",
  "dist", "build", "out", ".next", ".nuxt", ".output", ".cache",
  ".parcel-cache", ".turbo", ".vercel", ".netlify", "coverage",
  ".nyc_output", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
  "target", "vendor", ".gradle", ".idea", ".vscode", "Pods",
  ".dart_tool", ".pub-cache",
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\.env($|\.)/, /^\.DS_Store$/, /^Thumbs\.db$/, /^desktop\.ini$/,
  /\.pyc$/, /\.pyo$/, /\.class$/, /\.o$/, /\.so$/, /\.dylib$/,
  /\.dll$/, /\.exe$/, /\.log$/, /\.lock$/,
];

function shouldExclude(relPath: string, isDir: boolean): boolean {
  const name = relPath.split("/").pop() ?? relPath;
  if (isDir) return EXCLUDED_DIRS.has(name);
  return EXCLUDED_FILE_PATTERNS.some((p) => p.test(name));
}

export interface ServerBundleResult {
  zipPath: string;
  sizeBytes: number;
  skippedCount: number;
}

/**
 * Walk a directory recursively, yielding { rel, abs } for each file.
 */
function* walkDir(
  dir: string,
  prefix = "",
): Generator<{ rel: string; abs: string }> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldExclude(rel, true)) continue;
      yield* walkDir(abs, rel);
    } else if (entry.isFile()) {
      if (!shouldExclude(rel, false)) yield { rel, abs };
    }
  }
}

/**
 * Create a zip bundle from the local filesystem.
 * Returns the path to a temporary zip file.
 */
export async function createServerBundle(opts: {
  projectPath: string;
  selectedSessions: DiscoveredSession[];
  providers: AgentProvider[];
  metadata?: Record<string, unknown>;
  sizeThresholdBytes?: number;
}): Promise<ServerBundleResult> {
  const {
    projectPath,
    selectedSessions,
    providers,
    metadata = {},
    sizeThresholdBytes = DEFAULT_SIZE_THRESHOLD,
  } = opts;

  const projectName = path.basename(projectPath);
  const zipPath = path.join(os.tmpdir(), `${projectName}-${Date.now()}.zip`);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const closePromise = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  // --- Project files ---
  const allFiles: Array<{ rel: string; abs: string; size: number }> = [];
  for (const { rel, abs } of walkDir(projectPath)) {
    try {
      const { size } = fs.statSync(abs);
      allFiles.push({ rel, abs, size });
    } catch { /* skip */ }
  }

  // Sort smallest-first to maximise included count
  allFiles.sort((a, b) => a.size - b.size);
  let totalSize = 0;
  let skippedCount = 0;
  let projectFileCount = 0;
  for (const { rel, abs, size } of allFiles) {
    if (totalSize + size > sizeThresholdBytes) {
      skippedCount++;
      continue;
    }
    archive.file(abs, { name: `project/${rel}` });
    totalSize += size;
    projectFileCount++;
  }

  // --- Session files ---
  let sessionFileCount = 0;
  const sessionIds = new Set(selectedSessions.map((s) => s.sessionId));
  const sessionsByAgent = new Map<string, DiscoveredSession[]>();
  for (const s of selectedSessions) {
    const list = sessionsByAgent.get(s.agentName) ?? [];
    list.push(s);
    sessionsByAgent.set(s.agentName, list);
  }

  for (const provider of providers) {
    for (const session of selectedSessions.filter((s) => s.agentName === provider.name)) {
      if (!sessionIds.has(session.sessionId)) continue;
      try {
        const files = await provider.getSessionFiles(session);
        for (const filePath of files) {
          if (!fs.existsSync(filePath)) continue;
          const archiveRoot = provider.getArchiveRoot?.() ?? null;
          let zipName: string;
          if (archiveRoot && filePath.startsWith(archiveRoot)) {
            const rel = path.relative(archiveRoot, filePath);
            zipName = `sessions/${path.basename(archiveRoot)}/${rel}`;
          } else {
            zipName = `sessions/${path.basename(filePath)}`;
          }
          archive.file(filePath, { name: zipName });
          sessionFileCount++;
        }
      } catch { /* skip broken session */ }
    }

    // Provider-level files (e.g. Cursor workspace storage)
    if (provider.getProviderFiles) {
      try {
        const files = await provider.getProviderFiles();
        for (const filePath of files) {
          if (!fs.existsSync(filePath)) continue;
          const archiveRoot = provider.getArchiveRoot?.() ?? null;
          let zipName: string;
          if (archiveRoot && filePath.startsWith(archiveRoot)) {
            const rel = path.relative(archiveRoot, filePath);
            zipName = `sessions/${path.basename(archiveRoot)}/${rel}`;
          } else {
            zipName = `sessions/${path.basename(filePath)}`;
          }
          archive.file(filePath, { name: zipName });
          sessionFileCount++;
        }
      } catch { /* skip */ }
    }
  }

  // --- Manifest ---
  const agentsObj: Record<string, { sessionCount: number; sessions: { id: string; summary?: string }[] }> = {};
  for (const [agentName, sessions] of sessionsByAgent) {
    agentsObj[agentName] = {
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({ id: s.sessionId, ...(s.summary ? { summary: s.summary } : {}) })),
    };
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    source: "cli-browser",
    project: {
      name: projectName,
      path: projectPath,
    },
    agents: agentsObj,
    files: { projectFileCount, sessionFileCount, totalSizeBytes: totalSize },
    ...metadata,
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();
  await closePromise;

  const { size: zipSize } = fs.statSync(zipPath);
  return { zipPath, sizeBytes: zipSize, skippedCount };
}
