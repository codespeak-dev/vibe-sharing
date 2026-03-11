import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLAUDE_PROJECTS_DIR } from "../config.js";

const execFileAsync = promisify(execFile);

/**
 * Encode a project path the way Claude Code does:
 * replace all path separators with "-".
 * e.g. /Users/foo/proj → -Users-foo-proj
 * e.g. C:\Users\foo\proj → -C-Users-foo-proj (Windows, after normalization)
 */
export function encodeProjectPath(absolutePath: string): string {
  // Normalize to forward slashes, then replace all "/" with "-"
  const normalized = absolutePath.replace(/\\/g, "/");
  return normalized.replace(/\//g, "-");
}

/**
 * Get the Claude Code session directory for a project path.
 */
export function getClaudeSessionDir(projectPath: string): string {
  return path.join(CLAUDE_PROJECTS_DIR, encodeProjectPath(projectPath));
}

/**
 * Get the git repository root for a directory.
 * Returns null if not a git repo or git is not installed.
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get current git branch. Returns null if not available.
 */
export async function getGitBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get current git commit hash (short). Returns null if not available.
 */
export async function getGitCommit(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}
