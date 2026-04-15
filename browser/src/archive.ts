/**
 * Bundle creator: zips the project directory (respecting .gitignore)
 * plus all selected session files, returning a Blob.
 */
import JSZip from "jszip";
import ignore from "ignore";
import type { AgentHandle, DiscoveredSession, ExternalWorktreeHandle } from "./types.js";
import { walkDir, readBuffer, readText, getFileHandle } from "./fs.js";
import { getClaudeSessionFiles, getClaudeSessionFilesFromDir } from "./providers/claude.js";
import { getCursorSessionFiles } from "./providers/cursor.js";
import { getCodexSessionFiles } from "./providers/codex.js";

/** Default max total size of project files included in the bundle (100 MB). */
const DEFAULT_SIZE_THRESHOLD = 100 * 1024 * 1024;

export interface SkippedFile {
  path: string;
  sizeBytes: number;
}

export interface BundleResult {
  blob: Blob;
  /** Files excluded from the bundle because they exceeded the size threshold. */
  skippedFiles: SkippedFile[];
}

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

function shouldExcludeByDefault(relPath: string, isDir: boolean): boolean {
  const name = relPath.split("/").pop() ?? relPath;
  if (isDir) return EXCLUDED_DIRS.has(name);
  return EXCLUDED_FILE_PATTERNS.some((p) => p.test(name));
}

/**
 * Collect project files from the main directory and external worktrees,
 * filtering by exclusion rules and .gitignore.
 * Files are sorted by size ascending; those that fit within thresholdBytes
 * are included, the rest are returned as skipped.
 */
async function partitionProjectFiles(
  projectHandle: FileSystemDirectoryHandle,
  ig: ReturnType<typeof ignore>,
  externalWorktrees: ExternalWorktreeHandle[],
  thresholdBytes: number,
): Promise<{
  included: Array<{ path: string; handle: FileSystemFileHandle; sizeBytes: number }>;
  skipped: SkippedFile[];
}> {
  const all: Array<{ path: string; handle: FileSystemFileHandle; sizeBytes: number }> = [];

  async function collectFrom(dirHandle: FileSystemDirectoryHandle) {
    for await (const { path, handle } of walkDir(dirHandle)) {
      const segments = path.split("/");
      let excluded = false;
      for (let i = 0; i < segments.length; i++) {
        const partial = segments.slice(0, i + 1).join("/");
        const isDir = i < segments.length - 1;
        if (shouldExcludeByDefault(partial, isDir)) { excluded = true; break; }
      }
      if (excluded || ig.ignores(path)) continue;
      const sizeBytes = (await handle.getFile()).size;
      all.push({ path, handle, sizeBytes });
    }
  }

  await collectFrom(projectHandle);
  // Walk external worktrees and include their files alongside the main project
  // (same relative layout — new worktree-only files get included, existing ones
  // are overwritten by the worktree version which may be more recent)
  for (const ewt of externalWorktrees) await collectFrom(ewt.handle);

  // Sort smallest-first so we maximise the number of files included
  all.sort((a, b) => a.sizeBytes - b.sizeBytes);

  let total = 0;
  const included: Array<{ path: string; handle: FileSystemFileHandle; sizeBytes: number }> = [];
  const skipped: SkippedFile[] = [];
  for (const f of all) {
    if (total + f.sizeBytes <= thresholdBytes) {
      included.push(f);
      total += f.sizeBytes;
    } else {
      skipped.push({ path: f.path, sizeBytes: f.sizeBytes });
    }
  }
  return { included, skipped };
}

/**
 * Scan the project directory and return files that would be excluded from a bundle
 * due to the size threshold. Useful for showing a warning before bundling.
 */
export async function detectOversizedFiles(
  projectHandle: FileSystemDirectoryHandle,
  externalWorktrees: ExternalWorktreeHandle[] = [],
  thresholdBytes = DEFAULT_SIZE_THRESHOLD,
): Promise<SkippedFile[]> {
  const ig = ignore();
  const gitignoreHandle = await getFileHandle(projectHandle, ".gitignore");
  if (gitignoreHandle) {
    try { ig.add(await readText(gitignoreHandle)); } catch { /* ok */ }
  }
  const { skipped } = await partitionProjectFiles(projectHandle, ig, externalWorktrees, thresholdBytes);
  return skipped;
}

/**
 * Create a zip bundle Blob containing:
 *   - project/  : all non-gitignored project files (up to sizeThresholdBytes total)
 *   - sessions/ : session files for the selected sessions
 *   - manifest.json
 */
export async function createBundle(options: {
  projectHandle: FileSystemDirectoryHandle;
  projectPath: string;
  sessions: DiscoveredSession[];
  selectedSessionIds: Set<string>;
  agentHandles: AgentHandle[];
  externalWorktrees?: ExternalWorktreeHandle[];
  metadata?: Record<string, unknown>;
  /** Max cumulative size of project files to include (default 100 MB). */
  sizeThresholdBytes?: number;
  onProgress?: (phase: "project" | "sessions" | "finalizing", pct: number) => void;
}): Promise<BundleResult> {
  const {
    projectHandle, projectPath, sessions, selectedSessionIds, agentHandles,
    externalWorktrees = [], metadata, sizeThresholdBytes = DEFAULT_SIZE_THRESHOLD, onProgress,
  } = options;
  const zip = new JSZip();

  // --- Read .gitignore ---
  const ig = ignore();
  const gitignoreHandle = await getFileHandle(projectHandle, ".gitignore");
  if (gitignoreHandle) {
    try {
      const text = await readText(gitignoreHandle);
      ig.add(text);
    } catch {
      // no gitignore
    }
  }

  // --- Collect and partition project files by size ---
  const { included: projectFiles, skipped: skippedFiles } = await partitionProjectFiles(
    projectHandle, ig, externalWorktrees, sizeThresholdBytes,
  );

  let done = 0;
  for (const { path, handle } of projectFiles) {
    const buffer = await readBuffer(handle);
    zip.file(`project/${path}`, buffer);
    onProgress?.("project", Math.round((++done / projectFiles.length) * 100));
  }

  // --- Session files ---
  const selectedSessions = sessions.filter((s) => selectedSessionIds.has(s.sessionId));
  const claudeIds = new Set(
    selectedSessions.filter((s) => s.agentSlug === "claude-code").map((s) => s.sessionId),
  );
  const cursorIdsBySlug = new Map<string, Set<string>>();
  for (const s of selectedSessions) {
    if (s.agentSlug.startsWith("cursor")) {
      const set = cursorIdsBySlug.get(s.agentSlug) ?? new Set<string>();
      set.add(s.sessionId);
      cursorIdsBySlug.set(s.agentSlug, set);
    }
  }

  const codexIds = new Set(
    selectedSessions.filter((s) => s.agentSlug === "codex").map((s) => s.sessionId),
  );

  const sessionFiles: Array<{ zipPath: string; handle: FileSystemFileHandle }> = [];

  for (const ah of agentHandles) {
    if (ah.slug === "claude" && claudeIds.size > 0) {
      const files = await getClaudeSessionFiles(ah.handle, projectPath, claudeIds);
      sessionFiles.push(...files);
    } else if (ah.slug === "claude-project" && claudeIds.size > 0) {
      const files = await getClaudeSessionFilesFromDir(ah.handle, claudeIds);
      sessionFiles.push(...files);
    } else if (ah.slug.startsWith("cursor")) {
      const ids = cursorIdsBySlug.get(ah.slug);
      if (ids && ids.size > 0 && ah.dotCursorHandle) {
        const files = await getCursorSessionFiles(ah.dotCursorHandle, projectPath, ids);
        sessionFiles.push(...files);
      }
    } else if (ah.slug === "codex" && codexIds.size > 0) {
      const files = await getCodexSessionFiles(ah.handle, codexIds);
      sessionFiles.push(...files);
    }
  }

  let sDone = 0;
  for (const { zipPath, handle } of sessionFiles) {
    const buffer = await readBuffer(handle);
    zip.file(zipPath, buffer);
    onProgress?.("sessions", Math.round((++sDone / (sessionFiles.length || 1)) * 100));
  }

  // Also add a JSON export of Cursor composer metadata for sessions without transcripts
  const cursorWithoutTranscripts = selectedSessions.filter(
    (s) => s.agentSlug.startsWith("cursor") && s.firstPrompt !== null,
  );
  if (cursorWithoutTranscripts.length > 0) {
    zip.file(
      "sessions/cursor-composer-metadata.json",
      JSON.stringify(cursorWithoutTranscripts, null, 2),
    );
  }

  // --- Manifest ---
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    projectPath,
    ...(metadata ? { metadata } : {}),
    sessions: selectedSessions.map((s) => ({
      agentName: s.agentName,
      agentSlug: s.agentSlug,
      sessionId: s.sessionId,
      summary: s.summary,
      firstPrompt: s.firstPrompt,
      messageCount: s.messageCount,
      created: s.created,
    })),
    projectFilesCount: projectFiles.length,
    sessionFilesCount: sessionFiles.length,
    ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  onProgress?.("finalizing", 0);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, skippedFiles };
}

/** Trigger a browser download of the bundle Blob. */
export function downloadBundle(blob: Blob, projectName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName}-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
