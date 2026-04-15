/**
 * Vibeness metric: % of code files in the project that were touched
 * by at least one selected AI session.
 *
 * Currently only Claude Code sessions are scanned (JSONL tool-call parsing).
 */
import ignore from "ignore";
import type { AgentHandle, ExternalWorktreeHandle } from "./types.js";
import { getDirHandle, walkDir, readJsonlHandle, getFileHandle, readText } from "./fs.js";
import { encodeProjectPath } from "./path.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h", ".hpp", ".cc",
  ".cs", ".rb", ".php", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".html", ".css", ".scss", ".sass", ".less",
  ".sh", ".bash", ".zsh", ".fish",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules", ".venv", "venv", "__pycache__", ".git",
  "dist", "build", "out", ".next", ".cache", "target", "vendor",
  ".gradle", ".idea", ".vscode",
]);

function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function isExcludedPath(path: string): boolean {
  return path.split("/").some((seg) => EXCLUDED_DIRS.has(seg));
}

interface ToolUseBlock {
  type: "tool_use";
  name?: string;
  input?: { file_path?: string; path?: string; new_path?: string };
}

interface ContentBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface JsonlMessage {
  type?: string;
  message?: { role?: string; content?: ContentBlock[] };
}

export interface VibenessResult {
  percent: number;
  vibedCount: number;
  totalCount: number;
  /** Relative paths of code files not touched by any selected session (capped at 200). */
  uncoveredFiles: string[];
}

interface Worktree {
  /** Absolute path to the worktree root (e.g. /Users/foo/proj/.claude/worktrees/agent-abc). */
  absPath: string;
  /** Path relative to the main project root, or null if outside the project. */
  relPath: string | null;
}

/**
 * Navigate to a nested subdirectory given a slash-separated relative path.
 */
async function getNestedDirHandle(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileSystemDirectoryHandle | null> {
  const parts = relPath.split("/").filter(Boolean);
  let current: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    const next = await getDirHandle(current, part);
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * Approach 1: read worktrees from .git/worktrees/ registry.
 * Returns both internal (relative to project) and external worktrees.
 */
async function readWorktreesFromRegistry(
  projectDirHandle: FileSystemDirectoryHandle,
  projectPath: string,
  seen: Set<string>,
  out: Worktree[],
): Promise<void> {
  const gitDir = await getDirHandle(projectDirHandle, ".git");
  if (!gitDir) return;
  const worktreesDir = await getDirHandle(gitDir, "worktrees");
  if (!worktreesDir) return;

  const pathPrefix = projectPath.endsWith("/") ? projectPath : projectPath + "/";

  for await (const [, entryHandle] of worktreesDir.entries()) {
    if (entryHandle.kind !== "directory") continue;
    const gitdirHandle = await getFileHandle(entryHandle as FileSystemDirectoryHandle, "gitdir");
    if (!gitdirHandle) continue;
    try {
      const text = (await readText(gitdirHandle)).trim();
      // text is like "/absolute/path/to/worktree/.git" — strip trailing /.git
      const absPath = text.endsWith("/.git") ? text.slice(0, -"/.git".length) : text;
      if (seen.has(absPath)) continue;
      seen.add(absPath);
      const relPath = absPath.startsWith(pathPrefix) ? absPath.slice(pathPrefix.length) : null;
      out.push({ absPath, relPath });
    } catch { /* skip unreadable entries */ }
  }
}

/**
 * Approach 2: scan the project tree for subdirectories that contain a .git FILE.
 * A .git file (not directory) is the git-standard worktree link marker.
 * This works even when .git/worktrees/ is inaccessible (e.g. excluded by file picker).
 * Only finds internal worktrees (those nested inside the project dir).
 */
async function findWorktreesByGitFile(
  dir: FileSystemDirectoryHandle,
  projectPath: string,
  seen: Set<string>,
  out: Worktree[],
  relPath = "",
  depth = 0,
): Promise<void> {
  if (depth > 6) return;

  // Collect entries to avoid double-iteration of the async generator
  const children: [string, FileSystemHandle][] = [];
  for await (const entry of dir.entries()) children.push(entry);

  // If this is a non-root subdir and has a .git FILE, it's a worktree root
  if (relPath) {
    for (const [name, handle] of children) {
      if (handle.kind === "file" && name === ".git") {
        const absPath = `${projectPath}/${relPath}`;
        if (!seen.has(absPath)) {
          seen.add(absPath);
          out.push({ absPath, relPath });
        }
        return; // Don't recurse further into this worktree
      }
    }
  }

  // Recurse into non-excluded subdirectories
  for (const [name, handle] of children) {
    if (handle.kind !== "directory" || EXCLUDED_DIRS.has(name) || name === ".git") continue;
    await findWorktreesByGitFile(
      handle as FileSystemDirectoryHandle,
      projectPath, seen, out,
      relPath ? `${relPath}/${name}` : name,
      depth + 1,
    );
  }
}

/**
 * Approach 3: directly enumerate .claude/worktrees/ subdirectories.
 * Claude Code places sub-agent worktrees at .claude/worktrees/{name}/ regardless
 * of whether git metadata is present (e.g. in bundles where .git is stripped).
 */
async function findClaudeWorktrees(
  projectDirHandle: FileSystemDirectoryHandle,
  projectPath: string,
  seen: Set<string>,
  out: Worktree[],
): Promise<void> {
  const dotClaude = await getDirHandle(projectDirHandle, ".claude");
  if (!dotClaude) return;
  const worktreesDir = await getDirHandle(dotClaude, "worktrees");
  if (!worktreesDir) return;

  const pathPrefix = projectPath.endsWith("/") ? projectPath : projectPath + "/";

  for await (const [name, handle] of worktreesDir.entries()) {
    if (handle.kind !== "directory") continue;
    const relPath = `.claude/worktrees/${name}`;
    const absPath = `${pathPrefix}${relPath}`;
    if (!seen.has(absPath)) {
      seen.add(absPath);
      out.push({ absPath, relPath });
    }
  }
}

/**
 * Detect all git worktrees associated with this project.
 * Uses three approaches and merges results:
 *   1. .git/worktrees/ registry (finds both internal and external worktrees)
 *   2. Scanning for .git files in subdirectories (robust when registry unavailable)
 *   3. .claude/worktrees/ enumeration (works even in bundles where .git is stripped)
 */
async function readWorktrees(
  projectDirHandle: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<Worktree[]> {
  const out: Worktree[] = [];
  const seen = new Set<string>();
  await readWorktreesFromRegistry(projectDirHandle, projectPath, seen, out);
  await findWorktreesByGitFile(projectDirHandle, projectPath, seen, out);
  await findClaudeWorktrees(projectDirHandle, projectPath, seen, out);
  return out;
}

/**
 * Detect git worktrees that live outside the project directory.
 * Returns descriptors for any external worktrees found; the caller should
 * prompt the user to provide FileSystemDirectoryHandle for each.
 */
export async function detectExternalWorktrees(
  projectDirHandle: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<Array<{ name: string; absPath: string }>> {
  const worktrees = await readWorktrees(projectDirHandle, projectPath);
  return worktrees
    .filter((w) => w.relPath === null)
    .map((w) => ({ name: w.absPath.split("/").pop() ?? w.absPath, absPath: w.absPath }));
}

/**
 * Scan a directory handle for code files and add relative paths to the set.
 */
async function collectCodeFiles(
  dirHandle: FileSystemDirectoryHandle,
  ig: ReturnType<typeof ignore>,
  out: Set<string>,
): Promise<void> {
  for await (const { path } of walkDir(dirHandle)) {
    if (!isExcludedPath(path) && isCodeFile(path) && !ig.ignores(path)) {
      out.add(path);
    }
  }
}

/**
 * Calculate what % of code files in projectDirHandle were touched by
 * any selected Claude Code session.
 */
export async function calculateVibeness(
  agentHandles: AgentHandle[],
  projectPath: string,
  sessionIds: Set<string>,
  projectDirHandle: FileSystemDirectoryHandle,
  externalWorktrees: ExternalWorktreeHandle[] = [],
): Promise<VibenessResult> {
  // Load .gitignore rules
  const ig = ignore();
  const gitignoreHandle = await getFileHandle(projectDirHandle, ".gitignore");
  if (gitignoreHandle) {
    try {
      ig.add(await readText(gitignoreHandle));
    } catch { /* no gitignore */ }
  }

  // Detect git worktrees registered in .git/worktrees/
  const worktrees = await readWorktrees(projectDirHandle, projectPath);

  // Collect all code files, merging main checkout + every worktree.
  // Internal worktrees are excluded from the main walk (they are nested subdirs)
  // and then scanned separately at their own root so file paths are canonical
  // (relative to the worktree root = same relative layout as the main checkout).
  const allFiles = new Set<string>();

  // Main checkout — skip files that live inside an internal worktree subdir
  for await (const { path } of walkDir(projectDirHandle)) {
    if (!isExcludedPath(path) && isCodeFile(path) && !ig.ignores(path)) {
      const inWorktree = worktrees.some(
        (w) => w.relPath !== null && (path === w.relPath || path.startsWith(w.relPath + "/")),
      );
      if (!inWorktree) allFiles.add(path);
    }
  }

  // Internal worktrees — scan at their root to pick up any new files
  for (const wt of worktrees) {
    if (wt.relPath === null) continue;
    const wtHandle = await getNestedDirHandle(projectDirHandle, wt.relPath);
    if (wtHandle) await collectCodeFiles(wtHandle, ig, allFiles);
  }

  // External worktrees supplied by the caller
  for (const ewt of externalWorktrees) {
    await collectCodeFiles(ewt.handle, ig, allFiles);
  }

  if (allFiles.size === 0) {
    return { percent: 100, vibedCount: 0, totalCount: 0, uncoveredFiles: [] };
  }

  const vibedFiles = new Set<string>();
  const pathPrefix = projectPath.endsWith("/") ? projectPath : projectPath + "/";

  // All absolute path prefixes that map to the canonical project-relative layout
  const allWorktreeAbsPaths = [
    ...worktrees.map((w) => w.absPath),
    ...externalWorktrees.map((w) => w.absPath),
  ];

  /** Extract touched file paths from a single JSONL file and add to vibedFiles. */
  async function scanJsonlFile(fileHandle: FileSystemFileHandle) {
    const messages = await readJsonlHandle<JsonlMessage>(fileHandle);
    for (const msg of messages) {
      const content = msg.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const tb = block as unknown as ToolUseBlock;
        for (const key of ["file_path", "path", "new_path"] as const) {
          const val = tb.input?.[key];
          if (typeof val !== "string") continue;
          // Try worktree prefixes first (more specific — worktrees live
          // inside the project path, so the generic project-prefix match
          // would fire first and yield a path like
          // ".claude/worktrees/agent-abc/build.rs" instead of "build.rs")
          let rel: string | null = null;
          for (const wtAbsPath of allWorktreeAbsPaths) {
            const wtPrefix = wtAbsPath.endsWith("/") ? wtAbsPath : wtAbsPath + "/";
            if (val.startsWith(wtPrefix)) {
              rel = val.slice(wtPrefix.length);
              break;
            }
          }
          // Fall back to stripping the main project-path prefix
          if (!rel) {
            if (val.startsWith(pathPrefix)) {
              rel = val.slice(pathPrefix.length);
            } else if (val.startsWith(projectPath)) {
              rel = val.slice(projectPath.length).replace(/^\//, "");
            }
          }
          if (rel && allFiles.has(rel)) {
            vibedFiles.add(rel);
          }
        }
      }
    }
  }

  /**
   * Scan a session directory for the selected sessions.
   * Also scans subagent files stored at {sid}/subagents/*.jsonl — Claude Code
   * stores sub-agent runs alongside the parent session under a same-named subdir.
   */
  async function scanSessionDir(sessionDir: FileSystemDirectoryHandle) {
    for await (const [fileName, fileHandle] of sessionDir.entries()) {
      if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
      const sid = fileName.slice(0, -".jsonl".length);
      if (!sessionIds.has(sid)) continue;

      // Scan the main session file
      await scanJsonlFile(fileHandle as FileSystemFileHandle);

      // Scan subagent files: {sid}/subagents/*.jsonl
      const sessionSubDir = await getDirHandle(sessionDir, sid);
      if (sessionSubDir) {
        const subagentsDir = await getDirHandle(sessionSubDir, "subagents");
        if (subagentsDir) {
          for await (const [subName, subHandle] of subagentsDir.entries()) {
            if (subHandle.kind === "file" && subName.endsWith(".jsonl")) {
              await scanJsonlFile(subHandle as FileSystemFileHandle);
            }
          }
        }
      }
    }
  }

  for (const ah of agentHandles) {
    if (ah.slug === "claude") {
      const encoded = encodeProjectPath(projectPath);
      const projectsDir = await getDirHandle(ah.handle, "projects");
      const sessionDir = projectsDir
        ? await getDirHandle(projectsDir, encoded)
        : null;
      if (sessionDir) await scanSessionDir(sessionDir);
    } else if (ah.slug === "claude-project") {
      // Handle IS the session directory already
      await scanSessionDir(ah.handle);
    }
  }

  const totalCount = allFiles.size;
  const vibedCount = vibedFiles.size;
  const uncoveredFiles = [...allFiles]
    .filter((f) => !vibedFiles.has(f))
    .sort()
    .slice(0, 200);
  return {
    percent: Math.round((vibedCount / totalCount) * 100),
    vibedCount,
    totalCount,
    uncoveredFiles,
  };
}
