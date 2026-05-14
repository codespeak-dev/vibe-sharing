/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import React from "react";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { EntryCard } from "../../src/components/entry-card.js";
import { entryReferencesPlans } from "../../src/components/message-renderer.js";

/**
 * Feature: Session Viewer — Plan Rendering.
 *
 * Plan files are detected by `entryReferencesPlans()` (pure helper) which
 * looks at content blocks for `tool_use` (Write/Read/Edit) targeting
 * `~/.claude/plans/*.md` AND for `tool_result` text containing the same
 * marker. We exercise the helper for the BDD scenarios that say "rendered as
 * markdown" / "marked with purple badge" without needing a full page render.
 *
 * Anything page-level (URL hash extraction, navigation, project page filter
 * to Claude Code only) is declared `test.skip` with a one-line reason — the
 * underlying primitives are exercised here, the page-render integration
 * lives in the Next.js app under `next dev`.
 */

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

describe("Feature: Session Viewer — Plan Rendering", () => {
  test("Write tool_use targeting a plan file is detected as a plan reference", () => {
    expect(
      entryReferencesPlans({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              id: "1",
              input: {
                file_path: "/Users/u/.claude/plans/refactor.md",
                content: "# Plan\n\n- step 1\n- step 2\n",
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  test("Edit tool_use targeting a plan file is detected as a plan reference", () => {
    expect(
      entryReferencesPlans({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              id: "2",
              input: {
                file_path: "/Users/u/.claude/plans/refactor.md",
                old_string: "x",
                new_string: "y",
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  test("Read tool_result whose content references a plan file is detected as a plan reference", () => {
    expect(
      entryReferencesPlans({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "x",
              content: "Read .claude/plans/refactor.md\n# Plan\n",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  test("Plan-related entry card displays a purple plan badge in the header", () => {
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
                  name: "Write",
                  id: "1",
                  input: {
                    file_path: "/Users/u/.claude/plans/refactor.md",
                    content: "# Plan\n",
                  },
                },
              ],
            },
          },
        })}
      />,
    );
    const badges = Array.from(container.querySelectorAll("span"));
    const planBadge = badges.find((s) => s.textContent === "plan");
    expect(planBadge).toBeDefined();
    expect(planBadge?.className).toMatch(/purple/);
  });

  test("Clicking the entry card header expands the entry and reveals plan content", () => {
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
                  name: "Write",
                  id: "1",
                  input: {
                    file_path: "/Users/u/.claude/plans/refactor.md",
                    content: "# Plan title\n\nbody text\n",
                  },
                },
              ],
            },
          },
        })}
      />,
    );

    // Entry starts collapsed (assistant message), no body present.
    expect(container.querySelector(".border-t")).toBeNull();
    const header = container.querySelector(".cursor-pointer") as HTMLElement;
    fireEvent.click(header);
    // Body appears with the plan content rendered inside.
    const body = container.querySelector(".border-t");
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain("Plan title");
  });

  test("PlanBadge button assigns to window.location.hash when clicked", async () => {
    const { PlanBadge } = await import("../../src/components/plan-badge.js");

    // Track hash assignments
    const original = window.location.hash;
    try {
      const { container } = render(<PlanBadge entryIndex={42} />);
      const button = container.querySelector("button");
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe("plan");

      fireEvent.click(button as Element);
      expect(window.location.hash).toBe("#entry-42");
    } finally {
      window.location.hash = original;
    }
  });

  test("Markdown tables in plan content render as <table> elements (remark-gfm pipeline)", () => {
    const tableMarkdown =
      "| col a | col b |\n|-------|-------|\n| 1     | 2     |\n";
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
                  name: "Write",
                  id: "1",
                  input: {
                    file_path: "/Users/u/.claude/plans/refactor.md",
                    content: tableMarkdown,
                  },
                },
              ],
            },
          },
        })}
      />,
    );
    // Expand the entry so MessageRenderer (and PlanToolUseBlock) renders.
    fireEvent.click(container.querySelector(".cursor-pointer") as HTMLElement);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // Cells should contain the markdown contents.
    expect(table?.textContent ?? "").toContain("col a");
    expect(table?.textContent ?? "").toContain("col b");
  });

  test.skip(
    "Navigating to URL hash targeting plan entry extracts and shows it: client.tsx groupEntries() promotes the highlightEntry to a standalone card (forceExpanded). Behavior depends on the hashchange listener + scrollIntoView path; covered by integration test under next dev",
    () => {},
  );

  test.skip(
    "Only Claude Code sessions appear on the project sessions page: SessionListPage filters to Claude Code via cachedDiscoverAllSessions; verified at the page render layer",
    () => {},
  );
});

// Read-only plan tool_use (no Write/Edit) still flagged as plan-related
describe("Feature: Session Viewer — Plan Rendering (Read tool_use direct)", () => {
  test("Read tool_use targeting a plan file is detected as a plan reference", () => {
    expect(
      entryReferencesPlans({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              id: "3",
              input: { file_path: "/Users/u/.claude/plans/refactor.md" },
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

// Negative case: ensure helper doesn't false-positive on unrelated content.
describe("Feature: Session Viewer — Plan Rendering (negative case)", () => {
  test("Entry without any plan reference is not flagged", () => {
    expect(
      entryReferencesPlans({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "no plan here" }],
        },
      }),
    ).toBe(false);
  });
});
