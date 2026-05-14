/**
 * All scenarios in this feature are browser-level UI behavior.
 * Real assertions live in tests/playwright/18-internal-email-management.spec.ts.
 * The test.skip stubs below keep the BDD scenario list exhaustive in vitest.
 */
import { describe, test } from "vitest";

describe("Feature: Internal Email Management", () => {
  test.skip("View main table with internal emails hidden by default: see playwright spec");
  test.skip("Show internal emails by checking the toggle: see playwright spec");
  test.skip("Mark a user's email as internal from the main table row: see playwright spec");
  test.skip("Add an email to the internal list via the dedicated management page: see playwright spec");
});
