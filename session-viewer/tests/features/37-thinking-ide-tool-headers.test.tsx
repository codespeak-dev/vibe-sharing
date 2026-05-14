/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test } from "vitest";
import React from "react";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { EntryCard } from "../../src/components/entry-card.js";
import {
  entryHasThinking,
  getThinkingPreview,
  getEntryIdeTags,
  type ToolUseInfo,
} from "../../src/components/message-renderer.js";
import { foldCwd, parseIdeTags, shortenPath } from "../../src/lib/format.js";

afterEach(() => {
  cleanup();
});

interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

function makeEntry(overrides: Partial<SessionEntry>): SessionEntry {
  return {
    lineIndex: 1,
    type: "assistant",
    timestamp: null,
    raw: { type: "assistant" },
    ...overrides,
  };
}

describe("Feature: Session Viewer — Thinking Blocks", () => {
  test("Thinking blocks are detected and a preview of the first line is exposed", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "first thought\nsecond thought" },
          { type: "text", text: "ok" },
        ],
      },
    };
    expect(entryHasThinking(entry)).toBe(true);
    expect(getThinkingPreview(entry)).toBe("first thought");
  });

  test("Thinking blocks show a secondary 'thinking' tag in the entry card header", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: {
              content: [
                { type: "thinking", thinking: "deliberating\nmore" },
                { type: "text", text: "final" },
              ],
            },
          },
        })}
      />,
    );
    const badges = Array.from(container.querySelectorAll("span"));
    const thinking = badges.find((s) => s.textContent === "thinking");
    expect(thinking).toBeDefined();
    // Collapsed preview text should reflect the first thinking line.
    expect(container.textContent).toContain("deliberating");
  });
});

describe("Feature: Session Viewer — IDE Tags", () => {
  test("IDE tag badges are exposed for each <ide_*> tag in a user message", () => {
    const entry = {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text:
              "<ide_opened_file>foo.ts</ide_opened_file><ide_diagnostics>x</ide_diagnostics>real prompt",
          },
        ],
      },
    };
    const tags = getEntryIdeTags(entry);
    expect(tags.map((t) => t.tagName)).toEqual([
      "ide_opened_file",
      "ide_diagnostics",
    ]);
  });

  test("Clicking an IDE tag badge toggles its expanded state", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: {
              content: [
                {
                  type: "text",
                  text: "<ide_opened_file>foo.ts</ide_opened_file>real prompt",
                },
              ],
            },
          },
        })}
      />,
    );
    // User messages render expanded, so the inline IdeTagBlock button is in the DOM.
    const ideButtons = Array.from(container.querySelectorAll("button"));
    const tagBtn = ideButtons.find((b) =>
      (b.textContent ?? "").includes("ide_opened_file"),
    );
    expect(tagBtn).toBeDefined();
    if (!tagBtn) return;

    // Initially the tag's expanded panel (a sibling div) is not rendered.
    // The collapsed-state button shows a short preview, so we assert on the
    // panel's presence rather than text content.
    const panelSelector = ".bg-neutral-900\\/50.border";
    expect(container.querySelector(panelSelector)).toBeNull();
    fireEvent.click(tagBtn);
    expect(container.querySelector(panelSelector)).not.toBeNull();
    expect(container.textContent ?? "").toContain("foo.ts");

    // Click again — panel hides.
    fireEvent.click(tagBtn);
    expect(container.querySelector(panelSelector)).toBeNull();
  });

  test("Long file paths are truncated from the left with leading ellipsis", () => {
    const long = "/very/deep/nested/path/to/somewhere/foo.ts";
    const out = shortenPath(long, 20);
    expect(out.startsWith("...")).toBe(true);
    expect(out.endsWith("foo.ts")).toBe(true);
  });

  test("CWD prefix in a path is replaced with $CWD", () => {
    expect(foldCwd("/Users/u/proj/src/main.ts", "/Users/u/proj")).toBe(
      "$CWD/src/main.ts",
    );
  });
});

describe("Feature: Session Viewer — Tool Call & Result Headers", () => {
  test("Bash tool call header shows the command badge with name and command preview", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "1",
                  name: "Bash",
                  input: { command: "ls -la /tmp" },
                },
              ],
            },
          },
        })}
      />,
    );
    // Amber Bash badge in the header
    const bash = Array.from(container.querySelectorAll("span")).find(
      (s) => s.textContent === "Bash",
    );
    expect(bash).toBeDefined();
    expect(bash?.className).toMatch(/amber/);
    // Command preview
    expect(container.textContent).toContain("ls -la /tmp");
  });

  test("Tool result header resolves the originating tool name via tool_use_id lookup", () => {
    const toolMap = new Map<string, ToolUseInfo>([
      ["t-1", { name: "Read", input: { file_path: "/Users/u/proj/foo.ts" } }],
    ]);
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "t-1",
                  content: "file contents",
                },
              ],
            },
          },
        })}
        toolMap={toolMap}
      />,
    );
    // The amber tool badge in the entry header should show the resolved name "Read".
    const badges = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "Read" && /amber/.test(s.className),
    );
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("foo.ts");
  });

  test("Message timestamp appears at the far right of the entry card header", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          timestamp: "2026-04-15T08:30:45Z",
          raw: {
            type: "assistant",
            message: { content: [{ type: "text", text: "hi" }] },
          },
        })}
      />,
    );
    const header = container.querySelector(".cursor-pointer") as HTMLElement;
    // The timestamp lives inside an ml-auto container — i.e. pushed to the far right.
    const right = header?.querySelector(".ml-auto");
    expect(right?.textContent ?? "").toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("parseIdeTags exposes tag name and content for each <ide_*> block", () => {
    const { tags } = parseIdeTags(
      "<ide_diagnostics>line 1</ide_diagnostics>extra",
    );
    expect(tags).toEqual([
      { tagName: "ide_diagnostics", content: "line 1" },
    ]);
  });
});

describe("Feature: Session Viewer — Tool Block Expansion Contract", () => {
  test("Expanding a tool result auto-expands the inner content (ToolResultBlock starts expanded)", () => {
    const toolMap = new Map<string, ToolUseInfo>([
      ["t-1", { name: "Read", input: { file_path: "/Users/u/proj/foo.ts" } }],
    ]);
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "t-1",
                  content: "the file contents go here",
                },
              ],
            },
          },
        })}
        toolMap={toolMap}
      />,
    );

    // The entry card itself starts collapsed (tool-result subtype is collapsed
    // by default). Click the entry header to expand it and reveal the inner
    // ToolResultBlock — which itself should be already expanded, exposing the
    // file contents without an additional click.
    const entryHeader = container.querySelector(".cursor-pointer") as HTMLElement;
    fireEvent.click(entryHeader);
    expect(container.textContent ?? "").toContain("the file contents go here");
  });

  test("Tool call block header text is identical in collapsed and expanded states", () => {
    // Render an assistant entry with a Bash tool_use, expand the entry, then
    // capture the inner ToolUseBlock's header text. Toggle the inner block
    // collapsed↔expanded and assert the header text doesn't change.
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "1",
                  name: "Bash",
                  input: { command: "ls -la /tmp" },
                },
              ],
            },
          },
        })}
      />,
    );
    // Expand outer entry first (collapsed by default for assistant).
    fireEvent.click(container.querySelector(".cursor-pointer") as HTMLElement);

    // The inner ToolUseBlock is collapsed by default. Find its toggle button.
    const toolButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((b) => (b.textContent ?? "").includes("Bash"));
    expect(toolButtons.length).toBeGreaterThan(0);
    const toolBtn = toolButtons[0]!;

    const beforeText = (toolBtn.textContent ?? "").trim();
    expect(beforeText).toContain("Bash");
    expect(beforeText).toContain("ls -la /tmp");

    // Expand
    fireEvent.click(toolBtn);
    const expandedText = (toolBtn.textContent ?? "").trim();
    // Header text identical aside from the leading caret indicator (> vs v).
    const stripCaret = (s: string) => s.replace(/^[>v]\s*/, "");
    expect(stripCaret(expandedText)).toBe(stripCaret(beforeText));

    // Collapse again — header still identical.
    fireEvent.click(toolBtn);
    const collapsedAgain = (toolBtn.textContent ?? "").trim();
    expect(stripCaret(collapsedAgain)).toBe(stripCaret(beforeText));
  });
});
