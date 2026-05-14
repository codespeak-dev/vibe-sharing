import { describe, expect, test } from "vitest";
import path from "node:path";
import { getGitRoot } from "../../src/utils/paths.js";
import { detectProjectFiles } from "../../src/git/git-state.js";
import {
  gitCommitAll,
  gitInit,
  makeTmpProject,
  writeFile,
} from "../helpers/tmp-project.js";

describe("Feature: Project Root Detection for Session Lookup", () => {
  test("Locate sessions correctly when running from a subfolder of a git project: getGitRoot walks up to the repo root", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "src/foo.ts", "export {};\n");
      await gitCommitAll(proj.root);

      const sub = path.join(proj.root, "src");
      const root = await getGitRoot(sub);

      expect(root).not.toBeNull();
      expect(root!.endsWith(path.basename(proj.root))).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  test("Locate sessions correctly from a subfolder of a non-git project: detectProjectFiles still discovers files at the directory passed in", async () => {
    const proj = await makeTmpProject();
    try {
      // No git init — pure filesystem project
      await writeFile(proj.root, "src/main.ts", "export {};\n");
      await writeFile(proj.root, "lib/util.ts", "export {};\n");
      await writeFile(proj.root, "README.md", "# x\n");

      // Run from a subfolder; the function should still surface the project's files
      // via the non-git fallback rather than silently returning none.
      const sub = path.join(proj.root, "src");
      const state = await detectProjectFiles(sub);

      expect(state.isGitRepo).toBe(false);
      if (!state.isGitRepo) {
        // The non-git walk uses the cwd it was given as the root.
        expect(state.root).toBe(sub);
        // It should at least find the file in this subfolder.
        expect(state.allFiles).toContain("main.ts");
        expect(state.allFiles.length).toBeGreaterThan(0);
      }
    } finally {
      await proj.cleanup();
    }
  });
});
