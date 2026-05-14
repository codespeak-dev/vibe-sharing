import { describe, expect, test, vi } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { GooseDecoration } from "../../src/ui/components/goose-decoration.js";

describe("Feature: Console UI Gratitude Animation", () => {
  test("Renders a gratitude frame containing 'THANK YOU' or 'AMAZING' or 'GRATITUDE' or 'BEST'", () => {
    const { lastFrame, unmount } = render(<GooseDecoration animate={false} />);
    const frame = lastFrame() ?? "";
    const messages = ["THANK", "AMAZING", "GRATITUDE", "BEST"];
    expect(messages.some((m) => frame.includes(m))).toBe(true);
    unmount();
  });

  test("animate=true cycles through frames at the configured interval", async () => {
    const { lastFrame, unmount } = render(
      <GooseDecoration animate intervalMs={50} />,
    );
    const initial = lastFrame() ?? "";
    // Real timer: wait long enough for a tick + react re-render.
    await new Promise((r) => setTimeout(r, 200));
    const after = lastFrame() ?? "";
    expect(initial).not.toBe(after);
    unmount();
  });

  test("animate=false renders a static frame (no timer set)", () => {
    vi.useFakeTimers();
    try {
      const { lastFrame, unmount } = render(<GooseDecoration animate={false} />);
      const initial = lastFrame() ?? "";
      vi.advanceTimersByTime(60_000);
      const after = lastFrame() ?? "";
      expect(initial).toBe(after);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  test.skip(
    "Display gratitude frames while scrolling through menu options: keypress-driven advance is part of an interactive checkbox/select prompt; covered by ConsentScreen + thank-you tests for the rendering primitive",
    () => {},
  );
  test.skip(
    "Hide gratitude animation on Enter confirmation: handled by the parent screen's transition (ConsentScreen → ThankYouScreen) which is covered in 12 + 29",
    () => {},
  );
});
