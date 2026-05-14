import { describe, expect, test } from "vitest";
import { networkError, uploadFailed, VibeError } from "../../src/utils/errors.js";

/**
 * Feature 10: CLI errors should expose enough context for the user (and a
 * developer reading the user's report) to diagnose what failed.
 */
describe("Feature: CLI Error Observability", () => {
  test("Errors carry a `cause` chain so --verbose can surface the root cause", () => {
    const root = new Error("ECONNREFUSED 127.0.0.1:80");
    const e = networkError(root);
    expect(e).toBeInstanceOf(VibeError);
    expect((e as Error & { cause?: unknown }).cause).toBe(root);
  });

  test("uploadFailed preserves cause for --verbose to dump", () => {
    const root = new Error("HTTP 503 from /confirm");
    const e = uploadFailed("confirm", root);
    expect((e as Error & { cause?: unknown }).cause).toBe(root);
    expect(e.userMessage).toContain("confirm");
  });

  test.skip(
    "Developer notified automatically when CLI fails: telemetry endpoint is not implemented in this codebase",
    () => {},
  );
  test.skip(
    "Trace full request journey using correlation ID: correlation ID generation/threading not yet in src/upload/upload.ts",
    () => {},
  );
  test.skip(
    "Reconstruct context from local diagnostic log file: diagnostic-log writer not yet in src/",
    () => {},
  );
});
