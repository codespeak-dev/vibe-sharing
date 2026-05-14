import { describe, expect, test } from "vitest";
import path from "node:path";
import { getGitRoot } from "../../src/utils/paths.js";
import {
  gitCommitAll,
  gitInit,
  makeTmpProject,
  writeFile,
} from "../helpers/tmp-project.js";

describe("Feature: Claude Code CLAUDE.md Resolution", () => {
  test("Identify git repository root from a subfolder", async () => {
    const proj = await makeTmpProject();
    try {
      await gitInit(proj.root);
      await writeFile(proj.root, "CLAUDE.md", "# rules\n");
      await writeFile(proj.root, "deep/nested/sub/file.txt", "x\n");
      await gitCommitAll(proj.root);

      const sub = path.join(proj.root, "deep", "nested", "sub");
      const root = await getGitRoot(sub);
      // On macOS the git root may be /private/var/... while os.tmpdir() gives /var/...
      // Compare by realpath-equivalent suffix.
      expect(root).not.toBeNull();
      expect(root!.endsWith(path.basename(proj.root))).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });
});
