import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import archiver from "archiver";
import type { ArchiveManifest } from "./manifest.js";
import type { AgentProvider, DiscoveredSession } from "../sessions/types.js";

export interface ArchiveInput {
  /** Absolute path to the project root */
  projectRoot: string;
  /** Project files relative to projectRoot */
  projectFiles: string[];
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
  const zipPath = path.join(
    os.tmpdir(),
    `codespeak-vibe-share-${Date.now()}.zip`,
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
  const totalProjectFiles = input.projectFiles.length;
  for (let i = 0; i < input.projectFiles.length; i++) {
    const relPath = input.projectFiles[i];
    const absPath = path.join(input.projectRoot, relPath);
    // Use forward slashes in zip paths
    const zipEntryPath = `project/${relPath.replace(/\\/g, "/")}`;

    try {
      archive.file(absPath, { name: zipEntryPath });
    } catch {
      // Skip files that can't be read
    }

    input.onProgress?.({
      phase: "project-files",
      current: i + 1,
      total: totalProjectFiles,
    });
  }

  // Add session files
  let sessionFileCount = 0;
  let totalSessionFiles = 0;

  // Count total session files first
  for (const [, { provider, sessions }] of input.sessionsByAgent) {
    for (const session of sessions) {
      if (!input.selectedSessionIds.has(session.sessionId)) continue;
      const files = await provider.getSessionFiles(session);
      totalSessionFiles += files.length;
    }
  }

  for (const [, { provider, sessions }] of input.sessionsByAgent) {
    for (const session of sessions) {
      if (!input.selectedSessionIds.has(session.sessionId)) continue;

      const files = await provider.getSessionFiles(session);
      for (const absPath of files) {
        const fileName = path.basename(absPath);
        // Organize by agent slug, then session
        const zipEntryPath = `sessions/${provider.slug}/${session.sessionId}/${fileName}`;

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
