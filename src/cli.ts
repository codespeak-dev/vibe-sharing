import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { detectProjectFiles, cleanupBundle } from "./git/git-state.js";
import { discoverAllSessions } from "./sessions/discovery.js";
import { buildManifest } from "./archive/manifest.js";
import { createArchive, cleanupArchive } from "./archive/archiver.js";
import type { ProjectInput } from "./archive/archiver.js";
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
  displayGitProjectSummary,
  displayExcludePatterns,
  formatBytes,
} from "./ui/display.js";
import {
  selectUntrackedFiles,
  selectSessions,
  confirmFileList,
  promptUploadMetadata,
} from "./ui/prompts.js";
import { getGitRemoteUrl, getRepoName, getGitWorktrees } from "./utils/paths.js";
import type { GitWorktree } from "./utils/paths.js";
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
  let bundlePath: string | null = null;

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

    let projectInput: ProjectInput;
    let projectFileCount: number;

    // Detect repo name for archive naming (repo name > folder name)
    const detectedRepoUrl = projectState.isGitRepo
      ? await getGitRemoteUrl(projectState.root)
      : null;
    const projectName =
      (detectedRepoUrl ? getRepoName(detectedRepoUrl) : null) ??
      path.basename(projectState.root);

    if (projectState.isGitRepo) {
      bundlePath = projectState.bundlePath;

      console.log(
        chalk.dim(
          `Git repository detected at ${projectState.root} (${projectState.branch ?? "unknown branch"})`,
        ),
      );

      // Let user select which untracked files to include
      let selectedUntracked = projectState.untrackedFiles;
      if (projectState.untrackedFiles.length > 0) {
        selectedUntracked = await selectUntrackedFiles(
          projectState.untrackedFiles,
        );
      }

      projectInput = {
        type: "git",
        root: projectState.root,
        gitStatusOutput: projectState.gitStatusOutput,
        gitDiffOutput: projectState.gitDiffOutput,
        gitDiffStagedOutput: projectState.gitDiffStagedOutput,
        fileListing: projectState.fileListing,
        untrackedFiles: selectedUntracked,
        bundlePath: projectState.bundlePath,
      };

      // Count: text files + bundle (if present) + untracked files
      projectFileCount = 4 + (projectState.bundlePath ? 1 : 0) + selectedUntracked.length;

      displayGitProjectSummary(selectedUntracked.length);
    } else {
      console.log(chalk.dim("Not a git repository. Using exclude patterns."));
      displayExcludePatterns(getDefaultExcludeDescription());

      projectInput = {
        type: "non-git",
        root: projectState.root,
        files: projectState.allFiles,
      };
      projectFileCount = projectState.allFiles.length;

      displayFileList(projectState.allFiles, "Project files");
    }

    // ─── Step 3: Discover sessions ───
    let sessionsByAgent = new Map<
      string,
      { provider: AgentProvider; sessions: DiscoveredSession[] }
    >();
    let selectedSessionIds = new Set<string>();

    // Detect all worktrees so we can find sessions across all of them
    let worktrees: GitWorktree[] = [{ path: projectState.root, branch: null }];
    if (projectState.isGitRepo) {
      worktrees = await getGitWorktrees(projectState.root);
    }
    const worktreePaths = worktrees.map((wt) => wt.path);

    if (options.sessions !== false) {
      const sessionSpinner = ora("Discovering AI coding sessions...").start();
      const discovery = await discoverAllSessions(worktreePaths);
      sessionSpinner.stop();

      if (discovery.totalSessions > 0) {
        displaySessionSummary(discovery.byAgent);
        selectedSessionIds = await selectSessions(discovery.byAgent);
        sessionsByAgent = discovery.byAgent;
      } else {
        console.log(chalk.dim("No AI coding sessions found for this project."));
      }
    }

    // ─── Step 4: Count session files ───
    let sessionFileCount = 0;
    for (const [, { provider, sessions }] of sessionsByAgent) {
      const hasSelected = sessions.some((s) =>
        selectedSessionIds.has(s.sessionId),
      );
      if (hasSelected && provider.getProviderFiles) {
        const files = await provider.getProviderFiles();
        sessionFileCount += files.length;
      }
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

    displayArchiveSummary(
      projectFileCount,
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
      hasBundle: projectState.isGitRepo ? !!projectState.bundlePath : undefined,
      untrackedFileCount: projectState.isGitRepo
        ? projectState.untrackedFiles.length
        : undefined,
      worktrees,
      projectFileCount,
      sessionFileCount,
      totalSizeBytes: totalSizeEstimate,
      sessionsByAgent: filteredSessionsByAgent,
    });

    const archiveSpinner = ora("Creating archive...").start();

    const { zipPath: resultZipPath, sizeBytes } = await createArchive({
      project: projectInput,
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
      const fallbackPath = path.join(
        cwd,
        `${projectName}-${Date.now()}.zip`,
      );

      if (!backendReady) {
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
          projectFileCount + sessionFileCount,
          formatBytes(sizeBytes),
        );

        if (!uploadConsent) {
          // Save locally instead
          await saveLocally(zipPath, fallbackPath);
          console.log();
          console.log(
            chalk.dim("Upload declined. Archive saved locally:"),
          );
          console.log(chalk.bold(fallbackPath));
          return;
        }

        // Collect optional metadata
        const metadata = await promptUploadMetadata(detectedRepoUrl);

        const uploadSpinner = ora("Uploading...").start();
        await uploadArchive(zipPath, sizeBytes, (pct) => {
          uploadSpinner.text = `Uploading... ${pct}%`;
        }, metadata);
        uploadSpinner.succeed("Upload complete");

        showPostUploadInfo();
      }
    }
  } catch (err) {
    if (err instanceof VibeError) {
      console.error();
      console.error(chalk.red(`Error: ${err.userMessage}`));
      if (err.suggestion) {
        console.error(chalk.dim(err.suggestion));
      }
      if (options.verbose && err.cause) {
        console.error();
        console.error(chalk.dim("Cause:"), err.cause instanceof Error ? err.cause.message : String(err.cause));
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
    // Clean up temp files
    if (zipPath) {
      cleanupArchive(zipPath);
    }
    if (bundlePath) {
      cleanupBundle(bundlePath);
    }
  }
}
