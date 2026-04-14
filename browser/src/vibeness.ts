/**
 * Vibeness metric: % of code files in the project that were touched
 * by at least one selected AI session.
 *
 * Currently only Claude Code sessions are scanned (JSONL tool-call parsing).
 */
import ignore from "ignore";
import type { AgentHandle } from "./types.js";
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

/**
 * Calculate what % of code files in projectDirHandle were touched by
 * any selected Claude Code session.
 */
export async function calculateVibeness(
  agentHandles: AgentHandle[],
  projectPath: string,
  sessionIds: Set<string>,
  projectDirHandle: FileSystemDirectoryHandle,
): Promise<VibenessResult> {
  // Load .gitignore rules
  const ig = ignore();
  const gitignoreHandle = await getFileHandle(projectDirHandle, ".gitignore");
  if (gitignoreHandle) {
    try {
      ig.add(await readText(gitignoreHandle));
    } catch { /* no gitignore */ }
  }

  // Collect all code files in the attached project directory
  const allFiles = new Set<string>();
  for await (const { path } of walkDir(projectDirHandle)) {
    if (!isExcludedPath(path) && isCodeFile(path) && !ig.ignores(path)) {
      allFiles.add(path);
    }
  }

  if (allFiles.size === 0) {
    return { percent: 100, vibedCount: 0, totalCount: 0, uncoveredFiles: [] };
  }

  const vibedFiles = new Set<string>();
  const pathPrefix = projectPath.endsWith("/") ? projectPath : projectPath + "/";

  const claudeHandle = agentHandles.find((h) => h.slug === "claude");
  if (claudeHandle) {
    const encoded = encodeProjectPath(projectPath);
    const projectsDir = await getDirHandle(claudeHandle.handle, "projects");
    const sessionDir = projectsDir
      ? await getDirHandle(projectsDir, encoded)
      : null;

    if (sessionDir) {
      for await (const [fileName, fileHandle] of sessionDir.entries()) {
        if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
        const sid = fileName.slice(0, -".jsonl".length);
        if (!sessionIds.has(sid)) continue;

        const messages = await readJsonlHandle<JsonlMessage>(
          fileHandle as FileSystemFileHandle,
        );
        for (const msg of messages) {
          const content = msg.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (block.type !== "tool_use") continue;
            const tb = block as unknown as ToolUseBlock;
            for (const key of ["file_path", "path", "new_path"] as const) {
              const val = tb.input?.[key];
              if (typeof val !== "string") continue;
              // Strip absolute project-path prefix to get relative path
              let rel: string | null = null;
              if (val.startsWith(pathPrefix)) {
                rel = val.slice(pathPrefix.length);
              } else if (val.startsWith(projectPath)) {
                rel = val.slice(projectPath.length).replace(/^\//, "");
              }
              if (rel && allFiles.has(rel)) {
                vibedFiles.add(rel);
              }
            }
          }
        }
      }
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
