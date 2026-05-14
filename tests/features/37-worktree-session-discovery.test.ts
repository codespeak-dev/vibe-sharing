import { describe, expect, test } from "vitest";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGitWorktrees } from "../../src/utils/paths.js";
import {
  gitCommitAll,
  gitInit,
  makeTmpProject,
  writeFile,
} from "../helpers/tmp-project.js";

const execFileAsync = promisify(execFile);

describe("Feature: Worktree-Based Session Discovery", () => {
  test("getGitWorktrees enumerates the main worktree alone in a fresh repo", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "README.md", "# x\n");
      await gitCommitAll(proj.root);

      const wts = await getGitWorktrees(proj.root);
      expect(wts.length).toBeGreaterThanOrEqual(1);
      expect(wts[0]?.branch).toBe("main");
    } finally {
      await proj.cleanup();
    }
  });

  test("Sessions from all worktrees collected: getGitWorktrees enumerates main + added worktree", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "README.md", "# repo\n");
      await gitCommitAll(proj.root, "init");

      const worktreePath = path.join(proj.root, "..", `${path.basename(proj.root)}-wt`);
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", "wt-branch", worktreePath],
        { cwd: proj.root },
      );
      try {
        const worktrees = await getGitWorktrees(proj.root);
        expect(worktrees.length).toBeGreaterThanOrEqual(2);
        const branches = worktrees.map((w) => w.branch);
        expect(branches).toContain("main");
        expect(branches).toContain("wt-branch");
      } finally {
        await execFileAsync(
          "git",
          ["worktree", "remove", "--force", worktreePath],
          { cwd: proj.root },
        ).catch(() => {});
      }
    } finally {
      await proj.cleanup();
    }
  });

  test("getGitWorktrees on a non-git directory falls back to a single entry pointing at the cwd", async () => {
    const proj = await makeTmpProject();
    try {
      const wts = await getGitWorktrees(proj.root);
      expect(wts.length).toBe(1);
      expect(wts[0]?.path).toBe(proj.root);
      expect(wts[0]?.branch).toBeNull();
    } finally {
      await proj.cleanup();
    }
  });
});
