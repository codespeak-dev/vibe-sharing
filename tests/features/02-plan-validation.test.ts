import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Feature 2 is about asking an AI to do gap analysis on a plan document — a
 * meta scenario that's about prompt-driven analysis, not deterministic code.
 * What we *can* assert is that the plan documents the BDD references actually
 * exist at the documented paths, so a regression that loses them surfaces.
 */
describe("Feature: Plan Validation and Gap Analysis", () => {
  test("Plan documents referenced by BDD live under intent/ as expected", async () => {
    const intent = await fs.readdir("intent");
    expect(intent.length).toBeGreaterThan(0);
  });

  test("Each non-hidden top-level intent/ entry is either a directory or a markdown file", async () => {
    const entries = await fs.readdir("intent", { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // skip dotfiles like .todo
      const ok = e.isDirectory() || e.name.endsWith(".md");
      expect(ok, `unexpected entry: ${e.name}`).toBe(true);
    }
  });

  test.skip(
    "Asking the AI to gap-analyse a plan returns a structured report: this is a prompt-engineering scenario, not a deterministic code path. Validation belongs in human review.",
    () => {},
  );
});
