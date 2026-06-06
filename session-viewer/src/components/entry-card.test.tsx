import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ADAPT: the EntryCard component, the ToolUseInfo type, and the entry/toolMap props below are
// the reference impl's API (toolMap resolves tool_use_id -> { name, input }). Repoint to the
// submission's card component / prop shape if different.
import { EntryCard } from "@/components/entry-card";
import type { ToolUseInfo } from "@/components/message-renderer";

/**
 * Build a `tool-result` SessionEntry: a user-type entry whose message.content is
 * one-or-more tool_result blocks, plus a toolMap resolving every tool_use_id to a
 * Read tool_use. getDisplayType() resolves this to "tool-result", so the EntryCard
 * starts collapsed (defaultExpanded is false for non-"user" display types).
 */
function makeToolResultEntry(
  results: Array<{ toolUseId: string; filePath: string; text: string }>,
) {
  const entry = {
    lineIndex: 0,
    type: "user",
    timestamp: null,
    raw: {
      type: "user",
      message: {
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content: r.text,
        })),
      },
    },
  };
  const toolMap = new Map<string, ToolUseInfo>(
    results.map((r) => [r.toolUseId, { name: "Read", input: { file_path: r.filePath } }]),
  );
  return { entry, toolMap };
}

/** Return the exact text content of every rendered tool-result <pre>, in document order. */
function resultPreTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("pre")).map((pre) => pre.textContent ?? "");
}

describe("EntryCard tool-result expansion", () => {
  /*
   * T01: Scenario: Expanding a Read tool-result card reveals the file contents immediately
   *
   * Given a `SessionEntry` of type `"user"` whose `message.content` is a single `tool_result` block carrying multi-line file text as its `content`, with a `toolMap` resolving its `tool_use_id` to `{ name: "Read", input: { file_path } }`
   * And the `EntryCard` is rendered and starts collapsed because its display type resolves to `"tool-result"`
   * When the user clicks the card header once to expand the card
   * Then the nested `ToolResultBlock`'s result content (the file text) is visible
   * And no second click on the inner "Tool Result" toggle is required to reveal it
   */
  it("T01: reveals the file contents after a single header click, with no inner toggle click", async () => {
    const user = userEvent.setup();
    const fileText = [
      "export function greet(name: string): string {",
      "  return `Hello, ${name}!`;",
      "}",
    ].join("\n");
    const { entry, toolMap } = makeToolResultEntry([
      { toolUseId: "toolu_read_01", filePath: "/repo/src/greet.ts", text: fileText },
    ]);

    const { container } = render(<EntryCard entry={entry} toolMap={toolMap} />);

    // Precondition: collapsed — the file text is not rendered yet.
    expect(resultPreTexts(container)).toEqual([]);

    // ADAPT: the reference-specific LABELS used to locate controls below are not the graded
    // behaviour — repoint them to the submission's: the header toggle is found via the
    // "tool-result" badge text; the inner toggle via /Read result/; the expand/collapse state via
    // the "v"/">" indicator glyphs; and the expanded-only view buttons via "JSON"/"Rendered".
    // The graded behaviour is purely the <pre> file-content text appearing/hiding (resultPreTexts).
    // One click on the card header (the "tool-result" badge lives in the header row).
    await user.click(within(container).getByText("tool-result"));

    // The nested block auto-expands: the full file text is visible after exactly one click,
    // without touching the inner "Read result" toggle (whose indicator shows "v" = expanded).
    expect(resultPreTexts(container)).toEqual([fileText]);
    const innerToggle = within(container).getByRole("button", { name: /Read result/ });
    expect(innerToggle).toHaveTextContent("v");
  });

  /*
   * T02: Scenario: Expanding an entry with several tool_result blocks expands all of them
   *
   * Given a tool-result `SessionEntry` whose `message.content` is an array of two `tool_result` blocks, each with distinct file text and distinct `tool_use_id`s mapped in `toolMap`
   * And the `EntryCard` is rendered collapsed
   * When the user clicks the card header once to expand it
   * Then the result content of both nested `ToolResultBlock`s is visible simultaneously
   */
  it("T02: reveals every nested tool-result block after a single header click", async () => {
    const user = userEvent.setup();
    const fileTextA = ["alpha line 1", "alpha line 2", "function alpha() {}"].join("\n");
    const fileTextB = ["beta line 1", "beta line 2", "function beta() {}"].join("\n");
    const { entry, toolMap } = makeToolResultEntry([
      { toolUseId: "toolu_read_02a", filePath: "/repo/src/alpha.ts", text: fileTextA },
      { toolUseId: "toolu_read_02b", filePath: "/repo/src/beta.ts", text: fileTextB },
    ]);

    const { container } = render(<EntryCard entry={entry} toolMap={toolMap} />);

    expect(resultPreTexts(container)).toEqual([]);

    await user.click(within(container).getByText("tool-result"));

    // Both nested blocks are independently auto-expanded — both file texts render at once.
    expect(resultPreTexts(container)).toEqual([fileTextA, fileTextB]);
  });

  /*
   * T03: Scenario: An auto-expanded nested tool-result block can still be collapsed manually
   *
   * Given a tool-result `EntryCard` that has been expanded so the nested `ToolResultBlock` content is visible
   * When the user clicks the inner "Tool Result" toggle on that nested block
   * Then the nested block's result content is hidden again while the surrounding `EntryCard` stays expanded
   */
  it("T03: lets the inner toggle re-collapse the nested block while the card stays expanded", async () => {
    const user = userEvent.setup();
    const fileText = ["keep me", "around", "please"].join("\n");
    const { entry, toolMap } = makeToolResultEntry([
      { toolUseId: "toolu_read_03", filePath: "/repo/src/toggle.ts", text: fileText },
    ]);

    const { container } = render(<EntryCard entry={entry} toolMap={toolMap} />);

    // Expand the card so the nested block content is visible (auto-expanded).
    await user.click(within(container).getByText("tool-result"));
    expect(resultPreTexts(container)).toEqual([fileText]);

    // Click the inner "Read result" toggle on the nested block.
    await user.click(within(container).getByRole("button", { name: /Read result/ }));

    // The nested block's content is hidden again...
    expect(resultPreTexts(container)).toEqual([]);
    // ...while the surrounding EntryCard stays expanded: the body is still mounted (the inner
    // toggle button is still present, now showing ">" = collapsed) and the card's expanded-only
    // "JSON" / "Rendered" view buttons are still rendered.
    const innerToggle = within(container).getByRole("button", { name: /Read result/ });
    expect(innerToggle).toHaveTextContent(">");
    expect(within(container).getByRole("button", { name: "JSON" })).toBeInTheDocument();
    expect(within(container).getByRole("button", { name: "Rendered" })).toBeInTheDocument();
  });
});
