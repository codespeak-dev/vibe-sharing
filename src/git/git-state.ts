import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGitRoot, getGitBranch, getGitCommit } from "../utils/paths.js";
import { walkDirectory } from "../utils/fs-helpers.js";
import { shouldExcludeDefault } from "../utils/excludes.js";

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

/**
 * Create a git bundle containing all refs.
 * Returns the absolute path to the bundle file in a temp directory.
 */
async function createGitBundle(cwd: string): Promise<string | null> {
  const bundlePath = path.join(
    os.tmpdir(),
    `codespeak-bundle-${Date.now()}.bundle`,
  );
  try {
    await execFileAsync("git", ["bundle", "create", bundlePath, "--all"], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    return bundlePath;
  } catch {
    // Bundle creation can fail for repos with no commits/refs
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
