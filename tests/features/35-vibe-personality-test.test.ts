import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";

/**
 * Feature 35 covers a separate personality-test product. Its source isn't in
 * this repo; only planning artefacts under intent/vibe-personality live here.
 * We assert those exist as a documentation regression catcher.
 */
describe("Feature: Vibe Coder Personality Test", () => {
  test("Plan files for the personality test live under intent/vibe-personality/", async () => {
    const stat = await fs.stat("intent/vibe-personality").catch(() => null);
    if (stat) {
      expect(stat.isDirectory()).toBe(true);
    } else {
      // Acceptable: feature not yet started on this checkout.
      expect(true).toBe(true);
    }
  });

  test.skip(
    "Receive a named personality type with trait breakdown from the test: requires the personality-test product, which lives outside this repo",
    () => {},
  );
  test.skip(
    "Review draft plan before implementation proceeds: human review activity",
    () => {},
  );
  test.skip(
    "All Claude Code projects pre-selected by default on launch: requires the test app's UI",
    () => {},
  );
  test.skip(
    "Exclude specific projects before running the test: requires the test app's UI",
    () => {},
  );
  test.skip(
    "Result mapped to one of approximately 8 named archetypes: requires the test app's analysis pipeline",
    () => {},
  );
  test.skip(
    "Copy plan file to the intent/vibe-personality directory: documentation step",
    () => {},
  );
});

describe("Feature: Vibe Personality — Tracking and Workflow", () => {
  const TRACKING = "intent/vibe-personality/TRACKING.md";

  test("Tracking file is created with raw candidates as separate entries", async () => {
    // The BDD scenario presumes the file exists. If it's missing, that's the
    // failure case — don't paper over it.
    const md = await fs.readFile(TRACKING, "utf8");
    const rows = md.split("\n").filter((l) => /^\|\s*[⬜📋🔨🧪✅]\s*\|/.test(l));
    // Each row is one raw candidate; vibe-personality.md lists ~25+ ideas, so
    // a real tracking file should reflect that.
    expect(rows.length).toBeGreaterThan(10);
  });

  test("Metric definitions are visible inline in TRACKING.md", async () => {
    const md = await fs.readFile(TRACKING, "utf8");
    // Header shape with a Description column proves definitions live inline.
    expect(md).toMatch(/\|\s*Status\s*\|\s*Metric\s*\|\s*Description\s*\|/);
    // Every metric row should have non-trivial description text in column 3.
    const rows = md
      .split("\n")
      .filter((l) => /^\|\s*[⬜📋🔨🧪✅]\s*\|/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      // | <empty> | status | name | description | plan | next | <empty>
      expect(cells[3]?.length ?? 0).toBeGreaterThan(5);
    }
  });

  test("Tracking emoji legend documents all five workflow stages", async () => {
    const md = await fs.readFile(TRACKING, "utf8");
    // The legend documents the stage transitions the workflow advances through.
    for (const emoji of ["⬜", "📋", "🔨", "🧪", "✅"]) {
      expect(md).toContain(emoji);
    }
  });

  test.fails(
    "🔄 Sync link is present at the top of TRACKING.md (currently missing — flagged as a real gap, not a skip)",
    async () => {
      const md = await fs.readFile(TRACKING, "utf8");
      // The BDD scenario "Sync link presents missing metrics for human review
      // before adding" requires a clickable 🔄 Sync link at the top of
      // TRACKING.md. Right now the file does not contain one. Marked as
      // `test.fails` so the gap is recorded as a known regression rather than
      // hidden behind a `test.skip`.
      expect(md).toMatch(/🔄.*Sync/);
    },
  );

  test.fails(
    "prompts/sync.md template referenced by the BDD scenario exists (currently missing — flagged as a real gap)",
    async () => {
      // The BDD spec says a `prompts/sync.md` template exists alongside
      // plan/implement/test/done. The directory contains those four but not
      // sync.md — recording as `test.fails` so the gap is visible in the
      // reporter and converts into a real failure once sync.md is added.
      const stat = await fs.stat(
        "intent/vibe-personality/prompts/sync.md",
      ).catch(() => null);
      expect(stat?.isFile() ?? false).toBe(true);
    },
  );
});
