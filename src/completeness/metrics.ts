import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "../utils/fs-helpers.js";

const execFileAsync = promisify(execFile);

/** Grace period after session end: commits within this window count as "vibed" */
const COMMIT_GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes

// ─── Extension sets ───────────────────────────────────────────────────────────

/**
 * Extensions excluded from the file coverage denominator — types that agents
 * typically cannot generate (images, binaries, lock files, etc.).
 * Keep in sync with EXCLUDED_EXTENSIONS in scripts/inspect-bundles.ts.
 */
const EXCLUDED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif",
  ".ico", ".avif", ".heic", ".heif", ".svg",
  ".json", ".jsonl",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".wasm", ".pyc", ".pyo", ".class", ".dll", ".so", ".dylib", ".exe", ".o", ".a",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".bundle",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi", ".mov", ".flac", ".aac", ".m4a",
  ".pdf",
  ".db", ".sqlite", ".sqlite3",
  ".pem", ".crt", ".cer", ".key", ".p12", ".pfx", ".der",
]);

const EXCLUDED_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "uv.lock", "Cargo.lock", "Gemfile.lock", "poetry.lock", "composer.lock",
  "go.sum", "flake.lock",
]);

/**
 * Extensions considered "code files" for the code-only coverage metric.
 * Includes programming languages, component templates, stylesheets, and query languages.
 * Keep in sync with CODE_EXTENSIONS in scripts/inspect-bundles.ts.
 */
const CODE_EXTENSIONS = new Set([
  // JavaScript / TypeScript
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  // Python
  ".py", ".pyi",
  // Ruby
  ".rb", ".rake",
  // Go
  ".go",
  // Rust
  ".rs",
  // Java / Kotlin
  ".java", ".kt", ".kts",
  // Swift / Objective-C
  ".swift", ".m", ".mm",
  // C / C++
  ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx",
  // C#
  ".cs",
  // PHP
  ".php",
  // Scala
  ".scala",
  // Clojure
  ".clj", ".cljs", ".cljc",
  // Elixir / Erlang
  ".ex", ".exs", ".erl", ".hrl",
  // Haskell
  ".hs", ".lhs",
  // OCaml / F#
  ".ml", ".mli", ".fs", ".fsx",
  // Lua
  ".lua",
  // R
  ".r",
  // Julia
  ".jl",
  // Shell
  ".sh", ".bash", ".zsh", ".fish",
  // Component templates
  ".vue", ".svelte", ".astro",
  // Styles
  ".css", ".scss", ".sass", ".less",
  // Queries
  ".sql", ".graphql", ".gql",
  // Protobuf / Thrift
  ".proto", ".thrift",
  // Terraform / HCL
  ".tf", ".hcl",
  // Dart
  ".dart",
  // Zig / Nim / Crystal
  ".zig", ".nim", ".cr",
  // Groovy
  ".groovy",
]);

function isExcluded(absPath: string): boolean {
  const base = path.basename(absPath);
  if (EXCLUDED_FILENAMES.has(base)) return true;
  return EXCLUDED_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

function isCodeFile(absPath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionWindow {
  start: number;
  end: number;
}

interface ToolUseMessage {
  message?: {
    content?: Array<{
      type?: string;
      name?: string;
      input?: { file_path?: string };
    }>;
  };
  cwd?: string;
}

export interface FileCoverageResult {
  /** All counted tracked files (excludes images, lock files, binaries, etc.) */
  all: number | null;
  /** Code files only (source code, stylesheets, query languages, etc.) */
  code: number | null;
  /** Line-weighted version of `all`: matched lines / total lines across all counted files */
  allWeighted: number | null;
  /** Line-weighted version of `code`: matched lines / total lines across code files only */
  codeWeighted: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSessionWindows(
  sessions: Array<{ created: string | null; modified: string | null }>,
): SessionWindow[] {
  const windows: SessionWindow[] = [];
  for (const s of sessions) {
    if (!s.created) continue;
    const start = new Date(s.created).getTime();
    if (isNaN(start)) continue;
    const modifiedTs = s.modified ? new Date(s.modified).getTime() : NaN;
    const end = isNaN(modifiedTs)
      ? start + COMMIT_GRACE_PERIOD_MS
      : modifiedTs + COMMIT_GRACE_PERIOD_MS;
    windows.push({ start, end });
  }
  return windows;
}

function isInAnyWindow(ts: number, windows: SessionWindow[]): boolean {
  return windows.some((w) => ts >= w.start && ts <= w.end);
}

/** Count lines in a file. Returns 0 for binary or unreadable files. */
function countFileLines(filePath: string): number {
  try {
    return fs.readFileSync(filePath, "utf-8").split("\n").length;
  } catch {
    return 0;
  }
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Compute the fraction of git commits that fall within a session window
 * (including a 60-minute grace period after each session ends).
 * Returns null if git is unavailable, there are no commits, or no sessions have timestamps.
 */
export async function computeCommitCoverage(
  projectPath: string,
  sessions: Array<{ created: string | null; modified: string | null }>,
): Promise<number | null> {
  if (sessions.length === 0) return null;

  const windows = buildSessionWindows(sessions);
  if (windows.length === 0) return null;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["log", "--format=%aI", "--all"],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }

  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  let vibed = 0;
  for (const line of lines) {
    const ts = new Date(line.trim()).getTime();
    if (!isNaN(ts) && isInAnyWindow(ts, windows)) vibed++;
  }

  return vibed / lines.length;
}

/**
 * Compute the fraction of git-tracked files that were written or edited
 * in any session (based on Edit/Write tool calls in JSONL session files).
 *
 * Returns an object with two ratios:
 *   - `all`:  all counted files (excludes images, lock files, binaries, etc.)
 *   - `code`: code files only (programming languages, stylesheets, queries)
 *
 * A ratio is null if the denominator is zero or git is unavailable.
 */
export async function computeWriteFileCoverage(
  projectPath: string,
  jsonlFilePaths: string[],
): Promise<FileCoverageResult> {
  let lsOut: string;
  try {
    ({ stdout: lsOut } = await execFileAsync(
      "git",
      ["ls-files"],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch {
    return { all: null, code: null, allWeighted: null, codeWeighted: null };
  }

  const countedFiles = new Set<string>();
  const codeFiles = new Set<string>();

  for (const rel of lsOut.trim().split("\n").filter(Boolean)) {
    const abs = path.resolve(projectPath, rel);
    if (isExcluded(abs)) continue;
    countedFiles.add(abs);
    if (isCodeFile(abs)) codeFiles.add(abs);
  }

  if (countedFiles.size === 0) return { all: null, code: null, allWeighted: null, codeWeighted: null };

  const writtenFiles = new Set<string>();

  for (const jsonlPath of jsonlFilePaths) {
    try {
      for await (const msg of readJsonl<ToolUseMessage>(jsonlPath)) {
        if (!msg.message?.content) continue;
        for (const block of msg.message.content) {
          if (
            block.type === "tool_use" &&
            (block.name === "Edit" || block.name === "Write") &&
            block.input?.file_path
          ) {
            const resolved = path.resolve(
              msg.cwd ?? projectPath,
              block.input.file_path,
            );
            writtenFiles.add(resolved);
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Count lines for all counted files (used as weights)
  let totalAllLines = 0;
  let totalCodeLines = 0;
  const lineCounts = new Map<string, number>();
  for (const f of countedFiles) {
    const n = countFileLines(f);
    lineCounts.set(f, n);
    totalAllLines += n;
    if (codeFiles.has(f)) totalCodeLines += n;
  }

  let allCount = 0;
  let codeCount = 0;
  let matchedAllLines = 0;
  let matchedCodeLines = 0;
  for (const f of writtenFiles) {
    if (countedFiles.has(f)) {
      allCount++;
      matchedAllLines += lineCounts.get(f) ?? 0;
      if (codeFiles.has(f)) {
        codeCount++;
        matchedCodeLines += lineCounts.get(f) ?? 0;
      }
    }
  }

  return {
    all: allCount / countedFiles.size,
    code: codeFiles.size > 0 ? codeCount / codeFiles.size : null,
    allWeighted: totalAllLines > 0 ? matchedAllLines / totalAllLines : null,
    codeWeighted: totalCodeLines > 0 ? matchedCodeLines / totalCodeLines : null,
  };
}
