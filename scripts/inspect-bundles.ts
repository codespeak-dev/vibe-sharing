/**
 * Inspect bundle zip files and write a Markdown report for each one.
 * Usage: npm run inspect-bundles -- <directory>
 */
import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Manifest {
  version: number;
  createdAt: string;
  toolVersion: string;
  project: {
    name: string;
    path: string;
    isGitRepo: boolean;
    gitBranch?: string;
    gitCommit?: string;
    hasBundle?: boolean;
    untrackedFileCount?: number;
    worktrees?: { path: string; branch: string | null }[];
  };
  agents: Record<string, {
    sessionCount: number;
    sessions: { id: string; summary?: string; messageCount?: number }[];
  }>;
  files: {
    projectFileCount: number;
    sessionFileCount: number;
    totalSizeBytes: number;
  };
}

interface ToolUseMsg {
  message?: {
    content?: Array<{
      type?: string;
      name?: string;
      input?: { file_path?: string; content?: string };
    }>;
  };
  cwd?: string;
  timestamp?: string;
  type?: string;
}

interface SessionWindow {
  start: number; // ms
  end: number;   // ms, extended by 60-minute grace period
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMMIT_GRACE_MS = 60 * 60 * 1000; // 60 minutes

/**
 * File extensions excluded from the "files written" coverage metric.
 * These are file types that agents typically cannot or do not generate directly:
 * binary assets, serialised data, compiled artifacts, lock files, etc.
 *
 * Grouped by category for easy auditing.
 */
const EXCLUDED_EXTENSIONS = new Set([
  // Images / icons
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif",
  ".ico", ".avif", ".heic", ".heif",
  // SVG is excluded — it's binary-ish in practice and rarely hand-written by agents
  ".svg",
  // Data / serialised — JSON config files can be agent-written but raw data dumps usually aren't
  ".json", ".jsonl",
  // Fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // Compiled / binary artifacts
  ".wasm", ".pyc", ".pyo", ".class", ".dll", ".so", ".dylib", ".exe", ".o", ".a",
  // Archives and bundles
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".bundle",
  // Media — audio / video
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi", ".mov", ".flac", ".aac", ".m4a",
  // Documents
  ".pdf",
  // Databases
  ".db", ".sqlite", ".sqlite3",
  // Certificates and keys (binary / auto-generated)
  ".pem", ".crt", ".cer", ".key", ".p12", ".pfx", ".der",
  // Auto-generated lock files — tracked by filename, not extension, but worth noting
  // (handled separately below via EXCLUDED_FILENAMES)
]);

/** Exact filenames (basename only) that are always excluded regardless of extension. */
const EXCLUDED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "uv.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "flake.lock",
]);

/**
 * Extensions considered "code files" for the code-only coverage metric.
 * Includes programming languages, component templates, stylesheets, and query languages.
 * Keep in sync with CODE_EXTENSIONS in src/completeness/metrics.ts.
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function pct(value: number | null): string {
  if (value === null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function mdBar(value: number, width = 20): string {
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function isInAnyWindow(ts: number, windows: SessionWindow[]): boolean {
  return windows.some((w) => ts >= w.start && ts <= w.end);
}

/** Returns true if the file at this absolute path should be excluded from coverage counting. */
function isExcluded(absPath: string): boolean {
  const base = path.basename(absPath);
  if (EXCLUDED_FILENAMES.has(base)) return true;
  const ext = path.extname(absPath).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(ext);
}

/** Returns true if this file counts as a "code file" for the code-only coverage metric. */
function isCodeFile(absPath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

/** First N non-empty trimmed lines of a text block, joined by newline. Used for content fingerprinting. */
function fingerprint(text: string, n = 10): string {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join("\n");
}

// ─── Git bundle helpers ───────────────────────────────────────────────────────

interface GitInfo {
  /** Author timestamps of every commit (ms since epoch) */
  commitTimestamps: number[];
  /**
   * Rename map: old relative path → current relative path.
   * Built from `git log --diff-filter=R` across the full history.
   * Used to match agent writes that targeted a path that was later renamed.
   */
  renames: Map<string, string>;
  /**
   * Path to the git clone of the repository bundle.
   * Caller MUST clean up with fs.rmSync(cloneDir, { recursive: true, force: true }).
   */
  cloneDir: string;
}

/**
 * Extract the git bundle from the zip, clone it to a temp dir, and collect:
 *  - all commit author timestamps
 *  - all file renames recorded in the history
 * Returns null if the bundle is missing or git fails.
 */
function readGitInfo(zip: AdmZip): GitInfo | null {
  const bundleEntry = zip.getEntry("project/repo.bundle");
  if (!bundleEntry) return null;

  const bundleFile = path.join(os.tmpdir(), `vibe-inspect-${Date.now()}.bundle`);
  const cloneDir = path.join(os.tmpdir(), `vibe-inspect-clone-${Date.now()}`);
  let success = false;

  try {
    fs.writeFileSync(bundleFile, bundleEntry.getData());
    execFileSync("git", ["clone", "--quiet", bundleFile, cloneDir], { stdio: "pipe" });

    // Commit timestamps
    const logOut = execFileSync(
      "git",
      ["-C", cloneDir, "log", "--all", "--format=%aI"],
      { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
    );
    const commitTimestamps = logOut
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => new Date(line.trim()).getTime())
      .filter((ts) => !isNaN(ts));

    // Rename history: git log --diff-filter=R --name-status
    // Output lines look like:  R091\told/path\tnew/path
    const renameOut = execFileSync(
      "git",
      ["-C", cloneDir, "log", "--all", "--diff-filter=R", "--name-status", "--pretty=format:"],
      { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
    );
    // Map from old → new, following chains: if A→B and B→C, resolve A→C
    const directRenames = new Map<string, string>();
    for (const line of renameOut.split("\n")) {
      const parts = line.split("\t");
      if (parts.length === 3 && parts[0]!.startsWith("R")) {
        directRenames.set(parts[1]!, parts[2]!);
      }
    }
    // Follow chains to get the ultimate current name for any old path
    const renames = new Map<string, string>();
    for (const oldPath of directRenames.keys()) {
      let current = oldPath;
      const seen = new Set<string>();
      while (directRenames.has(current) && !seen.has(current)) {
        seen.add(current);
        current = directRenames.get(current)!;
      }
      if (current !== oldPath) renames.set(oldPath, current);
    }

    success = true;
    return { commitTimestamps, renames, cloneDir }; // caller must clean up cloneDir
  } catch {
    return null;
  } finally {
    try { fs.rmSync(bundleFile, { force: true }); } catch { /* ignore */ }
    // Only clean up cloneDir on failure; on success the caller owns it
    if (!success) {
      try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ─── Bundle inspection ────────────────────────────────────────────────────────

interface MatchCandidate {
  written: string;       // relative path written by agent (not in tracked files)
  candidates: string[];  // relative tracked paths that might be the same file
  reason: "basename" | "content"; // how candidates were found
}

interface BundleReport {
  filename: string;
  sizeBytes: number;
  manifest: Manifest;
  sessionDateRange: { first: Date; last: Date } | null;
  totalMessages: number;
  commitCoverage: number | null;
  writeFileCoverage: number | null;
  writeFileCoverageWithCandidates: number | null; // coverage counting 1 candidate per written file
  trackedFileCount: number;       // counted files only (excludes EXCLUDED_EXTENSIONS / EXCLUDED_FILENAMES)
  codeFileCount: number;          // subset of trackedFiles that are code files
  excludedFileCount: number;      // tracked files skipped from coverage (images, lock files, etc.)
  writtenFileCount: number;       // direct matches
  renamedMatchCount: number;   // matched via git rename history
  heuristicMatchCount: number; // matched via unique-basename heuristic
  contentMatchCount: number;      // matched via content fingerprint
  codeWriteFileCoverage: number | null; // writeFileCoverage restricted to code files
  codeWriteFileCoverageWithCandidates: number | null;
  weightedWriteFileCoverage: number | null;     // line-weighted version of writeFileCoverage
  weightedCodeWriteFileCoverage: number | null; // line-weighted version of codeWriteFileCoverage
  totalCommits: number | null;
  vibedCommits: number | null;
  // relative paths (to projectRoot), sorted
  touchedFiles: string[];
  untouchedFiles: string[];
  excludedFiles: string[];     // tracked files excluded from coverage metric
  writtenNotTracked: string[]; // agent wrote these but they're not in git ls-files (after all resolution)
  heuristicMatches: Array<{ written: string; tracked: string }>; // pairs matched by heuristic
  contentMatches: Array<{ written: string; tracked: string }>;   // pairs matched by content fingerprint
  matchCandidates: MatchCandidate[]; // ambiguous: 2+ potential matches, not counted in coverage
  /** Line counts for tracked files: relative path → line count (0 = unreadable/binary). */
  lineCounts: Map<string, number>;
  error?: string;
}

function inspectBundle(zipPath: string, opts: { includeCandidates?: boolean } = {}): BundleReport {
  const filename = path.basename(zipPath);
  const sizeBytes = fs.statSync(zipPath).size;
  const zip = new AdmZip(zipPath);
  let cloneDir: string | null = null;

  try {
    const manifestEntry = zip.getEntry("manifest.json");
    if (!manifestEntry) {
      return {
        filename, sizeBytes, manifest: {} as Manifest,
        sessionDateRange: null, totalMessages: 0,
        commitCoverage: null,
        writeFileCoverage: null, writeFileCoverageWithCandidates: null,
        codeWriteFileCoverage: null, codeWriteFileCoverageWithCandidates: null,
        weightedWriteFileCoverage: null, weightedCodeWriteFileCoverage: null,
        trackedFileCount: 0, codeFileCount: 0, excludedFileCount: 0,
        writtenFileCount: 0, renamedMatchCount: 0, heuristicMatchCount: 0, contentMatchCount: 0,
        totalCommits: null, vibedCommits: null,
        touchedFiles: [], untouchedFiles: [], excludedFiles: [], writtenNotTracked: [],
        heuristicMatches: [], contentMatches: [], matchCandidates: [],
        lineCounts: new Map(),
        error: "No manifest.json found",
      };
    }
    const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as Manifest;

    // Tracked file list from git ls-files output
    const fileListingEntry = zip.getEntry("project/file-listing.txt");
    const fileListing = fileListingEntry ? fileListingEntry.getData().toString("utf-8") : "";
    const projectRoot = manifest.project.path;
    // Split into files counted toward coverage, code-only subset, and excluded files
    const trackedFiles = new Set<string>();    // counted toward "all files" coverage
    const codeTracked = new Set<string>();     // subset: code files only
    const excludedTracked = new Set<string>(); // excluded from coverage metric entirely
    for (const rel of fileListing.trim().split("\n").filter(Boolean)) {
      const abs = path.resolve(projectRoot, rel);
      if (isExcluded(abs)) {
        excludedTracked.add(abs);
      } else {
        trackedFiles.add(abs);
        if (isCodeFile(abs)) codeTracked.add(abs);
      }
    }

    // Read all JSONL session files — track per-session windows for commit coverage
    const jsonlEntries = zip.getEntries().filter(
      (e) => e.entryName.startsWith("sessions/") && e.entryName.endsWith(".jsonl"),
    );

    const sessionWindows: SessionWindow[] = [];
    const allTimestamps: Date[] = []; // for date range display only
    let totalMessages = 0;
    const writtenFiles = new Set<string>();
    const writeContents = new Map<string, string>(); // abs path → last Write call content

    for (const entry of jsonlEntries) {
      const content = entry.getData().toString("utf-8");
      let sessionMin: number | null = null;
      let sessionMax: number | null = null;

      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: ToolUseMsg;
        try {
          msg = JSON.parse(trimmed) as ToolUseMsg;
        } catch {
          continue;
        }

        if (msg.type === "user" && msg.timestamp) {
          const ts = new Date(msg.timestamp).getTime();
          if (!isNaN(ts)) {
            if (sessionMin === null || ts < sessionMin) sessionMin = ts;
            if (sessionMax === null || ts > sessionMax) sessionMax = ts;
            allTimestamps.push(new Date(ts));
          }
          totalMessages++;
        }

        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (
              block.type === "tool_use" &&
              (block.name === "Edit" || block.name === "Write") &&
              block.input?.file_path
            ) {
              const absPath = path.resolve(msg.cwd ?? projectRoot, block.input.file_path);
              writtenFiles.add(absPath);
              // Track last Write content for content-fingerprint matching
              if (block.name === "Write" && block.input.content) {
                writeContents.set(absPath, block.input.content);
              }
            }
          }
        }
      }

      if (sessionMin !== null) {
        sessionWindows.push({
          start: sessionMin,
          end: (sessionMax ?? sessionMin) + COMMIT_GRACE_MS,
        });
      }
    }

    // Date range for display
    let sessionDateRange: { first: Date; last: Date } | null = null;
    if (allTimestamps.length > 0) {
      allTimestamps.sort((a, b) => a.getTime() - b.getTime());
      sessionDateRange = { first: allTimestamps[0]!, last: allTimestamps[allTimestamps.length - 1]! };
    }

    // Extract git info once (commit timestamps + rename history + clone dir for content matching)
    const gitInfo = readGitInfo(zip);
    if (gitInfo) cloneDir = gitInfo.cloneDir;

    // Resolve rename chains: old absolute path → current absolute path
    const renames = new Map<string, string>();
    if (gitInfo) {
      for (const [oldRel, newRel] of gitInfo.renames) {
        renames.set(
          path.resolve(projectRoot, oldRel),
          path.resolve(projectRoot, newRel),
        );
      }
    }

    // Pass 1: categorise tracked files into directly touched, rename-matched, or preliminarily untouched
    const directTouchedAbs = new Set<string>();
    const renamedTouchedAbs = new Set<string>();
    const prelimUntouchedAbs = new Set<string>();

    for (const absPath of trackedFiles) {
      if (writtenFiles.has(absPath)) {
        directTouchedAbs.add(absPath);
      } else {
        const reachedByRename = [...renames.values()].includes(absPath);
        if (reachedByRename) {
          renamedTouchedAbs.add(absPath);
        } else {
          prelimUntouchedAbs.add(absPath);
        }
      }
    }

    // Pass 1b: written paths with no direct or git-rename match
    const prelimWrittenNotTrackedAbs = new Set<string>();
    for (const absPath of writtenFiles) {
      if (!trackedFiles.has(absPath)) {
        const resolvedCurrent = renames.get(absPath);
        if (!resolvedCurrent || !trackedFiles.has(resolvedCurrent)) {
          prelimWrittenNotTrackedAbs.add(absPath);
        }
      }
    }

    // Pass 2: basename heuristic — if a written-but-untracked path has the same
    // filename as exactly one still-untouched tracked path, treat them as the
    // same file renamed outside of git's knowledge.
    // Files with 2+ basename candidates are saved as match-candidates.
    const untouchedByBasename = new Map<string, string[]>();
    for (const absPath of prelimUntouchedAbs) {
      const base = path.basename(absPath);
      const bucket = untouchedByBasename.get(base) ?? [];
      bucket.push(absPath);
      untouchedByBasename.set(base, bucket);
    }

    const heuristicMatches: Array<{ written: string; tracked: string }> = [];
    const heuristicTouchedAbs = new Set<string>();
    const heuristicMatchedWrittenAbs = new Set<string>();
    const matchCandidates: MatchCandidate[] = [];
    // Track which written paths are already saved as candidates (don't double-add)
    const savedAsCandidateWritten = new Set<string>();

    for (const writtenAbs of prelimWrittenNotTrackedAbs) {
      const base = path.basename(writtenAbs);
      const candidates = untouchedByBasename.get(base);
      if (candidates && candidates.length === 1) {
        const trackedAbs = candidates[0]!;
        if (!heuristicTouchedAbs.has(trackedAbs)) {
          heuristicMatches.push({
            written: path.relative(projectRoot, writtenAbs),
            tracked: path.relative(projectRoot, trackedAbs),
          });
          heuristicTouchedAbs.add(trackedAbs);
          heuristicMatchedWrittenAbs.add(writtenAbs);
        }
      } else if (candidates && candidates.length > 1) {
        // Ambiguous basename match — save as candidate
        matchCandidates.push({
          written: path.relative(projectRoot, writtenAbs),
          candidates: candidates.map((c) => path.relative(projectRoot, c)),
          reason: "basename",
        });
        savedAsCandidateWritten.add(writtenAbs);
      }
    }

    // Pass 3: content fingerprint matching — for still-unresolved written paths
    // that have Write content, compare first-10-line fingerprint against same-extension
    // untouched tracked files read from the git clone.
    const contentMatches: Array<{ written: string; tracked: string }> = [];
    const contentMatchedTouchedAbs = new Set<string>();
    const contentMatchedWrittenAbs = new Set<string>();

    if (cloneDir) {
      // Group still-untouched tracked files by extension
      const stillUntouched = new Set(
        [...prelimUntouchedAbs].filter((p) => !heuristicTouchedAbs.has(p)),
      );
      const untouchedByExt = new Map<string, string[]>();
      for (const absPath of stillUntouched) {
        const ext = path.extname(absPath).toLowerCase();
        const bucket = untouchedByExt.get(ext) ?? [];
        bucket.push(absPath);
        untouchedByExt.set(ext, bucket);
      }

      for (const writtenAbs of prelimWrittenNotTrackedAbs) {
        if (heuristicMatchedWrittenAbs.has(writtenAbs)) continue; // already matched
        const content = writeContents.get(writtenAbs);
        if (!content) continue;
        const fp = fingerprint(content);
        if (!fp) continue;
        const ext = path.extname(writtenAbs).toLowerCase();
        const candidates = untouchedByExt.get(ext);
        if (!candidates || candidates.length === 0) continue;

        const matching: string[] = [];
        for (const trackedAbs of candidates) {
          if (contentMatchedTouchedAbs.has(trackedAbs)) continue;
          const relPath = path.relative(projectRoot, trackedAbs);
          const cloneFilePath = path.join(cloneDir, relPath);
          try {
            const cloneContent = fs.readFileSync(cloneFilePath, "utf-8");
            if (fingerprint(cloneContent) === fp) matching.push(trackedAbs);
          } catch {
            // File not in clone (deleted or binary)
          }
        }

        if (matching.length === 1) {
          const trackedAbs = matching[0]!;
          contentMatches.push({
            written: path.relative(projectRoot, writtenAbs),
            tracked: path.relative(projectRoot, trackedAbs),
          });
          contentMatchedTouchedAbs.add(trackedAbs);
          contentMatchedWrittenAbs.add(writtenAbs);
          // Remove from candidates list if it was previously listed there
          savedAsCandidateWritten.delete(writtenAbs);
        } else if (matching.length > 1 && !savedAsCandidateWritten.has(writtenAbs)) {
          // Ambiguous content match — save as candidate (skip if basename already saved it)
          matchCandidates.push({
            written: path.relative(projectRoot, writtenAbs),
            candidates: matching.map((c) => path.relative(projectRoot, c)),
            reason: "content",
          });
          savedAsCandidateWritten.add(writtenAbs);
        }
      }
    }

    // Final lists
    const touchedFiles = [...directTouchedAbs]
      .map((p) => path.relative(projectRoot, p)).sort();
    const renamedFiles = [...renamedTouchedAbs]
      .map((p) => `${path.relative(projectRoot, p)} ↩︎`).sort();
    const heuristicFiles = heuristicMatches
      .map((m) => `${m.tracked} ≈`).sort();
    const contentFiles = contentMatches
      .map((m) => `${m.tracked} ≈≈`).sort();
    const untouchedFiles = [...prelimUntouchedAbs]
      .filter((p) => !heuristicTouchedAbs.has(p) && !contentMatchedTouchedAbs.has(p))
      .map((p) => path.relative(projectRoot, p)).sort();
    const excludedFiles = [...excludedTracked]
      .map((p) => path.relative(projectRoot, p)).sort();
    const writtenNotTracked = [...prelimWrittenNotTrackedAbs]
      .filter((p) => !heuristicMatchedWrittenAbs.has(p) && !contentMatchedWrittenAbs.has(p) && !savedAsCandidateWritten.has(p))
      .map((p) => path.relative(projectRoot, p)).sort();

    const writtenMatchCount = directTouchedAbs.size;
    const renamedMatchCount = renamedTouchedAbs.size;
    const heuristicMatchCount = heuristicMatches.length;
    const contentMatchCount = contentMatches.length;
    const definitiveMatches = writtenMatchCount + renamedMatchCount + heuristicMatchCount + contentMatchCount;
    const writeFileCoverage =
      trackedFiles.size > 0 ? definitiveMatches / trackedFiles.size : null;
    // With candidates: count 1 match per candidate entry
    const writeFileCoverageWithCandidates =
      trackedFiles.size > 0
        ? (definitiveMatches + matchCandidates.length) / trackedFiles.size
        : null;

    // Code-only coverage: same numerators but restricted to code files
    const allTouchedAbs = new Set([
      ...directTouchedAbs,
      ...renamedTouchedAbs,
      ...heuristicTouchedAbs,
      ...contentMatchedTouchedAbs,
    ]);
    const codeDefinitiveMatches = [...allTouchedAbs].filter((p) => codeTracked.has(p)).length;
    const codeCandidateMatches = matchCandidates.filter((mc) =>
      mc.candidates.some((c) => codeTracked.has(path.resolve(projectRoot, c))),
    ).length;
    const codeWriteFileCoverage =
      codeTracked.size > 0 ? codeDefinitiveMatches / codeTracked.size : null;
    const codeWriteFileCoverageWithCandidates =
      codeTracked.size > 0
        ? (codeDefinitiveMatches + codeCandidateMatches) / codeTracked.size
        : null;

    // Line counts for all tracked files (counted + excluded), read from the git clone.
    // Keys are relative paths (no suffix annotations). Used for weighted coverage and
    // for annotating file listings in the report. 0 means unreadable / binary.
    const lineCounts = new Map<string, number>();

    // Line-weighted coverage: each file contributes its line count as weight.
    // Files are read from the git clone so the counts reflect the committed state.
    let weightedWriteFileCoverage: number | null = null;
    let weightedCodeWriteFileCoverage: number | null = null;
    if (cloneDir) {
      let totalAllLines = 0;
      let totalCodeLines = 0;
      let matchedAllLines = 0;
      let matchedCodeLines = 0;

      for (const absPath of trackedFiles) {
        const relPath = path.relative(projectRoot, absPath);
        const cloneFilePath = path.join(cloneDir, relPath);
        let lineCount = 0;
        try {
          lineCount = fs.readFileSync(cloneFilePath, "utf-8").split("\n").length;
        } catch { /* binary or missing — weight 0 */ }

        lineCounts.set(relPath, lineCount);
        totalAllLines += lineCount;
        if (codeTracked.has(absPath)) totalCodeLines += lineCount;

        if (allTouchedAbs.has(absPath)) {
          matchedAllLines += lineCount;
          if (codeTracked.has(absPath)) matchedCodeLines += lineCount;
        }
      }

      // Also count excluded tracked files (for listing display only, not weighted coverage)
      for (const absPath of excludedTracked) {
        const relPath = path.relative(projectRoot, absPath);
        const cloneFilePath = path.join(cloneDir, relPath);
        let lineCount = 0;
        try {
          lineCount = fs.readFileSync(cloneFilePath, "utf-8").split("\n").length;
        } catch { /* binary or missing */ }
        lineCounts.set(relPath, lineCount);
      }

      if (totalAllLines > 0) weightedWriteFileCoverage = matchedAllLines / totalAllLines;
      if (totalCodeLines > 0) weightedCodeWriteFileCoverage = matchedCodeLines / totalCodeLines;
    }

    // Commit coverage
    let commitCoverage: number | null = null;
    let totalCommits: number | null = null;
    let vibedCommits: number | null = null;

    if (sessionWindows.length > 0 && gitInfo && gitInfo.commitTimestamps.length > 0) {
      totalCommits = gitInfo.commitTimestamps.length;
      vibedCommits = gitInfo.commitTimestamps.filter((ts) => isInAnyWindow(ts, sessionWindows)).length;
      commitCoverage = vibedCommits / totalCommits;
    }

    return {
      filename,
      sizeBytes,
      manifest,
      sessionDateRange,
      totalMessages,
      commitCoverage,
      writeFileCoverage: opts.includeCandidates ? writeFileCoverageWithCandidates : writeFileCoverage,
      writeFileCoverageWithCandidates,
      codeWriteFileCoverage: opts.includeCandidates ? codeWriteFileCoverageWithCandidates : codeWriteFileCoverage,
      codeWriteFileCoverageWithCandidates,
      weightedWriteFileCoverage,
      weightedCodeWriteFileCoverage,
      trackedFileCount: trackedFiles.size,
      codeFileCount: codeTracked.size,
      excludedFileCount: excludedTracked.size,
      writtenFileCount: writtenMatchCount,
      renamedMatchCount,
      heuristicMatchCount,
      contentMatchCount,
      totalCommits,
      vibedCommits,
      touchedFiles: [...touchedFiles, ...renamedFiles, ...heuristicFiles, ...contentFiles],
      untouchedFiles,
      excludedFiles,
      writtenNotTracked,
      heuristicMatches,
      contentMatches,
      matchCandidates,
      lineCounts,
    };
  } finally {
    if (cloneDir) {
      try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function buildMarkdown(report: BundleReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.filename}`);
  lines.push("");

  if (report.error) {
    lines.push(`> **Error:** ${report.error}`);
    return lines.join("\n");
  }

  const { manifest } = report;
  const { project } = manifest;
  const agentEntries = Object.entries(manifest.agents);
  const totalSessions = agentEntries.reduce((n, [, a]) => n + a.sessionCount, 0);

  // Project
  lines.push("## Project");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Name | ${project.name} |`);
  lines.push(`| Path | \`${project.path}\` |`);
  if (project.gitBranch) {
    const ref = project.gitCommit
      ? `\`${project.gitBranch}\` @ \`${project.gitCommit}\``
      : `\`${project.gitBranch}\``;
    lines.push(`| Branch | ${ref} |`);
  }
  lines.push(`| Created at | ${fmtDate(manifest.createdAt)} |`);
  lines.push(`| Tool version | ${manifest.toolVersion} |`);
  if (project.worktrees && project.worktrees.length > 1) {
    lines.push(`| Worktrees | ${project.worktrees.length} |`);
  }
  lines.push(`| Zip size | ${formatBytes(report.sizeBytes)} |`);
  lines.push("");

  // Agents
  lines.push("## Agents");
  lines.push("");
  if (agentEntries.length === 0) {
    lines.push("_(none)_");
  } else {
    lines.push("| Agent | Sessions |");
    lines.push("|---|---|");
    for (const [name, info] of agentEntries) {
      lines.push(`| ${name} | ${info.sessionCount} |`);
    }
  }
  lines.push("");

  // Sessions
  lines.push("## Sessions");
  lines.push("");
  if (totalSessions === 0) {
    lines.push("_(none)_");
  } else {
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(`| Total | ${totalSessions} |`);
    lines.push(`| Messages | ${report.totalMessages} |`);
    if (report.sessionDateRange) {
      const { first, last } = report.sessionDateRange;
      const spanDays = Math.round((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
      const rangeStr = first.toDateString() === last.toDateString()
        ? fmtDate(first.toISOString())
        : `${fmtDate(first.toISOString())} → ${fmtDate(last.toISOString())} (${spanDays}d span)`;
      lines.push(`| Date range | ${rangeStr} |`);
    }

    for (const [agentName, info] of agentEntries) {
      if (info.sessions.length === 0) continue;
      lines.push("");
      lines.push(`### ${agentName}`);
      lines.push("");
      lines.push("| Session | Messages | Summary |");
      lines.push("|---|---|---|");
      for (const s of info.sessions) {
        const msgs = s.messageCount != null ? String(s.messageCount) : "—";
        const summary = s.summary ? s.summary.replace(/\|/g, "\\|") : "—";
        lines.push(`| \`${s.id.slice(0, 8)}…\` | ${msgs} | ${summary} |`);
      }
    }
  }
  lines.push("");

  // Coverage
  lines.push("## Coverage");
  lines.push("");
  lines.push("| Metric | Value | Detail |");
  lines.push("|---|---|---|");

  const cc = report.commitCoverage;
  if (cc !== null && report.totalCommits !== null && report.vibedCommits !== null) {
    lines.push(`| Commits | **${pct(cc)}** \`${mdBar(cc)}\` | ${report.vibedCommits} / ${report.totalCommits} commits |`);
  } else {
    const reason = report.manifest.project?.hasBundle === false ? "no git bundle in archive" : "no sessions with timestamps";
    lines.push(`| Commits | n/a | ${reason} |`);
  }

  const wfc = report.writeFileCoverage;
  if (wfc !== null) {
    const matchParts = [`${report.writtenFileCount} direct`];
    if (report.renamedMatchCount > 0) matchParts.push(`${report.renamedMatchCount} rename`);
    if (report.heuristicMatchCount > 0) matchParts.push(`${report.heuristicMatchCount} basename`);
    if (report.contentMatchCount > 0) matchParts.push(`${report.contentMatchCount} content`);
    if (report.matchCandidates.length > 0) {
      matchParts.push(`${report.matchCandidates.length} candidates (→ ${pct(report.writeFileCoverageWithCandidates)} with candidates)`);
    }
    const allWeighted = report.weightedWriteFileCoverage;
    const allValueStr = allWeighted !== null
      ? `**${pct(wfc)}** / **${pct(allWeighted)}w**`
      : `**${pct(wfc)}**`;
    const allDetail = `${matchParts.join(" + ")} / ${report.trackedFileCount} counted`;
    lines.push(`| Files (all)  | ${allValueStr} \`${mdBar(wfc)}\` | ${allDetail} |`);

    const cwfc = report.codeWriteFileCoverage;
    if (cwfc !== null) {
      const codeWeighted = report.weightedCodeWriteFileCoverage;
      const codeValueStr = codeWeighted !== null
        ? `**${pct(cwfc)}** / **${pct(codeWeighted)}w**`
        : `**${pct(cwfc)}**`;
      const codeDetail = `${report.codeFileCount} code files` +
        (report.codeWriteFileCoverageWithCandidates !== cwfc
          ? ` (→ ${pct(report.codeWriteFileCoverageWithCandidates)} with candidates)`
          : "");
      lines.push(`| Files (code) | ${codeValueStr} \`${mdBar(cwfc)}\` | ${codeDetail} |`);
    } else {
      lines.push(`| Files (code) | n/a | no code files found |`);
    }

    if (report.excludedFileCount > 0) {
      lines.push(`| Excluded files | ${report.excludedFileCount} | images, lock files, binaries — not counted toward coverage |`);
    }
  } else {
    lines.push("| Files (all)  | n/a | no file listing in bundle |");
    lines.push("| Files (code) | n/a | no file listing in bundle |");
  }
  lines.push("");

  // File detail spoiler
  const hasFileDetails = report.trackedFileCount > 0 || report.excludedFileCount > 0;
  if (hasFileDetails) {
    // Helpers for line-count annotation and suffix stripping
    const stripSuffix = (entry: string): string => {
      if (entry.endsWith(" ↩︎")) return entry.slice(0, -" ↩︎".length);
      if (entry.endsWith(" ≈≈")) return entry.slice(0, -" ≈≈".length);
      if (entry.endsWith(" ≈")) return entry.slice(0, -" ≈".length);
      return entry;
    };
    const lc = (relPath: string): string => {
      const n = report.lineCounts.get(relPath);
      return n ? ` _(${n})_` : "";
    };
    const fmtFile = (entry: string): string => `- \`${entry}\`${lc(stripSuffix(entry))}`;
    const fmtCandidate = (rel: string): string => `\`${rel}\`${lc(rel)}`;

    // Split touched files by code / other
    const touchedCode = report.touchedFiles.filter((f) => isCodeFile(stripSuffix(f)));
    const touchedOther = report.touchedFiles.filter((f) => !isCodeFile(stripSuffix(f)));
    const untouchedCode = report.untouchedFiles.filter((f) => isCodeFile(f));
    const untouchedOther = report.untouchedFiles.filter((f) => !isCodeFile(f));

    lines.push("<details>");
    const matchedCount = report.writtenFileCount + report.renamedMatchCount + report.heuristicMatchCount + report.contentMatchCount;
    const excludedNote = report.excludedFileCount > 0 ? `; ${report.excludedFileCount} excluded` : "";
    lines.push(
      `<summary>File details — ${report.untouchedFiles.length} untouched / ${report.trackedFileCount} counted` +
      ` (${matchedCount} matched: ${report.writtenFileCount} direct, ${report.renamedMatchCount} rename,` +
      ` ${report.heuristicMatchCount} basename, ${report.contentMatchCount} content;` +
      ` ${report.matchCandidates.length} candidates${excludedNote})</summary>`,
    );
    lines.push("");
    lines.push("_Legend: no suffix = direct match, ↩︎ = git rename, ≈ = basename heuristic, ≈≈ = content fingerprint. Line counts in parentheses._");
    lines.push("");

    if (touchedCode.length > 0) {
      lines.push(`### Touched — code files (${touchedCode.length})`);
      lines.push("");
      for (const f of touchedCode) lines.push(fmtFile(f));
      lines.push("");
    }

    if (touchedOther.length > 0) {
      lines.push(`### Touched — other files (${touchedOther.length})`);
      lines.push("");
      for (const f of touchedOther) lines.push(fmtFile(f));
      lines.push("");
    }

    if (untouchedCode.length > 0) {
      lines.push(`### Not touched — code files (${untouchedCode.length})`);
      lines.push("");
      for (const f of untouchedCode) lines.push(fmtFile(f));
      lines.push("");
    }

    if (untouchedOther.length > 0) {
      lines.push(`### Not touched — other files (${untouchedOther.length})`);
      lines.push("");
      for (const f of untouchedOther) lines.push(fmtFile(f));
      lines.push("");
    }

    if (report.matchCandidates.length > 0) {
      lines.push(`### Match candidates — ambiguous, not counted in coverage (${report.matchCandidates.length})`);
      lines.push("");
      lines.push("_Agent wrote these paths but multiple tracked files are plausible matches. Listed for manual review._");
      lines.push("");
      for (const { written, candidates, reason } of report.matchCandidates) {
        lines.push(`- \`${written}\` (${reason} — ${candidates.length} candidates)`);
        for (const c of candidates) lines.push(`  - ${fmtCandidate(c)}`);
      }
      lines.push("");
    }

    if (report.heuristicMatches.length > 0) {
      lines.push(`### Matched via basename heuristic (${report.heuristicMatches.length})`);
      lines.push("");
      lines.push("_Written path has the same filename as exactly one untouched tracked file — likely the same file after a directory rename not recorded in git._");
      lines.push("");
      lines.push("| Written by agent | Current tracked path |");
      lines.push("|---|---|");
      for (const { written, tracked } of report.heuristicMatches) {
        lines.push(`| \`${written}\` | ${fmtCandidate(tracked)} |`);
      }
      lines.push("");
    }

    if (report.contentMatches.length > 0) {
      lines.push(`### Matched via content fingerprint (${report.contentMatches.length})`);
      lines.push("");
      lines.push("_First ~10 non-empty lines of the last Write call match exactly one untouched tracked file of the same extension._");
      lines.push("");
      lines.push("| Written by agent | Current tracked path |");
      lines.push("|---|---|");
      for (const { written, tracked } of report.contentMatches) {
        lines.push(`| \`${written}\` | ${fmtCandidate(tracked)} |`);
      }
      lines.push("");
    }

    if (report.writtenNotTracked.length > 0) {
      lines.push(`### Written by agent but not matched (${report.writtenNotTracked.length})`);
      lines.push("");
      lines.push("_Targeted by Edit/Write but no tracked file matched with confidence — deleted files, paths outside project root, or no suitable match found._");
      lines.push("");
      for (const f of report.writtenNotTracked) lines.push(`- \`${f}\``);
      lines.push("");
    }

    if (report.excludedFiles.length > 0) {
      lines.push(`### Excluded from coverage (${report.excludedFiles.length})`);
      lines.push("");
      lines.push("_Images, lock files, compiled artifacts, etc. — tracked in git but not counted toward coverage._");
      lines.push("");
      for (const f of report.excludedFiles) lines.push(fmtFile(f));
      lines.push("");
    }

    lines.push("</details>");
    lines.push("");
  }

  // Archive
  lines.push("## Archive");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Project files | ${manifest.files.projectFileCount} |`);
  lines.push(`| Session files | ${manifest.files.sessionFileCount} |`);
  lines.push(`| Reported size | ${formatBytes(manifest.files.totalSizeBytes)} |`);
  lines.push(`| Zip size | ${formatBytes(report.sizeBytes)} |`);
  lines.push("");

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const includeCandidates = args.includes("--include-candidates");
const positional = args.filter((a) => !a.startsWith("--"));

const dir = positional[0];
if (!dir) {
  console.error("Usage: npm run inspect-bundles -- <directory> [--include-candidates]");
  console.error("  --include-candidates  Count ambiguous match candidates toward file coverage");
  process.exit(1);
}

if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Not a directory: ${dir}`);
  process.exit(1);
}

const zipFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".zip"))
  .sort()
  .map((f) => path.join(dir, f));

if (zipFiles.length === 0) {
  console.log("No .zip files found in directory.");
  process.exit(0);
}

console.log(`Found ${zipFiles.length} bundle${zipFiles.length !== 1 ? "s" : ""} in ${dir}${includeCandidates ? " (--include-candidates)" : ""}`);

for (const zipPath of zipFiles) {
  const outPath = zipPath + ".md";
  try {
    const report = inspectBundle(zipPath, { includeCandidates });
    const md = buildMarkdown(report);
    fs.writeFileSync(outPath, md, "utf-8");
    if (report.error) {
      console.log(`  ${path.basename(zipPath)}  ERROR: ${report.error}`);
    } else {
      const cc = report.commitCoverage;
      const wfc = report.writeFileCoverage;
      const cwfc = report.codeWriteFileCoverage;
      const candidateNote = report.matchCandidates.length > 0
        ? ` (${report.matchCandidates.length} candidates)`
        : "";
      const wwfc = report.weightedWriteFileCoverage;
      const wcwfc = report.weightedCodeWriteFileCoverage;
      console.log(
        `  ${path.basename(zipPath)}  ${report.manifest.project?.name ?? "?"}` +
        `  commits:${pct(cc)}` +
        `  files:${pct(wfc)}/${pct(wwfc)}w` +
        `  code:${pct(cwfc)}/${pct(wcwfc)}w` +
        `${candidateNote}  →  ${outPath}`,
      );
    }
  } catch (err) {
    console.error(`  ${path.basename(zipPath)}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}
