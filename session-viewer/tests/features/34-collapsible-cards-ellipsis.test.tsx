/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test } from "vitest";
import React from "react";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { EntryCard } from "../../src/components/entry-card.js";

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
    type: "user",
    timestamp: null,
    raw: { type: "user" },
    ...overrides,
  };
}

describe("Feature: Session Viewer — Collapsible Cards and Ellipsis Grouping", () => {
  test("Each message displays its type badge exactly once in the EntryCard header", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: { type: "assistant", message: { content: [] } },
        })}
      />,
    );
    const badges = container.querySelectorAll("span.font-semibold");
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toBe("assistant");
  });

  test("ai-title card displays title in header with no card body", () => {
    const { container, getByText } = render(
      <EntryCard
        entry={makeEntry({
          type: "ai-title",
          raw: { type: "ai-title", aiTitle: "Refactor module" },
        })}
      />,
    );
    expect(getByText("Refactor module")).toBeDefined();
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("FileSnapshot with no tracked files displays that state in header", () => {
    const { container, getByText } = render(
      <EntryCard
        entry={makeEntry({
          type: "file-history-snapshot",
          raw: {
            type: "file-history-snapshot",
            snapshot: { trackedFileBackups: {} },
          },
        })}
      />,
    );
    expect(getByText("no files tracked")).toBeDefined();
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("Non-user-message cards are collapsed by default", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: { content: [{ type: "text", text: "hello world" }] },
          },
        })}
      />,
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("User message cards are expanded by default", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: { content: [{ type: "text", text: "hello" }] },
          },
        })}
      />,
    );
    expect(container.querySelector(".border-t")).not.toBeNull();
  });

  test("Expanding a collapsed card reveals full content", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "assistant",
          raw: {
            type: "assistant",
            message: { content: [{ type: "text", text: "hello" }] },
          },
        })}
      />,
    );
    expect(container.querySelector(".border-t")).toBeNull();

    const header = container.querySelector(".cursor-pointer") as HTMLElement;
    fireEvent.click(header);
    expect(container.querySelector(".border-t")).not.toBeNull();
  });

  test("Tool-result user message displays amber 'tool-result' badge and is collapsed by default", () => {
    const { container } = render(
      <EntryCard
        entry={makeEntry({
          type: "user",
          raw: {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
            },
          },
        })}
      />,
    );
    const badge = container.querySelector("span.font-semibold");
    expect(badge?.textContent).toBe("tool-result");
    expect(badge?.className).toMatch(/amber/);
    expect(container.querySelector(".border-t")).toBeNull();
  });

  test("Lineindex shown in header for traceability", () => {
    const { getByText } = render(
      <EntryCard
        entry={makeEntry({
          lineIndex: 42,
          type: "assistant",
          raw: { type: "assistant" },
        })}
      />,
    );
    expect(getByText("#42")).toBeDefined();
  });

  test.skip(
    "Consecutive non-user messages hidden behind ellipsis with count: lives in CollapsedGroup in client.tsx; covered by component integration",
    () => {},
  );
  test.skip(
    "Clicking the ellipsis expands hidden messages: same — CollapsedGroup contract",
    () => {},
  );
  test.skip(
    "Long sessions load additional messages when many are hidden: client.tsx loadMore; covered by 30 pagination test",
    () => {},
  );
  test.skip(
    "Session detail page shows the same metadata summary as session card: page-level integration",
    () => {},
  );
});
