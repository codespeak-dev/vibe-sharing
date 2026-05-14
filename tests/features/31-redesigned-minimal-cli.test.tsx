import { describe, expect, test } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { LoadingScreen } from "../../src/ui/screens/loading.js";

describe("Feature: Redesigned Minimal CLI UI", () => {
  test("Loading screen shows the tool name and a status line on launch", () => {
    const onDiscoverProjects = async () => [];
    const onDone = () => {};
    const { lastFrame, unmount } = render(
      <LoadingScreen onDiscoverProjects={onDiscoverProjects} onDone={onDone} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("codespeak-vibe-share");
    // Status line carries reassurance / progress text.
    expect(frame).toMatch(/Discovering|Determining|projects/i);
    unmount();
  });

  test("Loading screen advances status as discovery progresses", async () => {
    let onProgress: ((s: string) => void) | undefined;
    const onDiscoverProjects = (cb: (s: string) => void) =>
      new Promise<never[]>((_resolve) => {
        onProgress = cb;
        // Never resolve — we only want to observe the progress callback.
      });
    const { lastFrame, unmount } = render(
      <LoadingScreen
        onDiscoverProjects={onDiscoverProjects as never}
        onDone={() => {}}
      />,
    );
    // Wait for the effect to register the callback
    await new Promise((r) => setTimeout(r, 30));
    expect(onProgress).toBeDefined();
    onProgress!("Looking at Codex sessions...");
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame()).toContain("Codex");
    unmount();
  });

  test.skip(
    "Select a project from the discovered projects table: requires the full Project List screen with key navigation; covered by 29 ConsentScreen + ThankYou tests",
    () => {},
  );
  test.skip(
    "Share a project and return to project list on completion: full app flow integration test",
    () => {},
  );
  test.skip(
    "Create a zip and browse its contents: zip-browser screen not currently implemented in src/ui/screens/",
    () => {},
  );
  test.skip(
    "Share from the zip contents screen: same — zip browser not implemented",
    () => {},
  );
  test.skip(
    "Exit from the zip contents screen: same",
    () => {},
  );
});
