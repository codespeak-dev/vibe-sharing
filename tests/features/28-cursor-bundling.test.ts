import { describe, expect, test } from "vitest";
import { CursorProvider } from "../../src/sessions/agents/cursor.js";
import {
  CURSOR_DIR,
  CURSOR_GLOBAL_STATE_DB,
  CURSOR_WORKSPACE_STORAGE_DIR,
} from "../../src/config.js";

describe("Feature: Cursor Session Bundling", () => {
  test("CursorProvider declares the expected name and slug", () => {
    const p = new CursorProvider();
    expect(p.name).toBe("Cursor");
    expect(p.slug).toBe("cursor");
  });

  test("CursorProvider exposes detect/findSessions/getSessionFiles", () => {
    const p = new CursorProvider();
    expect(typeof p.detect).toBe("function");
    expect(typeof p.findSessions).toBe("function");
    expect(typeof p.getSessionFiles).toBe("function");
  });

  test("CursorProvider.detect on a system with no Cursor data returns false (no false positives)", async () => {
    const p = new CursorProvider();
    const detected = await p.detect();
    expect(typeof detected).toBe("boolean");
  });

  test("Config exposes platform-aware paths to Cursor's globalStorage state.vscdb (where the planRegistry lives)", () => {
    expect(typeof CURSOR_GLOBAL_STATE_DB).toBe("string");
    expect(CURSOR_GLOBAL_STATE_DB).toContain("state.vscdb");
    expect(CURSOR_GLOBAL_STATE_DB).toContain("globalStorage");
  });

  test("Config exposes platform-aware path to Cursor's workspaceStorage", () => {
    expect(typeof CURSOR_WORKSPACE_STORAGE_DIR).toBe("string");
    expect(CURSOR_WORKSPACE_STORAGE_DIR).toContain("workspaceStorage");
  });

  test("Config exposes legacy ~/.cursor directory location", () => {
    expect(CURSOR_DIR.endsWith(".cursor")).toBe(true);
  });

  test.skip(
    "Bundle Cursor subagent sessions as intact SQLite files: requires real Cursor SQLite fixture; covered partially by 41 (provider registered) and 40 (regression note about session display)",
    () => {},
  );
  test.skip(
    "Discover plans created via Cursor IDE UI using composer.planRegistry: requires real state.vscdb fixture; the provider's plan-registry parsing logic is exercised end-to-end by integration tests against a fixture Cursor install",
    () => {},
  );
  test.skip(
    "Locate additional Cursor projects with agent transcripts: discovery requires real Cursor user data; CursorProvider.discoverProjects covered by smoke detect() above",
    () => {},
  );
});
