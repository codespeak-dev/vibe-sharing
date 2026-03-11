import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { detectProjectFiles } from "./git/git-state.js";
import { discoverAllSessions } from "./sessions/discovery.js";
import { buildManifest } from "./archive/manifest.js";
import { createArchive, cleanupArchive } from "./archive/archiver.js";
import { uploadArchive, isBackendAvailable, saveLocally } from "./upload/upload.js";
import {
  showPrivacyNoticeAndConsent,
  getUploadConsent,
  showPostUploadInfo,
} from "./ui/consent.js";
import {
  displayFileList,
  displaySessionSummary,
  displayArchiveSummary,
  displayExcludePatterns,
  formatBytes,
} from "./ui/display.js";
import {
  selectUntrackedFiles,
  selectSessions,
  promptNoSessions,
  confirmFileList,
} from "./ui/prompts.js";
import { getDefaultExcludeDescription } from "./utils/excludes.js";
import { MAX_ARCHIVE_SIZE_MB } from "./config.js";
import { VibeError, archiveTooLarge } from "./utils/errors.js";
import type { AgentProvider, DiscoveredSession } from "./sessions/types.js";

export interface CliOptions {
  dryRun?: boolean;
  sessions?: boolean;
  output?: string;
  verbose?: boolean;
}

export async function run(options: CliOptions): Promise<void> {
  let zipPath: string | null = null;

  try {
    // ─── Step 1: Privacy Notice ───
    const consent = await showPrivacyNoticeAndConsent();
    if (!consent) {
      console.log(chalk.dim("Cancelled. No data was collected."));
      return;
    }

    // ─── Step 2: Detect project files ───
    const spinner = ora("Scanning project files...").start();
    const cwd = process.cwd();
    const projectState = await detectProjectFiles(cwd);
    spinner.stop();

    let projectFiles: string[];

    if (projectState.isGitRepo) {
      console.log(
        chalk.dim(
          `Git repository detected at ${projectState.root} (${projectState.branch ?? "unknown branch"})`,
        ),
      );

      projectFiles = [...projectState.trackedFiles];

      // Handle untracked files
      if (projectState.untrackedFiles.length > 0) {
        const selected = await selectUntrackedFiles(
          projectState.untrackedFiles,
        );
        projectFiles.push(...selected);
      }
    } else {
      console.log(chalk.dim("Not a git repository. Using exclude patterns."));
      displayExcludePatterns(getDefaultExcludeDescription());
      projectFiles = projectState.allFiles;
    }

    displayFileList(projectFiles, "Project files");

    // ─── Step 3: Discover sessions ───
    let sessionsByAgent = new Map<
      string,
      { provider: AgentProvider; sessions: DiscoveredSession[] }
    >();
    let selectedSessionIds = new Set<string>();

    if (options.sessions !== false) {
      const sessionSpinner = ora("Discovering AI coding sessions...").start();
      const discovery = await discoverAllSessions(projectState.root);
      sessionSpinner.stop();

      if (discovery.totalSessions > 0) {
        displaySessionSummary(discovery.byAgent);
        selectedSessionIds = await selectSessions(discovery.byAgent);
        sessionsByAgent = discovery.byAgent;
      } else {
        const choice = await promptNoSessions();
        if (choice === "browse") {
          console.log(
            chalk.dim(
              "Manual session browsing is not yet implemented. Proceeding without sessions.",
            ),
          );
        }
      }
    }

    // ─── Step 4: Count session files ───
    let sessionFileCount = 0;
    for (const [, { provider, sessions }] of sessionsByAgent) {
      for (const session of sessions) {
        if (!selectedSessionIds.has(session.sessionId)) continue;
        const files = await provider.getSessionFiles(session);
        sessionFileCount += files.length;
      }
    }

    // Size estimate (rough — actual zip will be smaller due to compression)
    let totalSizeEstimate = 0;
    for (const [, { sessions }] of sessionsByAgent) {
      for (const s of sessions) {
        if (selectedSessionIds.has(s.sessionId)) {
          totalSizeEstimate += s.sizeBytes;
        }
      }
    }
    // Add rough project file size estimate (we don't stat every file for speed)
    // Session sizes are known precisely; project files are typically smaller

    displayArchiveSummary(
      projectFiles.length,
      sessionFileCount,
      totalSizeEstimate,
    );

    // ─── Step 5: Confirm ───
    if (!options.dryRun) {
      const proceed = await confirmFileList();
      if (!proceed) {
        console.log(chalk.dim("Cancelled. No data was collected or shared."));
        return;
      }
    } else {
      console.log();
      console.log(chalk.cyan("Dry run — skipping archive creation."));
      return;
    }

    // ─── Step 6: Create archive ───
    // Build manifest with only selected sessions
    const filteredSessionsByAgent = new Map<
      string,
      { sessions: DiscoveredSession[] }
    >();
    for (const [name, { sessions }] of sessionsByAgent) {
      const filtered = sessions.filter((s) =>
        selectedSessionIds.has(s.sessionId),
      );
      if (filtered.length > 0) {
        filteredSessionsByAgent.set(name, { sessions: filtered });
      }
    }

    const manifest = buildManifest({
      projectName: path.basename(projectState.root),
      projectPath: projectState.root,
      isGitRepo: projectState.isGitRepo,
      gitBranch: projectState.isGitRepo ? projectState.branch : undefined,
      gitCommit: projectState.isGitRepo ? projectState.commit : undefined,
      projectFileCount: projectFiles.length,
      sessionFileCount,
      totalSizeBytes: totalSizeEstimate,
      sessionsByAgent: filteredSessionsByAgent,
    });

    const archiveSpinner = ora("Creating archive...").start();

    const { zipPath: resultZipPath, sizeBytes } = await createArchive({
      projectRoot: projectState.root,
      projectFiles,
      sessionsByAgent,
      selectedSessionIds,
      manifest,
      onProgress: (info) => {
        if (info.phase === "project-files") {
          archiveSpinner.text = `Archiving project files (${info.current}/${info.total})...`;
        } else if (info.phase === "sessions") {
          archiveSpinner.text = `Archiving sessions (${info.current}/${info.total})...`;
        } else {
          archiveSpinner.text = "Finalizing archive...";
        }
      },
    });

    zipPath = resultZipPath;
    archiveSpinner.succeed(
      `Archive created (${formatBytes(sizeBytes)})`,
    );

    // Check size limit
    const sizeMB = sizeBytes / (1024 * 1024);
    if (sizeMB > MAX_ARCHIVE_SIZE_MB) {
      throw archiveTooLarge(sizeMB, MAX_ARCHIVE_SIZE_MB);
    }

    // ─── Step 7: Upload or save locally ───
    if (options.output) {
      // Save locally
      await saveLocally(zipPath, options.output);
      console.log();
      console.log(
        chalk.green(`Archive saved to ${chalk.bold(options.output)}`),
      );
    } else {
      // Try upload
      const backendReady = await isBackendAvailable();

      if (!backendReady) {
        // Fall back to local save
        const fallbackPath = path.join(
          cwd,
          `codespeak-vibe-share-${Date.now()}.zip`,
        );
        await saveLocally(zipPath, fallbackPath);
        console.log();
        console.log(
          chalk.yellow(
            "Upload server is not available. Archive saved locally.",
          ),
        );
        console.log(chalk.bold(fallbackPath));
      } else {
        // Get upload consent
        const uploadConsent = await getUploadConsent(
          projectFiles.length + sessionFileCount,
          formatBytes(sizeBytes),
        );

        if (!uploadConsent) {
          // Save locally instead
          const fallbackPath = path.join(
            cwd,
            `codespeak-vibe-share-${Date.now()}.zip`,
          );
          await saveLocally(zipPath, fallbackPath);
          console.log();
          console.log(
            chalk.dim("Upload declined. Archive saved locally:"),
          );
          console.log(chalk.bold(fallbackPath));
          return;
        }

        const uploadSpinner = ora("Uploading...").start();
        const { shareUrl } = await uploadArchive(zipPath, sizeBytes, (pct) => {
          uploadSpinner.text = `Uploading... ${pct}%`;
        });
        uploadSpinner.succeed("Upload complete");

        showPostUploadInfo(shareUrl);
      }
    }
  } catch (err) {
    if (err instanceof VibeError) {
      console.error();
      console.error(chalk.red(`Error: ${err.userMessage}`));
      if (err.suggestion) {
        console.error(chalk.dim(err.suggestion));
      }
      process.exit(1);
    }

    // Unknown error — still show something useful
    console.error();
    console.error(
      chalk.red("Something unexpected went wrong."),
    );
    if (err instanceof Error) {
      console.error(chalk.dim(err.message));
    }
    console.error(
      chalk.dim(
        "If this persists, please report it at https://github.com/codespeak-dev/vibe-sharing/issues",
      ),
    );
    process.exit(1);
  } finally {
    // Clean up temp zip
    if (zipPath) {
      cleanupArchive(zipPath);
    }
  }
}
