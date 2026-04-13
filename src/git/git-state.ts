import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGitRoot, getGitBranch, getGitCommit } from "../utils/paths.js";
import { walkDirectory } from "../utils/fs-helpers.js";
import { shouldExcludeDefault } from "../utils/excludes.js";
import { MAX_ARCHIVE_SIZE_MB } from "../config.js";
import { VibeError } from "../utils/errors.js";

const execFileAsync = promisify(execFile);

export interface GitState {
  isGitRepo: true;
  root: string;
  branch: string | null;
  commit: string | null;
  gitStatusOutput: string;
  gitDiffOutput: string;
  gitDiffStagedOutput: string;
  fileListing: string;
  untrackedFiles: string[];
  bundlePath: string | null;
}

export interface NonGitState {
  isGitRepo: false;
  root: string;
  allFiles: string[];
  excludedPatterns: string[];
}

export type ProjectFileState = GitState | NonGitState;

/**
 * Run a git command and return raw stdout. Throws on error.
 */
async function gitOutput(
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
  });
  return stdout;
}

/**
 * Run a git command and return stdout lines (trimmed, non-empty).
 */
async function gitLines(
  args: string[],
  cwd: string,
): Promise<string[]> {
  const out = await gitOutput(args, cwd);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const BUNDLE_SIZE_LIMIT = MAX_ARCHIVE_SIZE_MB * 1024 * 1024;

/**
 * Create a git bundle. Tries `--all` first; if the result exceeds the archive
 * size limit, falls back to `HEAD` only. Throws a VibeError if even HEAD is
 * too large. Returns null if bundle creation fails entirely (e.g. no commits).
 */
async function createGitBundle(cwd: string): Promise<string | null> {
  const bundlePath = path.join(
    os.tmpdir(),
    `codespeak-bundle-${Date.now()}.bundle`,
  );

  // Try --all first
  try {
    await execFileAsync("git", ["bundle", "create", bundlePath, "--all"], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    const { size } = await fsp.stat(bundlePath);
    if (size <= BUNDLE_SIZE_LIMIT) {
      return bundlePath;
    }
    // Too large — discard and try HEAD only
    await fsp.unlink(bundlePath).catch(() => {});
  } catch {
    // Bundle creation failed (no commits/refs, etc.)
    await fsp.unlink(bundlePath).catch(() => {});
    return null;
  }

  // Fall back to HEAD only
  try {
    await execFileAsync("git", ["bundle", "create", bundlePath, "HEAD"], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    const { size } = await fsp.stat(bundlePath);
    if (size <= BUNDLE_SIZE_LIMIT) {
      return bundlePath;
    }
    await fsp.unlink(bundlePath).catch(() => {});
    throw new VibeError(
      `Git bundle exceeds ${MAX_ARCHIVE_SIZE_MB} MB even with HEAD only.`,
      "Your repository history contains very large files. Consider cleaning up large blobs with git-filter-repo before sharing.",
    );
  } catch (err) {
    if (err instanceof VibeError) throw err;
    // HEAD bundle failed (detached HEAD with no commits, etc.)
    return null;
  }
}

/**
 * Detect git state for the current directory.
 * Returns GitState if it's a repo, NonGitState with exclude-pattern-based file list otherwise.
 */
export async function detectProjectFiles(
  cwd: string,
): Promise<ProjectFileState> {
  const gitRoot = await getGitRoot(cwd);

  if (gitRoot) {
    const [
      gitStatusOutput,
      gitDiffOutput,
      gitDiffStagedOutput,
      trackedFiles,
      untrackedFiles,
      branch,
      commit,
      bundlePath,
    ] = await Promise.all([
      gitOutput(["status"], gitRoot),
      gitOutput(["diff"], gitRoot),
      gitOutput(["diff", "--staged"], gitRoot),
      gitLines(["ls-files"], gitRoot),
      gitLines(["ls-files", "--others", "--exclude-standard"], gitRoot),
      getGitBranch(gitRoot),
      getGitCommit(gitRoot),
      createGitBundle(gitRoot),
    ]);

    // Build file listing: tracked + untracked, sorted
    const allFiles = [...trackedFiles, ...untrackedFiles].sort();
    const fileListing = allFiles.join("\n");

    return {
      isGitRepo: true,
      root: gitRoot,
      branch,
      commit,
      gitStatusOutput,
      gitDiffOutput,
      gitDiffStagedOutput,
      fileListing,
      untrackedFiles,
      bundlePath,
    };
  }

  // Not a git repo — walk with default excludes
  const allFiles = await walkDirectory(cwd, shouldExcludeDefault);

  return {
    isGitRepo: false,
    root: cwd,
    allFiles,
    excludedPatterns: [],
  };
}

/**
 * Remove the temporary git bundle file.
 */
export function cleanupBundle(bundlePath: string): void {
  try {
    fs.unlinkSync(bundlePath);
  } catch {
    // Best effort cleanup
  }
}
