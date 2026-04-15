/**
 * Server-side vibeness calculation.
 * Node.js port of the browser's calculateVibeness(), using the local filesystem
 * instead of FileSystemDirectoryHandle.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".go",
  ".rs",
  ".java", ".kt", ".kts",
  ".swift", ".m", ".mm",
  ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx",
  ".cs",
  ".rb", ".rake",
  ".php",
  ".scala",
  ".clj", ".cljs", ".cljc",
  ".ex", ".exs",
  ".vue", ".svelte", ".astro",
  ".css", ".scss", ".sass", ".less",
  ".sql", ".graphql", ".gql",
  ".sh", ".bash", ".zsh", ".fish",
  ".dart",
  ".tf", ".hcl",
  ".proto",
  ".r", ".jl", ".lua", ".zig",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules", ".venv", "venv", "__pycache__", ".git",
  "dist", "build", "out", ".next", ".cache", "target", "vendor",
  ".gradle", ".idea", ".vscode",
]);

export interface VibenessResult {
  percent: number;
  vibedCount: number;
  totalCount: number;
  uncoveredFiles: string[];
}

interface ToolUseBlock {
  type?: string;
  name?: string;
  input?: { file_path?: string; path?: string };
}

interface JsonlMessage {
  message?: { content?: ToolUseBlock[] };
  cwd?: string;
}

/**
 * Parse a JSONL file and return absolute paths of files touched by Edit/Write tool calls.
 */
function extractTouchedFiles(jsonlPath: string, projectPath: string): Set<string> {
  const touched = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(jsonlPath, "utf-8");
  } catch {
    return touched;
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let msg: JsonlMessage;
    try { msg = JSON.parse(line) as JsonlMessage; } catch { continue; }

    const content = msg.message?.content;
    if (!Array.isArray(content)) continue;
    const cwd = msg.cwd ?? projectPath;

    for (const block of content) {
      if (block.type !== "tool_use") continue;
      if (block.name !== "Edit" && block.name !== "Write") continue;
      const filePath = block.input?.file_path ?? block.input?.path;
      if (!filePath) continue;
      const abs = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(cwd, filePath);
      touched.add(abs);
    }
  }

  return touched;
}

/**
 * Compute the fraction of code files in a project that were touched by any of the
 * provided JSONL session files.
 *
 * Uses `git ls-files` to enumerate tracked files. Falls back to a filesystem walk
 * if git is unavailable.
 */
export async function calculateVibenessNode(opts: {
  projectPath: string;
  sessionJsonlPaths: string[];
}): Promise<VibenessResult> {
  const { projectPath, sessionJsonlPaths } = opts;

  // Get git-tracked code files
  const codeFiles = new Set<string>();
  try {
    const { stdout } = await execFileAsync(
      "git", ["ls-files"],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    );
    for (const rel of stdout.trim().split("\n").filter(Boolean)) {
      const ext = path.extname(rel).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      const segs = rel.split("/");
      if (segs.some((s) => EXCLUDED_DIRS.has(s))) continue;
      codeFiles.add(path.resolve(projectPath, rel));
    }
  } catch {
    // git not available — walk filesystem
    await walkForCodeFiles(projectPath, codeFiles);
  }

  if (codeFiles.size === 0) {
    return { percent: 0, vibedCount: 0, totalCount: 0, uncoveredFiles: [] };
  }

  // Collect all files touched by the selected sessions
  const allTouched = new Set<string>();
  for (const jsonlPath of sessionJsonlPaths) {
    for (const f of extractTouchedFiles(jsonlPath, projectPath)) {
      allTouched.add(f);
    }
  }

  let vibedCount = 0;
  const uncoveredFiles: string[] = [];
  for (const f of codeFiles) {
    if (allTouched.has(f)) {
      vibedCount++;
    } else {
      uncoveredFiles.push(path.relative(projectPath, f));
    }
  }

  const totalCount = codeFiles.size;
  const percent = Math.round((vibedCount / totalCount) * 100);

  return {
    percent,
    vibedCount,
    totalCount,
    uncoveredFiles: uncoveredFiles.slice(0, 200),
  };
}

async function walkForCodeFiles(dir: string, out: Set<string>): Promise<void> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walkForCodeFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        out.add(path.join(dir, entry.name));
      }
    }
  }
}
