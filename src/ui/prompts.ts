import { confirm, checkbox, select } from "@inquirer/prompts";
import chalk from "chalk";
import type { DiscoveredSession } from "../sessions/types.js";

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

  const selected = await checkbox({
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

  const selected = await checkbox({
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
 * Ask what to do when no sessions are found.
 */
export async function promptNoSessions(): Promise<"browse" | "skip"> {
  const choice = await select({
    message: "No AI coding sessions found for this project. What would you like to do?",
    choices: [
      {
        name: "Continue without sessions",
        value: "skip" as const,
      },
      {
        name: "Browse filesystem to find session files",
        value: "browse" as const,
      },
    ],
  });

  return choice;
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
