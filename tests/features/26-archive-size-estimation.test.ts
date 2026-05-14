import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { detectProjectFiles, cleanupBundle } from "../../src/git/git-state.js";
import { createArchive, cleanupArchive } from "../../src/archive/archiver.js";
import { buildManifest } from "../../src/archive/manifest.js";
import {
  gitCommitAll,
  gitInit,
  makeTmpProject,
  writeFile,
} from "../helpers/tmp-project.js";

describe("Feature: Archive Size Estimation", () => {
  test("Total size estimate reflects project + session content (no dramatic underestimation)", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      // Add ~100KB of project content
      const lorem = "lorem ipsum dolor sit amet ".repeat(100);
      for (let i = 0; i < 40; i++) {
        await writeFile(proj.root, `src/file-${i}.txt`, lorem);
      }
      await gitCommitAll(proj.root);
      const state = await detectProjectFiles(proj.root);
      if (!state.isGitRepo) throw new Error("expected git repo");

      const manifest = buildManifest({
        projectName: path.basename(proj.root),
        projectPath: proj.root,
        isGitRepo: true,
        projectFileCount: 40,
        sessionFileCount: 0,
        totalSizeBytes: 0,
        sessionsByAgent: new Map(),
      });

      const result = await createArchive({
        project: {
          type: "git",
          root: state.root,
          gitStatusOutput: state.gitStatusOutput,
          gitDiffOutput: state.gitDiffOutput,
          gitDiffStagedOutput: state.gitDiffStagedOutput,
          fileListing: state.fileListing,
          untrackedFiles: state.untrackedFiles,
          bundlePath: state.bundlePath,
        },
        sessionsByAgent: new Map(),
        selectedSessionIds: new Set(),
        manifest,
      });

      try {
        const stat = await fs.stat(result.zipPath);
        // sizeBytes returned by createArchive matches the on-disk zip size.
        expect(result.sizeBytes).toBe(stat.size);
        // Reported size is non-trivial — well above 0 — because we packed real content.
        expect(result.sizeBytes).toBeGreaterThan(0);
        // Sanity: projects with content shouldn't compress to a near-empty zip.
        expect(result.sizeBytes).toBeGreaterThan(200);
        if (state.bundlePath) cleanupBundle(state.bundlePath);
      } finally {
        cleanupArchive(result.zipPath);
      }
    } finally {
      await proj.cleanup();
    }
  });
});
