import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Feature 14 covers the operator scripts under scripts/. They're bash + AWS
 * CLI, so we can't exercise their behavior without real AWS access. What we
 * CAN assert is the static contract: scripts exist, are executable, and
 * implement the documented flags. That catches accidental deletion or
 * permission regressions.
 */
describe("Feature: Upload Record Status and Maintenance", () => {
  test("scripts/status exists and is executable", async () => {
    const stat = await fs.stat("scripts/status");
    expect(stat.isFile()).toBe(true);
    // owner execute bit
    expect(stat.mode & 0o100).not.toBe(0);
  });

  test("scripts/status accepts --logs flag (presence in source)", async () => {
    const src = await fs.readFile("scripts/status", "utf8");
    expect(src).toContain("--logs");
    expect(src).toMatch(/SHOW_LOGS/);
  });

  test("scripts/status reads stack outputs (so it doesn't take a hard-coded resource name)", async () => {
    const src = await fs.readFile("scripts/status", "utf8");
    expect(src).toMatch(/cloudformation describe-stacks/);
    expect(src).toMatch(/TableName/);
  });

  test("scripts/clear-uploads requires the 'delete all' confirmation phrase before destruction", async () => {
    const src = await fs.readFile("scripts/clear-uploads", "utf8");
    expect(src).toContain("delete all");
  });

  test("scripts/clear-uploads is executable", async () => {
    const stat = await fs.stat("scripts/clear-uploads");
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o100).not.toBe(0);
  });

  test.skip(
    "Run status.sh directly without specifying a path: requires direnv-managed PATH; environmental, not source-level",
    () => {},
  );
  test.skip(
    "View all upload records in a formatted table: requires deployed AWS DynamoDB to populate the table",
    () => {},
  );
});
