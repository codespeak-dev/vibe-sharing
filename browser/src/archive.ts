/**
 * Bundle creator: zips the project directory (respecting .gitignore)
 * plus all selected session files, returning a Blob.
 */
import JSZip from "jszip";
import ignore from "ignore";
import type { AgentHandle, DiscoveredSession } from "./types.js";
import { walkDir, readBuffer, readText, getFileHandle } from "./fs.js";
import { getClaudeSessionFiles, getClaudeSessionFilesFromDir } from "./providers/claude.js";
import { getCursorSessionFiles } from "./providers/cursor.js";
import { getCodexSessionFiles } from "./providers/codex.js";

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
 * Create a zip bundle Blob containing:
 *   - project/  : all non-gitignored project files
 *   - sessions/ : session files for the selected sessions
 *   - manifest.json
 */
export async function createBundle(options: {
  projectHandle: FileSystemDirectoryHandle;
  projectPath: string;
  sessions: DiscoveredSession[];
  selectedSessionIds: Set<string>;
  agentHandles: AgentHandle[];
  metadata?: Record<string, unknown>;
  onProgress?: (phase: "project" | "sessions" | "finalizing", pct: number) => void;
}): Promise<Blob> {
  const { projectHandle, projectPath, sessions, selectedSessionIds, agentHandles, metadata, onProgress } = options;
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

  // --- Walk project directory ---
  const projectFiles: Array<{ path: string; handle: FileSystemFileHandle }> = [];
  for await (const { path, handle } of walkDir(projectHandle)) {
    const segments = path.split("/");
    // Check each path component against defaults
    let excluded = false;
    for (let i = 0; i < segments.length; i++) {
      const partial = segments.slice(0, i + 1).join("/");
      const isDir = i < segments.length - 1;
      if (shouldExcludeByDefault(partial, isDir)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;
    if (ig.ignores(path)) continue;
    projectFiles.push({ path, handle });
  }

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
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  onProgress?.("finalizing", 0);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Trigger a browser download of the bundle Blob. */
export function downloadBundle(blob: Blob, projectName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName}-sessions-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
