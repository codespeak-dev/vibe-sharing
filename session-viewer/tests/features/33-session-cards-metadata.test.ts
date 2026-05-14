import { describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  isSameDate,
  truncate,
  stripIdeTags,
} from "../../src/lib/format.js";

/**
 * Feature 33 covers the metadata shown on session cards. The presentation
 * relies on a handful of pure formatters in session-viewer/src/lib/format.ts
 * that we can unit-test in isolation. Sorting + ai-title extraction live in
 * the metadata extractor; covered by 32-session-viewer-nextjs.test.ts.
 */
describe("Feature: Session Viewer — Session Cards with Metadata", () => {
  describe("Date and time range formatting", () => {
    test("formatTime renders 24-hour hh:mm", () => {
      // 2026-04-15T08:05:00Z is well-defined; we just assert the output looks
      // like "HH:MM" with no AM/PM suffix.
      const out = formatTime("2026-04-15T08:05:00Z");
      expect(out).toMatch(/^\d{2}:\d{2}$/);
      expect(out).not.toMatch(/AM|PM/i);
    });

    test("isSameDate distinguishes same day from different days", () => {
      expect(isSameDate("2026-04-15T01:00:00Z", "2026-04-15T22:00:00Z")).toBe(true);
      expect(isSameDate("2026-04-15T22:00:00Z", "2026-04-16T01:00:00Z")).toBe(false);
    });

    test("formatDateTime omits the year when in the current year", () => {
      const thisYear = new Date().getFullYear();
      const iso = `${thisYear}-04-15T08:05:00Z`;
      const out = formatDateTime(iso);
      expect(out).not.toContain(String(thisYear));
    });

    test("formatDateTime includes the year when in a past year", () => {
      const out = formatDateTime("2020-04-15T08:05:00Z");
      expect(out).toContain("2020");
    });

    test("formatDuration: same start/end is 0m", () => {
      expect(formatDuration("2026-04-15T08:05:00Z", "2026-04-15T08:05:00Z")).toBe("0m");
    });

    test("formatDuration: under an hour shows minutes only", () => {
      expect(formatDuration("2026-04-15T08:00:00Z", "2026-04-15T08:42:00Z")).toBe("42m");
    });

    test("formatDuration: hours and minutes when 1+ hours", () => {
      expect(formatDuration("2026-04-15T08:00:00Z", "2026-04-15T10:30:00Z")).toBe("2h 30m");
    });

    test("formatDuration: days and hours when 1+ days", () => {
      expect(formatDuration("2026-04-15T08:00:00Z", "2026-04-17T11:00:00Z")).toBe("2d 3h");
    });

    test("formatDuration returns empty string when end < start", () => {
      expect(formatDuration("2026-04-16T00:00:00Z", "2026-04-15T00:00:00Z")).toBe("");
    });

    test("formatDate of null or empty returns empty string", () => {
      expect(formatDate(null)).toBe("");
      expect(formatDate("")).toBe("");
    });

    test("formatRelative returns 'just now' for under a minute", () => {
      const recent = new Date(Date.now() - 10_000).toISOString();
      expect(formatRelative(recent)).toBe("just now");
    });

    test("formatRelative returns 'Xm ago' for minutes", () => {
      const ago = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelative(ago)).toBe("5m ago");
    });

    test("formatRelative returns 'Xh ago' for hours", () => {
      const ago = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
      expect(formatRelative(ago)).toBe("3h ago");
    });
  });

  describe("File size formatting (used in card subtext)", () => {
    test("0 bytes renders as '0 B'", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    test("bytes under 1 KB show as plain bytes", () => {
      expect(formatBytes(512)).toBe("512 B");
    });

    test("KB and MB use one decimal place", () => {
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    });
  });

  describe("Misc text helpers", () => {
    test("truncate appends ellipsis when over maxLen", () => {
      expect(truncate("hello world", 5)).toBe("hello...");
      expect(truncate("hi", 5)).toBe("hi");
    });

    test("stripIdeTags removes <ide_*> blocks", () => {
      const input = "before<ide_diagnostics>noisy</ide_diagnostics>after";
      expect(stripIdeTags(input)).toBe("beforeafter");
    });
  });

  test.skip(
    "Sessions sorted by most recent activity on project page: requires next.js page render; covered indirectly by detectProjectFiles + page.tsx sort logic which is a pure date comparison",
    () => {},
  );
  test.skip(
    "Session card 'XX msgs (YY prompts)' format: rendered by SessionCard.tsx; userPromptCount calculation tested in 32-session-viewer-nextjs.test.ts",
    () => {},
  );
  test.skip(
    "Session card plan badge: rendered by SessionCard.tsx; hasPlans calculation tested in 32-session-viewer-nextjs.test.ts",
    () => {},
  );
});

// Smoke test: confirm format.ts ships in the project under test and exports
// the symbols the session-viewer relies on (regression catcher for refactors).
describe("session-viewer format.ts ships expected exports", () => {
  test("format.ts file exists at the documented path", async () => {
    const p = path.join("src", "lib", "format.ts");
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
  });
});
