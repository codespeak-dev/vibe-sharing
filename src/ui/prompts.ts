import { confirm, input } from "@inquirer/prompts";
import gooseCheckbox from "./goose-checkbox.js";
import chalk from "chalk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiscoveredSession } from "../sessions/types.js";
import type { UploadMetadata } from "../upload/upload.js";

const execFileAsync = promisify(execFile);

async function getGitConfig(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", key]);
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Let the user pick which untracked files to include.
 * Returns the selected file paths.
 */
export async function selectUntrackedFiles(
  files: string[],
): Promise<string[]> {
  if (files.length === 0) return [];

  console.log();
  console.log(
    chalk.yellow(
      `Found ${files.length} untracked file${files.length !== 1 ? "s" : ""} (not committed to git):`,
    ),
  );

  const selected = await gooseCheckbox({
    message: "Select untracked files to include:",
    choices: files.map((f) => ({
      name: f,
      value: f,
      checked: true, // Include by default
    })),
    pageSize: 20,
  });

  return selected;
}

/**
 * Let the user select which sessions to include.
 * Returns the selected session IDs.
 */
export async function selectSessions(
  sessionsByAgent: Map<
    string,
    { sessions: DiscoveredSession[] }
  >,
): Promise<Set<string>> {
  const allSessions: { agent: string; session: DiscoveredSession }[] = [];
  for (const [agent, { sessions }] of sessionsByAgent) {
    for (const session of sessions) {
      allSessions.push({ agent, session });
    }
  }

  if (allSessions.length === 0) return new Set();

  const selected = await gooseCheckbox({
    message: "Select sessions to include:",
    choices: allSessions.map(({ agent, session }) => {
      const desc =
        session.summary ?? session.firstPrompt ?? session.sessionId;
      const truncated = desc.length > 60 ? desc.slice(0, 57) + "..." : desc;
      return {
        name: `[${agent}] ${truncated}`,
        value: session.sessionId,
        checked: true,
      };
    }),
    pageSize: 20,
  });

  return new Set(selected);
}

/**
 * Confirm the final file list before creating the archive.
 */
export async function confirmFileList(): Promise<boolean> {
  return confirm({
    message: "Proceed with creating the archive?",
    default: true,
  });
}

/**
 * Ask the user to customize exclude patterns.
 */
export async function askCustomizeExcludes(): Promise<boolean> {
  return confirm({
    message: "Would you like to customize the exclude patterns?",
    default: false,
  });
}

/**
 * Prompt for optional upload metadata (all fields skippable with Enter).
 */
export async function promptUploadMetadata(
  detectedRepoUrl?: string | null,
): Promise<UploadMetadata> {
  const gitEmail = await getGitConfig("user.email");
  const gitName = await getGitConfig("user.name");

  let userEmail = gitEmail ?? "";
  let userName = gitName ?? "";

  if (!gitEmail || !gitName) {
    console.log();
    console.log(
      chalk.dim("You can optionally provide contact info (press Enter to skip):"),
    );

    if (!gitEmail) {
      userEmail = await input({ message: "Email (optional):" });
    }
    if (!gitName) {
      userName = await input({ message: "Name (optional):" });
    }
  }

  const repoUrl = detectedRepoUrl ?? "";

  return {
    ...(userEmail && { userEmail }),
    ...(userName && { userName }),
    ...(repoUrl && { repoUrl }),
  };
}
