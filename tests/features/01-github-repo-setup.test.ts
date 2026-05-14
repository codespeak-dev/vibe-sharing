import { describe, test } from "vitest";

describe("Feature: GitHub Repository Setup", () => {
  test.skip(
    "Create and push repository to GitHub organisation: requires the `gh` CLI authenticated against codespeak-dev and a real GitHub API call. This is a one-shot bootstrap action, not a regression-protectable invariant.",
    () => {},
  );
});
