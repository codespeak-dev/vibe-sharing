import chalk from "chalk";
import type { DiscoveredSession } from "../sessions/types.js";

/**
 * Format bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Display a compact file list with a header.
 * Shows first N files, then "and X more".
 */
export function displayFileList(
  files: string[],
  label: string,
  maxShow: number = 20,
): void {
  console.log();
  console.log(chalk.bold(`${label} (${files.length} files):`));

  const sorted = [...files].sort();
  const toShow = sorted.slice(0, maxShow);

  for (const file of toShow) {
    console.log(chalk.dim("  ") + file);
  }

  if (sorted.length > maxShow) {
    console.log(
      chalk.dim(`  ... and ${sorted.length - maxShow} more files`),
    );
  }
}

/**
 * Display discovered sessions grouped by agent.
 */
export function displaySessionSummary(
  sessionsByAgent: Map<
    string,
    { sessions: DiscoveredSession[] }
  >,
): void {
  console.log();
  console.log(chalk.bold("AI coding sessions found:"));

  for (const [agentName, { sessions }] of sessionsByAgent) {
    const totalSize = sessions.reduce((sum, s) => sum + s.sizeBytes, 0);
    console.log();
    console.log(
      `  ${chalk.cyan(agentName)}: ${sessions.length} session${sessions.length !== 1 ? "s" : ""} (${formatBytes(totalSize)})`,
    );

    for (const session of sessions) {
      const desc =
        session.summary ??
        session.firstPrompt ??
        session.sessionId;
      const truncated = desc.length > 80 ? desc.slice(0, 77) + "..." : desc;
      const meta: string[] = [];
      if (session.messageCount)
        meta.push(`${session.messageCount} messages`);
      if (session.created)
        meta.push(new Date(session.created).toLocaleDateString());

      console.log(
        `    ${chalk.dim("•")} ${truncated}${meta.length ? chalk.dim(` (${meta.join(", ")})`) : ""}`,
      );
    }
  }
}

/**
 * Display a summary of what will be archived.
 */
export function displayArchiveSummary(
  projectFileCount: number,
  sessionFileCount: number,
  totalSizeEstimate: number,
): void {
  console.log();
  console.log(chalk.bold("Archive summary:"));
  console.log(`  Project files:  ${projectFileCount}`);
  console.log(`  Session files:  ${sessionFileCount}`);
  console.log(`  Estimated size: ${formatBytes(totalSizeEstimate)}`);
}

/**
 * Display the list of excluded patterns for non-git projects.
 */
export function displayExcludePatterns(patterns: string[]): void {
  console.log();
  console.log(chalk.bold("Auto-excluded patterns:"));
  for (const pattern of patterns) {
    console.log(chalk.dim(`  ${pattern}`));
  }
}
