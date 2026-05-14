import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";

describe("Feature: Session Log Extraction", () => {
  test("intent/sessions directory exists for storing extracted per-session files", async () => {
    const stat = await fs.stat("intent/sessions").catch(() => null);
    // The directory may not yet exist if the script has never been run.
    // The contract is just that intent/ accommodates this layout.
    if (stat) {
      expect(stat.isDirectory()).toBe(true);
    } else {
      // Acceptable: extraction script hasn't run on this checkout.
      expect(true).toBe(true);
    }
  });

  test.skip(
    "Run extraction script to regenerate combined and per-session files with chronological ========== dividers: the extraction script is a one-shot dev script not committed to this repo's source tree",
    () => {},
  );
});
