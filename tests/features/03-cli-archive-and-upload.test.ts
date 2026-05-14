import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  shouldExcludeDefault,
  getDefaultExcludeDescription,
} from "../../src/utils/excludes.js";
import { saveLocally, isBackendAvailable } from "../../src/upload/upload.js";
import {
  uploadFailed,
  networkError,
  archiveTooLarge,
  noSessionsFound,
  notAGitRepo,
  VibeError,
} from "../../src/utils/errors.js";
import { detectProjectFiles } from "../../src/git/git-state.js";
import { makeTmpProject, writeFile } from "../helpers/tmp-project.js";

describe("Feature: CLI Tool — Core Archive and Upload Flow", () => {
  test("Run tool in a git-managed project directory: detectProjectFiles surfaces git state without manual specification", async () => {
    const proj = await makeTmpProject();
    try {
      // Initialize as a real git repo so detectProjectFiles takes the git path.
      const { gitInit, gitCommitAll } = await import("../helpers/tmp-project.js");
      await gitInit(proj.root);
      await writeFile(proj.root, "src/main.ts", "export {};\n");
      await gitCommitAll(proj.root);

      const state = await detectProjectFiles(proj.root);
      expect(state.isGitRepo).toBe(true);
      if (state.isGitRepo) {
        expect(state.fileListing).toContain("src/main.ts");
      }
    } finally {
      await proj.cleanup();
    }
  });

  describe("Apply default exclusions in a non-git directory", () => {
    test("excludes node_modules", () => {
      expect(shouldExcludeDefault("node_modules", true)).toBe(true);
    });
    test("excludes .venv", () => {
      expect(shouldExcludeDefault(".venv", true)).toBe(true);
    });
    test("excludes .env.local file", () => {
      expect(shouldExcludeDefault(".env.local", false)).toBe(true);
    });
    test("excludes .env file", () => {
      expect(shouldExcludeDefault(".env", false)).toBe(true);
    });
    test("does not exclude regular source files", () => {
      expect(shouldExcludeDefault("src/index.ts", false)).toBe(false);
    });
    test("default exclusion description includes the BDD-required entries", () => {
      const desc = getDefaultExcludeDescription();
      expect(desc).toContain("node_modules/");
      expect(desc).toContain(".venv/");
      expect(desc.find((d) => d.includes(".env"))).toBeDefined();
    });

    test("Non-git project surfaces files via detectProjectFiles with default excludes applied", async () => {
      const proj = await makeTmpProject();
      try {
        await writeFile(proj.root, "main.ts", "export {};\n");
        await writeFile(proj.root, "node_modules/foo/index.js", "module.exports={};\n");
        await writeFile(proj.root, ".env", "SECRET=x\n");

        const state = await detectProjectFiles(proj.root);
        expect(state.isGitRepo).toBe(false);
        if (!state.isGitRepo) {
          expect(state.allFiles).toContain("main.ts");
          // node_modules and .env are excluded by default
          expect(state.allFiles.some((f) => f.startsWith("node_modules/"))).toBe(false);
          expect(state.allFiles).not.toContain(".env");
        }
      } finally {
        await proj.cleanup();
      }
    });
  });

  describe("Fall back to local zip when backend is unavailable", () => {
    let originalFetch: typeof fetch;
    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    test("isBackendAvailable returns false when /health is unreachable (and the CLI must fall back to local zip)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );
      const ok = await isBackendAvailable();
      expect(ok).toBe(false);
    });

    test("isBackendAvailable returns true when /health responds 200", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status: 200 })),
      );
      const ok = await isBackendAvailable();
      expect(ok).toBe(true);
    });

    test("saveLocally copies the archive to the user-specified output path so the user can hand-share it", async () => {
      const proj = await makeTmpProject();
      try {
        const src = path.join(proj.root, "input.zip");
        const dst = path.join(proj.root, "out.zip");
        await fs.writeFile(src, Buffer.from("PK\x03\x04dummy")); // mock zip content

        await saveLocally(src, dst);
        const dstStat = await fs.stat(dst);
        expect(dstStat.size).toBeGreaterThan(0);
      } finally {
        await proj.cleanup();
      }
    });
  });

  describe("Privacy notice + step-aware error suggestions", () => {
    test("Network error advises checking connection AND mentions --output and --verbose", () => {
      const e = networkError(new Error("offline"));
      expect(e).toBeInstanceOf(VibeError);
      expect(e.suggestion).toMatch(/--output/);
      expect(e.suggestion).toMatch(/--verbose/);
      expect(e.suggestion).toMatch(/internet connection/i);
    });

    test("uploadFailed names the failed step (presign/upload/confirm) so the user knows what broke", () => {
      const e = uploadFailed("confirm", new Error("503"));
      expect(e.userMessage).toMatch(/at confirm step/);
      expect(e.suggestion).toMatch(/--output/);
      expect(e.suggestion).toMatch(/--verbose/);
    });

    test("archiveTooLarge names the actual size and the limit", () => {
      const e = archiveTooLarge(750, 500);
      expect(e.userMessage).toContain("750");
      expect(e.userMessage).toContain("500");
    });

    test("noSessionsFound suggests a fallback (manual browse or proceed without)", () => {
      const e = noSessionsFound();
      expect(e.suggestion).toMatch(/browse|proceed without sessions/i);
    });

    test("notAGitRepo suggests using exclude patterns instead", () => {
      const e = notAGitRepo();
      expect(e.suggestion).toMatch(/exclude patterns/i);
    });
  });

  test.skip(
    "Confirm file list and upload automatically: requires interactive Ink list-prompt; UI integration test",
    () => {},
  );
  test.skip(
    "Handle project with a non-Claude-Code AI agent — asks which agent: interactive prompt; UI integration test",
    () => {},
  );
  test.skip(
    "Suggest candidate session directories when layout is unknown: interactive prompt; UI integration test",
    () => {},
  );
  test.skip(
    "Locate Codex or Gemini session files automatically: requires real fixture data under ~/.codex / ~/.gemini",
    () => {},
  );
  test.skip(
    "Offer file system browser for unsupported agents: interactive Ink browser; UI integration test",
    () => {},
  );
  test.skip(
    "Display privacy notice and require explicit consent before sharing: covered by 12-sharing-consent-default.test.tsx (ConsentScreen)",
    () => {},
  );
  test.skip(
    "Run the tool on Windows, macOS, or Linux without platform-specific setup: requires CI on each platform; checked by `engines.node>=18` in package.json + node-only standard library use",
    () => {},
  );
});
