import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { ORG_NAME, CONTACT_EMAIL } from "../config.js";

/**
 * Display the privacy notice and get initial consent to proceed with scanning.
 * Returns false if user declines.
 */
export async function showPrivacyNoticeAndConsent(): Promise<boolean> {
  const border = chalk.cyan("║");
  const top = chalk.cyan("╔" + "═".repeat(62) + "╗");
  const bottom = chalk.cyan("╚" + "═".repeat(62) + "╝");

  const pad = (text: string, width: number = 62) => {
    // Strip ANSI for length calculation
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
    const padding = Math.max(0, width - stripped.length);
    return text + " ".repeat(padding);
  };

  console.log();
  console.log(top);
  console.log(
    `${border}  ${pad(chalk.bold("codespeak-vibe-share") + " — Project & Session Collector", 60)}${border}`,
  );
  console.log(`${border}${" ".repeat(62)}${border}`);
  console.log(
    `${border}  ${pad(`This tool helps you share your project and AI coding`, 60)}${border}`,
  );
  console.log(
    `${border}  ${pad(`sessions with ${chalk.bold(ORG_NAME)}.`, 60)}${border}`,
  );
  console.log(`${border}${" ".repeat(62)}${border}`);
  console.log(
    `${border}  ${pad(chalk.green("•") + " You control exactly what gets shared", 60)}${border}`,
  );
  console.log(
    `${border}  ${pad(chalk.green("•") + " You'll review every file before upload", 60)}${border}`,
  );
  console.log(
    `${border}  ${pad(chalk.green("•") + " Nothing leaves your machine without your consent", 60)}${border}`,
  );
  console.log(
    `${border}  ${pad(chalk.green("•") + " No data is collected about you beyond what you share", 60)}${border}`,
  );
  console.log(
    `${border}  ${pad(chalk.green("•") + " You can request deletion at any time", 60)}${border}`,
  );
  console.log(bottom);
  console.log();

  return confirm({
    message: "Proceed with scanning your project and AI sessions?",
    default: true,
  });
}

/**
 * Get explicit consent before uploading.
 * Default is NO — user must actively opt in.
 */
export async function getUploadConsent(
  fileCount: number,
  sizeMB: string,
): Promise<boolean> {
  console.log();
  console.log(
    chalk.yellow(
      `These ${fileCount} files (${sizeMB}) will be shared with ${ORG_NAME}.`,
    ),
  );
  console.log(chalk.dim("No other data will be collected or sent."));
  console.log();

  return confirm({
    message: "Do you consent to sharing these files?",
    default: true,
  });
}

/**
 * Show post-upload message with deletion instructions.
 */
export function showPostUploadInfo(): void {
  console.log();
  console.log(chalk.green.bold("Upload complete!"));
  console.log();
  console.log(
    chalk.dim(
      `You can request deletion at any time by contacting ${CONTACT_EMAIL}.`,
    ),
  );
  console.log();
}
