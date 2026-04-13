import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { GooseDecoration } from "../components/goose-decoration.js";
import { Spinner } from "../components/spinner.js";
import { KeyHint } from "../components/key-hint.js";
import { CONTACT_EMAIL } from "../../config.js";
import { detectProjectFiles, cleanupBundle } from "../../git/git-state.js";
import { discoverAllSessions } from "../../sessions/discovery.js";
import { buildManifest } from "../../archive/manifest.js";
import { createArchive, cleanupArchive } from "../../archive/archiver.js";
import { uploadArchive, isBackendAvailable, saveLocally } from "../../upload/upload.js";
import { getGitRemoteUrl, getGitWorktrees } from "../../utils/paths.js";
import { MAX_ARCHIVE_SIZE_MB } from "../../config.js";
import path from "node:path";

interface ThankYouScreenProps {
  projectPath: string;
  phase: "uploading" | "done";
  onDone?: () => void;
  onError?: () => void;
  onShareAnother?: () => void;
  onQuit?: () => void;
}

export function ThankYouScreen({
  projectPath,
  phase,
  onDone,
  onError,
  onShareAnother,
  onQuit,
}: ThankYouScreenProps) {
  const [status, setStatus] = useState("Preparing archive...");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "uploading" || !projectPath) return;
    let cancelled = false;

    (async () => {
      let zipPath: string | null = null;
      let bundlePath: string | null = null;

      try {
        setStatus("Scanning project...");

        const projectState = await detectProjectFiles(projectPath);
        const detectedRepoUrl = projectState.isGitRepo
          ? await getGitRemoteUrl(projectState.root).catch(() => null)
          : null;

        let worktreePaths = [projectState.root];
        if (projectState.isGitRepo) {
          const worktrees = await getGitWorktrees(projectState.root);
          worktreePaths = worktrees.map((wt) => wt.path);
        }

        if (cancelled) return;
        setStatus("Discovering sessions...");

        const discovery = await discoverAllSessions({
          worktreePaths,
          gitRemoteUrl: detectedRepoUrl,
        });

        if (cancelled) return;
        setStatus("Creating archive...");

        const projectInput = projectState.isGitRepo
          ? {
              type: "git" as const,
              root: projectState.root,
              gitStatusOutput: projectState.gitStatusOutput,
              gitDiffOutput: projectState.gitDiffOutput,
              gitDiffStagedOutput: projectState.gitDiffStagedOutput,
              fileListing: projectState.fileListing,
              untrackedFiles: projectState.untrackedFiles,
              bundlePath: projectState.bundlePath,
            }
          : {
              type: "non-git" as const,
              root: projectState.root,
              files: projectState.allFiles,
            };

        bundlePath = projectState.isGitRepo ? projectState.bundlePath : null;

        // Select all sessions
        const selectedSessionIds = new Set<string>();
        const filteredSessionsByAgent = new Map<string, { sessions: Array<{ sessionId: string; summary: string | null; firstPrompt: string | null; messageCount: number | null; created: string | null; modified: string | null; sizeBytes: number; agentName: string }> }>();
        for (const [name, { sessions }] of discovery.byAgent) {
          for (const s of sessions) {
            selectedSessionIds.add(s.sessionId);
          }
          filteredSessionsByAgent.set(name, { sessions });
        }

        // Count files
        let projectFileCount = 0;
        let sessionFileCount = 0;
        let totalSizeEstimate = 0;

        if (projectState.isGitRepo) {
          projectFileCount = 4 + (projectState.bundlePath ? 1 : 0) + projectState.untrackedFiles.length;
        } else {
          projectFileCount = projectState.allFiles.length;
        }

        for (const [, { provider, sessions }] of discovery.byAgent) {
          if (provider.getProviderFiles) {
            sessionFileCount += (await provider.getProviderFiles()).length;
          }
          if (provider.getVirtualFiles) {
            sessionFileCount += (await provider.getVirtualFiles()).length;
          }
          for (const session of sessions) {
            sessionFileCount += (await provider.getSessionFiles(session)).length;
            totalSizeEstimate += session.sizeBytes;
          }
        }

        const worktrees = projectState.isGitRepo
          ? await getGitWorktrees(projectState.root)
          : [{ path: projectState.root, branch: null }];

        const manifest = buildManifest({
          projectName: path.basename(projectState.root),
          projectPath: projectState.root,
          isGitRepo: projectState.isGitRepo,
          gitBranch: projectState.isGitRepo ? projectState.branch : undefined,
          gitCommit: projectState.isGitRepo ? projectState.commit : undefined,
          hasBundle: projectState.isGitRepo ? !!projectState.bundlePath : undefined,
          untrackedFileCount: projectState.isGitRepo ? projectState.untrackedFiles.length : undefined,
          worktrees,
          projectFileCount,
          sessionFileCount,
          totalSizeBytes: totalSizeEstimate,
          sessionsByAgent: filteredSessionsByAgent,
        });

        if (cancelled) return;

        const { zipPath: resultZipPath, sizeBytes } = await createArchive({
          project: projectInput,
          sessionsByAgent: discovery.byAgent,
          selectedSessionIds,
          manifest,
          onProgress: (info) => {
            if (cancelled) return;
            if (info.phase === "sessions") {
              setStatus(`Archiving sessions (${info.current}/${info.total})...`);
            } else if (info.phase === "finalizing") {
              setStatus("Finalizing archive...");
            }
          },
        });

        zipPath = resultZipPath;

        const sizeMB = sizeBytes / (1024 * 1024);
        if (sizeMB > MAX_ARCHIVE_SIZE_MB) {
          setError(`Archive too large (${sizeMB.toFixed(1)} MB, max is ${MAX_ARCHIVE_SIZE_MB} MB). Try running with --no-sessions to exclude AI session data.`);
          return;
        }

        if (cancelled) return;
        setStatus("Uploading...");

        const backendReady = await isBackendAvailable();
        if (!backendReady) {
          const fallbackPath = path.join(
            projectPath,
            `${path.basename(projectState.root)}-${Date.now()}.zip`,
          );
          await saveLocally(zipPath, fallbackPath);
          setStatus(`Upload server unavailable. Saved to ${fallbackPath}`);
          if (cancelled) return;
          onDone?.();
          return;
        }

        // Get git user info for metadata
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        let userEmail = "";
        let userName = "";
        try {
          const { stdout: email } = await execFileAsync("git", ["config", "user.email"]);
          userEmail = email.trim();
        } catch {}
        try {
          const { stdout: name } = await execFileAsync("git", ["config", "user.name"]);
          userName = name.trim();
        } catch {}

        const metadata = {
          ...(userEmail && { userEmail }),
          ...(userName && { userName }),
          ...(detectedRepoUrl && { repoUrl: detectedRepoUrl }),
        };

        await uploadArchive(zipPath, sizeBytes, (pct) => {
          if (cancelled) return;
          setStatus(`Uploading... ${pct}%`);
          setProgress(pct);
        }, metadata);

        if (cancelled) return;
        onDone?.();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (zipPath) cleanupArchive(zipPath);
        if (bundlePath) cleanupBundle(bundlePath);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, projectPath, onDone, onError]);

  useInput((input, key) => {
    if (error) {
      if (key.escape || key.return) {
        onError?.();
      }
      return;
    }
    if (phase !== "done") return;
    if (key.return && onShareAnother) {
      onShareAnother();
    } else if (input === "q" || input === "Q") {
      onQuit?.();
    }
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <KeyHint hints={[{ key: "Esc", label: "go back" }]} />
      </Box>
    );
  }

  if (phase === "uploading") {
    return (
      <Box flexDirection="row">
        <GooseDecoration animate />
        <Box flexDirection="column" justifyContent="center">
          {progress > 0 ? <Text>{status}</Text> : <Spinner label={status} />}
          {progress > 0 && (
            <Box marginTop={1}>
              <Text>
                [{"█".repeat(Math.floor(progress / 5))}
                {" ".repeat(20 - Math.floor(progress / 5))}] {progress}%
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // phase === "done"
  const w = 56;
  const top = "╔" + "═".repeat(w) + "╗";
  const bot = "╚" + "═".repeat(w) + "╝";
  const empty = "║" + " ".repeat(w) + "║";
  const line = (text: string) => {
    const pad = Math.max(0, w - text.length);
    return "║  " + text + " ".repeat(Math.max(0, pad - 2)) + "║";
  };

  return (
    <Box flexDirection="row">
      <GooseDecoration animate intervalMs={3000} />
      <Box flexDirection="column">
        <Text color="green">{top}</Text>
        <Text color="green">{empty}</Text>
        <Text color="green">{line("🌟  🌟  🌟  🌟  🌟  🌟  🌟  🌟")}</Text>
        <Text color="green">{empty}</Text>
        <Text color="green">{line("Thank you so much for sharing!")}</Text>
        <Text color="green">{empty}</Text>
        <Text color="green">{line("Your contribution helps us understand how")}</Text>
        <Text color="green">{line("developers and AI work together to build")}</Text>
        <Text color="green">{line("amazing things.")}</Text>
        <Text color="green">{empty}</Text>
        <Text color="green">{line("💛  💚  💙  💜  💖  💛  💚  💙  💜")}</Text>
        <Text color="green">{empty}</Text>
        <Text color="green">{bot}</Text>

        <Text dimColor>  To request deletion: {CONTACT_EMAIL}</Text>

        <KeyHint
          hints={[
            { key: "Enter", label: "share another", primary: true },
            { key: "Q", label: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
