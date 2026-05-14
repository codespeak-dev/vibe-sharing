import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFileTree } from "../../src/utils/file-tree.js";
import { detectProjectFiles, cleanupBundle } from "../../src/git/git-state.js";
import { createArchive, cleanupArchive } from "../../src/archive/archiver.js";
import { buildManifest } from "../../src/archive/manifest.js";
import {
  gitCommitAll,
  gitInit,
  makeTmpProject,
  writeFile,
} from "../helpers/tmp-project.js";

describe("Feature: Git-Managed Project Packaging", () => {
  test("Package a git project with full context: status, diff (unstaged), diff (vs HEAD), file listing, untracked files, git bundle", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "src/main.ts", "export const x = 1;\n");
      await writeFile(proj.root, "README.md", "# project\n");
      await gitCommitAll(proj.root, "init");

      // Create both unstaged and staged diff content + an untracked file
      await writeFile(proj.root, "src/main.ts", "export const x = 2;\n"); // unstaged
      await writeFile(proj.root, "extra.txt", "hi\n"); // untracked

      const state = await detectProjectFiles(proj.root);
      expect(state.isGitRepo).toBe(true);
      if (!state.isGitRepo) return;

      expect(state.gitStatusOutput).toMatch(/main\.ts/);
      expect(state.gitDiffOutput).toContain("export const x = 2");
      expect(state.gitDiffStagedOutput).toBeDefined();
      expect(state.fileListing).toContain("README.md");
      expect(state.untrackedFiles).toContain("extra.txt");
      expect(state.bundlePath).not.toBeNull();
      // Bundle file actually exists
      if (state.bundlePath) {
        const stat = await fs.stat(state.bundlePath);
        expect(stat.size).toBeGreaterThan(0);
        cleanupBundle(state.bundlePath);
      }
    } finally {
      await proj.cleanup();
    }
  });

  test("buildFileTree marks tracked files as shared", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "src/index.ts", "export {};\n");
      await writeFile(proj.root, "README.md", "# project\n");
      await gitCommitAll(proj.root);

      const tree = await buildFileTree(proj.root);
      expect(tree.find((n) => n.name === "README.md")?.shared).toBe(true);
      expect(tree.find((n) => n.name === "src")?.shared).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  test("buildFileTree marks node_modules as not shared", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "src/index.ts", "export {};\n");
      await writeFile(proj.root, "node_modules/foo/index.js", "module.exports = {};\n");
      await gitCommitAll(proj.root);

      const tree = await buildFileTree(proj.root);
      expect(tree.find((n) => n.name === "node_modules")?.shared).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });

  test("Untracked files are surfaced via detectProjectFiles so the user can opt them in", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "tracked.ts", "1\n");
      await gitCommitAll(proj.root);
      await writeFile(proj.root, "fresh.ts", "2\n");

      const state = await detectProjectFiles(proj.root);
      expect(state.isGitRepo).toBe(true);
      if (state.isGitRepo) {
        expect(state.untrackedFiles).toContain("fresh.ts");
        expect(state.untrackedFiles).not.toContain("tracked.ts");
      }
    } finally {
      await proj.cleanup();
    }
  });

  test("Archive is named after the project folder so it's identifiable without opening", async () => {
    const proj = await makeTmpProject("my-project-");
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "README.md", "# project\n");
      await gitCommitAll(proj.root);
      const state = await detectProjectFiles(proj.root);
      if (!state.isGitRepo) throw new Error("expected git repo");

      const manifest = buildManifest({
        projectName: path.basename(proj.root),
        projectPath: proj.root,
        isGitRepo: true,
        gitBranch: state.branch,
        gitCommit: state.commit,
        hasBundle: !!state.bundlePath,
        untrackedFileCount: 0,
        projectFileCount: 1,
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
        const filename = path.basename(result.zipPath);
        // Archive filename should contain the project's folder name
        expect(filename).toContain(path.basename(proj.root));
        expect(filename.endsWith(".zip")).toBe(true);
        if (state.bundlePath) cleanupBundle(state.bundlePath);
      } finally {
        cleanupArchive(result.zipPath);
      }
    } finally {
      await proj.cleanup();
    }
  });

  test("Archive zip contains manifest.json and project file listing", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "src/foo.ts", "export {};\n");
      await gitCommitAll(proj.root);
      const state = await detectProjectFiles(proj.root);
      if (!state.isGitRepo) throw new Error();

      const manifest = buildManifest({
        projectName: "p",
        projectPath: proj.root,
        isGitRepo: true,
        projectFileCount: 1,
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
        expect(stat.size).toBeGreaterThan(0);
        expect(result.sizeBytes).toBeGreaterThan(0);
        if (state.bundlePath) cleanupBundle(state.bundlePath);
      } finally {
        cleanupArchive(result.zipPath);
      }
    } finally {
      await proj.cleanup();
    }
  });

  test.skip(
    "Browser file system option for sessions functions correctly: requires interactive Ink prompt with file-system browser; covered by integration test with the live UI",
    () => {},
  );
  test.skip(
    "Select individual untracked files to include during session setup: requires interactive Ink multi-select; cannot be exercised in headless test",
    () => {},
  );
});
