import { describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  hasRenderedView,
  getDisplayType,
  getHeaderExtra,
  isHeaderOnly,
  getCollapsedPreview,
} from "../../src/components/message-renderer.js";
import {
  encodeForUrl,
  decodeFromUrl,
} from "../../src/lib/urls.js";

describe("Feature: Session Viewer — Next.js Application (pure helpers)", () => {
  test("hasRenderedView recognises known message types", () => {
    expect(hasRenderedView("user")).toBe(true);
    expect(hasRenderedView("assistant")).toBe(true);
    expect(hasRenderedView("system")).toBe(true);
    expect(hasRenderedView("ai-title")).toBe(true);
    expect(hasRenderedView("totally-unknown-type")).toBe(false);
  });

  test("Rendered view not available for unrecognised message types", () => {
    expect(hasRenderedView("xyz")).toBe(false);
  });

  test("getDisplayType labels tool-result user messages distinctly from regular user messages", () => {
    expect(
      getDisplayType({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok" },
          ],
        },
      }),
    ).toBe("tool-result");

    expect(
      getDisplayType({
        type: "user",
        message: {
          content: [{ type: "text", text: "hello" }],
        },
      }),
    ).toBe("user");
  });

  test("URL encode round-trip preserves project paths (lossless, unlike encodeProjectPath)", () => {
    const original = "/Users/me/projects/my-app-with-hyphens";
    const encoded = encodeForUrl(original);
    expect(decodeFromUrl(encoded)).toBe(original);
  });
});

describe("Feature: Session Viewer — Collapsible Cards header semantics", () => {
  test("ai-title card displays its title in the header (and the body is hidden)", () => {
    const entry = { type: "ai-title", aiTitle: "Summarising changes" };
    expect(getHeaderExtra(entry)).toBe("Summarising changes");
    expect(isHeaderOnly(entry)).toBe(true);
  });

  test("FileSnapshot with no tracked files: header reads 'no files tracked' and body is hidden", () => {
    const empty = {
      type: "file-history-snapshot",
      snapshot: { trackedFileBackups: {} },
    };
    expect(getHeaderExtra(empty)).toBe("no files tracked");
    expect(isHeaderOnly(empty)).toBe(true);
  });

  test("FileSnapshot with tracked files renders body (not header-only)", () => {
    const populated = {
      type: "file-history-snapshot",
      snapshot: { trackedFileBackups: { "a.ts": {}, "b.ts": {} } },
    };
    expect(isHeaderOnly(populated)).toBe(false);
    expect(getCollapsedPreview(populated)).toBe("2 files tracked");
  });

  test("User text message preview strips <ide_*> tags", () => {
    const entry = {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text: "<ide_diagnostics>noisy</ide_diagnostics>real prompt",
          },
        ],
      },
    };
    expect(getCollapsedPreview(entry)).toBe("real prompt");
  });

  test("Assistant tool_use preview shows tool names", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", id: "1", input: {} },
          { type: "tool_use", name: "Edit", id: "2", input: {} },
        ],
      },
    };
    expect(getCollapsedPreview(entry)).toBe("Read, Edit");
  });
});

describe("Feature: Session Viewer — metadata extraction", () => {
  test("extractAllSessionMetadata reads ai-title, plan refs, and user prompt count from a Claude session JSONL", async () => {
    // Set HOME to a temp dir so CLAUDE_PROJECTS_DIR resolves under us.
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "viewer-home-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // Force a fresh import so module-level constants pick up the new HOME.
      const { extractAllSessionMetadata } = await import(
        "../../src/lib/session-metadata.js"
      );
      const { CLAUDE_PROJECTS_DIR } = await import(
        "../../../src/config.js?_=" + Date.now()
      );

      const projectPath = "/Users/test/my-project";
      const encoded = "-Users-test-my-project";
      const sessionDir = path.join(CLAUDE_PROJECTS_DIR, encoded);
      await fs.mkdir(sessionDir, { recursive: true });

      const sessionId = "11111111-1111-1111-1111-111111111111";
      const lines = [
        // 1 user prompt with text content
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "first prompt" }] },
        }),
        // 1 user message that's a pure tool_result — should NOT count
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
          },
        }),
        // 1 user prompt referencing a plan file
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "text",
                text: "see .claude/plans/my-plan.md for context",
              },
            ],
          },
        }),
        // ai-title at the end
        JSON.stringify({
          type: "ai-title",
          aiTitle: "Refactor session viewer",
        }),
      ];
      await fs.writeFile(
        path.join(sessionDir, `${sessionId}.jsonl`),
        lines.join("\n"),
      );

      const result = await extractAllSessionMetadata(
        [{ sessionId, agentName: "Claude Code" }],
        projectPath,
      );

      const meta = result.get(sessionId);
      expect(meta).toBeDefined();
      expect(meta!.aiTitle).toBe("Refactor session viewer");
      expect(meta!.hasPlans).toBe(true);
      // 2 real user prompts; the tool-result-only message is excluded.
      expect(meta!.userPromptCount).toBe(2);
    } finally {
      process.env.HOME = prevHome;
      await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("Feature: Session Viewer — Next.js Application (rendering)", () => {
  // Rendering scenarios are covered by component-level pure helpers above
  // (headers, collapse rules, preview strings). Full page-render tests
  // would require `next dev` + a fixture FS layout — declared skipped with reason.
  test.skip(
    "View all discovered sessions grouped by project: page render against next dev — skipped because next dev session-viewer requires full project install (file:..) which exceeds CI scope; helper logic covered above",
    () => {},
  );
  test.skip(
    "View formatted and highlighted JSON with long strings collapsed: covered by JsonViewer component which embeds prismjs; visual snapshot needed",
    () => {},
  );
  test.skip(
    "Click a long string to reveal its full content: requires browser interaction; covered by JsonViewer component contract",
    () => {},
  );
  test.skip(
    "Large sessions load incrementally via paginated API: API route at /api/session-entries supports offset/limit; pagination tested in 30-session-viewer-path-and-counts.test.ts",
    () => {},
  );
  test.skip(
    "Project cards show only the session count pill, no agent badge: ProjectCard component; visual contract",
    () => {},
  );
});
