import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import archiver from "archiver";
import type { ArchiveManifest } from "./manifest.js";
import type { AgentProvider, DiscoveredSession } from "../sessions/types.js";

export interface GitProjectInput {
  type: "git";
  root: string;
  gitStatusOutput: string;
  gitDiffOutput: string;
  gitDiffStagedOutput: string;
  fileListing: string;
  untrackedFiles: string[];
  bundlePath: string | null;
}

export interface NonGitProjectInput {
  type: "non-git";
  root: string;
  files: string[];
}

export type ProjectInput = GitProjectInput | NonGitProjectInput;

export interface ArchiveInput {
  /** Project data (git or non-git) */
  project: ProjectInput;
  /** Sessions grouped by agent, with their provider for file resolution */
  sessionsByAgent: Map<
    string,
    { provider: AgentProvider; sessions: DiscoveredSession[] }
  >;
  /** Selected session IDs (only these will be included) */
  selectedSessionIds: Set<string>;
  /** The manifest to include */
  manifest: ArchiveManifest;
  /** Progress callback */
  onProgress?: (info: {
    phase: "project-files" | "sessions" | "finalizing";
    current: number;
    total: number;
  }) => void;
}

export interface ArchiveResult {
  zipPath: string;
  sizeBytes: number;
}

/**
 * Create a zip archive containing project files, session data, and manifest.
 */
export async function createArchive(
  input: ArchiveInput,
): Promise<ArchiveResult> {
  const projectName = path.basename(input.project.root);
  const zipPath = path.join(
    os.tmpdir(),
    `${projectName}-${Date.now()}.zip`,
  );

  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const archivePromise = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  // Add manifest
  archive.append(JSON.stringify(input.manifest, null, 2), {
    name: "manifest.json",
  });

  // Add project files
  if (input.project.type === "git") {
    addGitProject(archive, input.project, input.onProgress);
  } else {
    addNonGitProject(archive, input.project, input.onProgress);
  }

  // Add session files
  let sessionFileCount = 0;
  let totalSessionFiles = 0;
  const addedSessionPaths = new Set<string>();

  // Collect all files first (provider-level + per-session) for counting
  const providerFileMap = new Map<string, string[]>();
  for (const [, { provider, sessions }] of input.sessionsByAgent) {
    // Provider-level files (entire directory captures like Claude Code)
    if (provider.getProviderFiles) {
      const hasSelected = sessions.some((s) =>
        input.selectedSessionIds.has(s.sessionId),
      );
      if (hasSelected) {
        const files = await provider.getProviderFiles();
        providerFileMap.set(provider.slug, files);
        totalSessionFiles += files.length;
      }
    }
    // Per-session files
    for (const session of sessions) {
      if (!input.selectedSessionIds.has(session.sessionId)) continue;
      const files = await provider.getSessionFiles(session);
      totalSessionFiles += files.length;
    }
  }

  // Add provider-level files (preserving directory structure)
  for (const [, { provider }] of input.sessionsByAgent) {
    const providerFiles = providerFileMap.get(provider.slug);
    if (!providerFiles) continue;

    const archiveRoot = provider.getArchiveRoot?.();

    for (const absPath of providerFiles) {
      let zipEntryPath: string;
      if (archiveRoot && absPath.startsWith(archiveRoot)) {
        const relPath = path.relative(archiveRoot, absPath);
        zipEntryPath = `sessions/${path.basename(archiveRoot)}/${relPath.replace(/\\/g, "/")}`;
      } else {
        // Fallback for files outside archive root
        const fileName = path.basename(absPath);
        zipEntryPath = `sessions/${provider.slug}/${fileName}`;
      }

      if (addedSessionPaths.has(zipEntryPath)) continue;
      addedSessionPaths.add(zipEntryPath);

      try {
        archive.file(absPath, { name: zipEntryPath });
      } catch {
        // Skip unreadable files
      }

      sessionFileCount++;
      input.onProgress?.({
        phase: "sessions",
        current: sessionFileCount,
        total: totalSessionFiles,
      });
    }
  }

  // Add virtual files (generated/filtered content from providers)
  for (const [, { provider, sessions }] of input.sessionsByAgent) {
    if (!provider.getVirtualFiles) continue;
    const hasSelected = sessions.some((s) =>
      input.selectedSessionIds.has(s.sessionId),
    );
    if (!hasSelected) continue;

    const archiveRoot = provider.getArchiveRoot?.();
    const archiveRootBasename = archiveRoot
      ? path.basename(archiveRoot)
      : provider.slug;

    const virtualFiles = await provider.getVirtualFiles();
    for (const { relativePath, content } of virtualFiles) {
      const zipEntryPath = `sessions/${archiveRootBasename}/${relativePath.replace(/\\/g, "/")}`;
      if (addedSessionPaths.has(zipEntryPath)) continue;
      addedSessionPaths.add(zipEntryPath);

      archive.append(content, { name: zipEntryPath });

      sessionFileCount++;
      input.onProgress?.({
        phase: "sessions",
        current: sessionFileCount,
        total: totalSessionFiles,
      });
    }
  }

  // Add per-session files (for providers without getProviderFiles)
  for (const [, { provider, sessions }] of input.sessionsByAgent) {
    for (const session of sessions) {
      if (!input.selectedSessionIds.has(session.sessionId)) continue;

      const files = await provider.getSessionFiles(session);
      for (const absPath of files) {
        const archiveRoot = provider.getArchiveRoot?.();
        let zipEntryPath: string;
        if (archiveRoot && absPath.startsWith(archiveRoot)) {
          const relPath = path.relative(archiveRoot, absPath);
          zipEntryPath = `sessions/${path.basename(archiveRoot)}/${relPath.replace(/\\/g, "/")}`;
        } else {
          const fileName = path.basename(absPath);
          zipEntryPath = `sessions/${provider.slug}/${session.sessionId}/${fileName}`;
        }

        if (addedSessionPaths.has(zipEntryPath)) continue;
        addedSessionPaths.add(zipEntryPath);

        try {
          archive.file(absPath, { name: zipEntryPath });
        } catch {
          // Skip unreadable files
        }

        sessionFileCount++;
        input.onProgress?.({
          phase: "sessions",
          current: sessionFileCount,
          total: totalSessionFiles,
        });
      }
    }
  }

  input.onProgress?.({ phase: "finalizing", current: 0, total: 0 });

  await archive.finalize();
  await archivePromise;

  const stat = fs.statSync(zipPath);
  return { zipPath, sizeBytes: stat.size };
}

function addGitProject(
  archive: archiver.Archiver,
  project: GitProjectInput,
  onProgress?: ArchiveInput["onProgress"],
): void {
  // Generated text files
  archive.append(project.gitStatusOutput || "(empty)", {
    name: "project/git-status.txt",
  });
  archive.append(project.gitDiffOutput || "(no unstaged changes)", {
    name: "project/git-diff.txt",
  });
  archive.append(project.gitDiffStagedOutput || "(no staged changes)", {
    name: "project/git-diff-staged.txt",
  });
  archive.append(project.fileListing || "(empty)", {
    name: "project/file-listing.txt",
  });

  // Git bundle (may be null if repo has no commits)
  if (project.bundlePath) {
    try {
      archive.file(project.bundlePath, { name: "project/repo.bundle" });
    } catch {
      // Bundle may not exist if git bundle failed
    }
  }

  // Untracked files
  const total = project.untrackedFiles.length;
  for (let i = 0; i < project.untrackedFiles.length; i++) {
    const relPath = project.untrackedFiles[i];
    const absPath = path.join(project.root, relPath);
    const zipEntryPath = `project/untracked/${relPath.replace(/\\/g, "/")}`;

    try {
      archive.file(absPath, { name: zipEntryPath });
    } catch {
      // Skip files that can't be read
    }

    onProgress?.({
      phase: "project-files",
      current: i + 1,
      total: total + 4, // +4 for the text files
    });
  }
}

function addNonGitProject(
  archive: archiver.Archiver,
  project: NonGitProjectInput,
  onProgress?: ArchiveInput["onProgress"],
): void {
  const totalProjectFiles = project.files.length;
  for (let i = 0; i < project.files.length; i++) {
    const relPath = project.files[i];
    const absPath = path.join(project.root, relPath);
    const zipEntryPath = `project/${relPath.replace(/\\/g, "/")}`;

    try {
      archive.file(absPath, { name: zipEntryPath });
    } catch {
      // Skip files that can't be read
    }

    onProgress?.({
      phase: "project-files",
      current: i + 1,
      total: totalProjectFiles,
    });
  }
}

/**
 * Remove the temporary zip file.
 */
export function cleanupArchive(zipPath: string): void {
  try {
    fs.unlinkSync(zipPath);
  } catch {
    // Best effort cleanup
  }
}
