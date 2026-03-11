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
  trackedFiles: string[];
  untrackedFiles: string[];
}

export interface NonGitState {
  isGitRepo: false;
  root: string;
  allFiles: string[];
  excludedPatterns: string[];
}

export type ProjectFileState = GitState | NonGitState;

/**
 * Run a git command and return stdout lines. Returns empty array on error.
 */
async function gitLines(
  args: string[],
  cwd: string,
): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
  });
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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
    const [trackedFiles, untrackedFiles, branch, commit] = await Promise.all([
      gitLines(["ls-files"], gitRoot),
      gitLines(["ls-files", "--others", "--exclude-standard"], gitRoot),
      getGitBranch(gitRoot),
      getGitCommit(gitRoot),
    ]);

    return {
      isGitRepo: true,
      root: gitRoot,
      branch,
      commit,
      trackedFiles,
      untrackedFiles,
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
