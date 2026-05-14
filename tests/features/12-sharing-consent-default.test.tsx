import { describe, expect, test } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { ConsentScreen } from "../../src/ui/screens/consent.js";

describe("Feature: Sharing Consent Default", () => {
  test("Sharing consent prompt: pressing Enter without input accepts sharing (Enter is the default action)", () => {
    let confirmed = false;
    const { stdin, lastFrame, unmount } = render(
      <ConsentScreen
        projectPath="/tmp/proj"
        onConfirm={() => {
          confirmed = true;
        }}
        onBack={() => {}}
      />,
    );

    // The screen advertises Enter as the primary (highlighted) action.
    expect(lastFrame()).toMatch(/Enter/);
    expect(lastFrame()).toMatch(/share/i);

    // Pressing Enter immediately calls onConfirm (no further input required).
    stdin.write("\r");
    expect(confirmed).toBe(true);

    unmount();
  });
});
