/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { EntryCard } from "../../src/components/entry-card.js";
import { getDisplayType } from "../../src/components/message-renderer.js";

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

/**
 * Feature: Session Viewer — Three-Layer Display Pipeline.
 *
 * The pipeline lives in session-viewer/src/app/.../client.tsx (groupEntries)
 * + EntryCard's per-card defaults. Many scenarios in this feature describe
 * future behaviour (topical grouping, N ToolName summaries, subagent
 * enrichment, filter pills, model badging) that the current implementation
 * does not yet have — those are recorded as `test.skip` with one-line reasons
 * so they remain visible in the BDD reporter.
 *
 * The scenarios that are testable today against existing primitives:
 *   - Primary-interest cards are expanded by default
 *   - Non-user cards collapsed by default (covers low-signal collapse)
 *   - User vs assistant cards are visually distinct (different bg/text classes)
 *   - getDisplayType correctly classifies tool-result vs user, etc.
 */

describe("Feature: Session Viewer — Three-Layer Display Pipeline", () => {
  test("Important blocks (user prompts) are immediately visible without interaction (expanded by default)", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: { content: [{ type: "text", text: "what's up" }] },
          },
        })}
      />,
    );
    expect(container.querySelector(".border-t")).not.toBeNull();
  });

  test("All non-primary-interest cards (assistant tool_use, progress, queue, file-history-snapshot) collapse by default", () => {
    const types = ["assistant", "progress", "queue-operation", "file-history-snapshot"];
    for (const type of types) {
      const { container, unmount } = render(
        <EntryCard
          entry={makeEntry({
            type,
            raw: type === "file-history-snapshot"
              ? { type, snapshot: { trackedFileBackups: { "a": {} } } }
              : { type },
          })}
        />,
      );
      // No body region in collapsed state.
      expect(container.querySelector(".border-t")).toBeNull();
      unmount();
    }
  });

  test("User and assistant cards are visually distinct (contrasting background classes)", () => {
    const userRender = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: { content: [{ type: "text", text: "hi" }] },
          },
        })}
      />,
    );
    const userBadge = userRender.container.querySelector(
      "span.font-semibold",
    ) as HTMLElement | null;
    expect(userBadge?.className ?? "").toMatch(/blue/);
    userRender.unmount();

    const asstRender = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: { content: [{ type: "text", text: "ok" }] },
          },
        })}
      />,
    );
    const asstBadge = asstRender.container.querySelector(
      "span.font-semibold",
    ) as HTMLElement | null;
    expect(asstBadge?.className ?? "").toMatch(/green/);
  });

  test("Tool-result user message is reclassified (low-signal) via getDisplayType", () => {
    const toolResult = {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "x", content: "ok" },
        ],
      },
    };
    expect(getDisplayType(toolResult)).toBe("tool-result");
    // And the tool-result card should be collapsed by default.
    const { container } = render(
      <EntryCard
        entry={makeEntry({ type: "user", raw: toolResult })}
      />,
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });

  // ---- Scenarios pending downstream pipeline implementation -----------------
  // The bdd.cs.md sections that describe topical groups, subagent enrichment,
  // filter pills, model badging, and Expand All controls describe behaviour the
  // current code does not yet ship. Each is logged as `test.skip` with the
  // reason, so the scenario remains visible in the reporter and converts to a
  // real test once the corresponding code lands.

  test.skip(
    "Progress blocks appear as a single collapsed group: groupEntries() in client.tsx coalesces consecutive non-user entries; integration tested via session detail page render",
    () => {},
  );
  test.skip(
    "Tool call unit shows call, hooks, and result together: ToolCycle grouping not yet implemented; would be a layer-2 (topical) group containing the tool_use + matching tool_result + hook entries",
    () => {},
  );
  test.skip(
    "All blocks in a session are reachable by the user: every collapsed group exposes an expand control; integration scenario — assertion lives in groupEntries() invariant tests",
    () => {},
  );
  test.skip(
    "Expand All expands all collapsed blocks and groups simultaneously: Expand All control is part of the filter UI, not yet implemented",
    () => {},
  );
  test.skip(
    "All non-primary-interest cards between two primary cards form one collapsed group: groupEntries() coalesces but does not currently enforce 'exactly one collapsed group between primaries' — current logic produces one per consecutive non-user run",
    () => {},
  );
  test.skip(
    "User can inspect and adjust filter and classification controls: filter UI not yet implemented",
    () => {},
  );
  test.skip(
    "Single-card sequence appears standalone without group wrapper: current groupEntries() wraps even single non-user entries in a group; topical-group rule not yet implemented",
    () => {},
  );
  test.skip(
    "Collapsed group with timing data shows duration on right side: collapsed group duration formatting not yet implemented",
    () => {},
  );
  test.skip(
    "Expanding collapsed group containing single topical group expands both: topical groups not yet implemented",
    () => {},
  );
  test.skip(
    "Groups containing only queue operations auto-expand on initial render: queue auto-expand not yet implemented",
    () => {},
  );
  test.skip(
    "Session-level most common model is shown and per-card model omitted when matching: per-session most-common-model display not yet implemented (assistant cards still show model on every card via AssistantMessage)",
    () => {},
  );
  test.skip(
    "Card shows its model when it differs from the session-level model: depends on session-level model display being added first",
    () => {},
  );
  test.skip(
    "All entries load automatically without requiring scroll interaction: client.tsx uses IntersectionObserver sentinel; spec says 'eager pagination' but current code is still observer-based",
    () => {},
  );
  test.skip(
    "Filter controls allow user to change active filter setting: filter UI not yet implemented",
    () => {},
  );
  test.skip(
    "Filter controls reflect previously saved settings on load: filter UI persistence to localStorage not yet implemented",
    () => {},
  );
  test.skip(
    "Collapsing an expanded filter pill updates the conversation view: filter UI not yet implemented",
    () => {},
  );
  test.skip(
    "Collapsed group header shows accurate card count in '▸ XXX cards' format: current header is '··· N messages ···'; '▸ XXX cards' format not yet implemented",
    () => {},
  );
  test.skip(
    "Tool call summary text uses N ToolName format: collapsed-group tool breakdown summary not yet implemented",
    () => {},
  );
  test.skip(
    "Subagent tool-call card shows type and description in title bar: subagent special-casing not yet implemented",
    () => {},
  );
  test.skip(
    "Expanded subagent card shows Prompt heading, worked-for duration, and result without repeating description: subagent special-casing not yet implemented",
    () => {},
  );
  test.skip(
    "Subagent tool-result card content renders as markdown: subagent enrichment not yet implemented",
    () => {},
  );
});
