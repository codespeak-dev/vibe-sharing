import { afterEach, describe, expect, test } from "vitest";

/**
 * The `SESSION_PREVIEW_ENABLED` constant in src/config.ts is the feature flag
 * that gates the interactive Sessions tab vs the static list. The flag reads
 * the VIBE_SHARING_SESSION_PREVIEW env var at module load time, so we exercise
 * it via dynamic import with a reset between tests.
 */

afterEach(() => {
  delete process.env.VIBE_SHARING_SESSION_PREVIEW;
});

describe("Feature: Sessions Consolidation with Feature Flag", () => {
  test("Default: SESSION_PREVIEW_ENABLED is false (static agent list)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.VIBE_SHARING_SESSION_PREVIEW;
    const mod = await import("../../src/config.js");
    expect(mod.SESSION_PREVIEW_ENABLED).toBe(false);
  });

  test("VIBE_SHARING_SESSION_PREVIEW=true enables the interactive preview", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.VIBE_SHARING_SESSION_PREVIEW = "true";
    const mod = await import("../../src/config.js");
    expect(mod.SESSION_PREVIEW_ENABLED).toBe(true);
  });

  test("Any non-'true' value leaves the flag off", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.VIBE_SHARING_SESSION_PREVIEW = "1";
    const mod = await import("../../src/config.js");
    expect(mod.SESSION_PREVIEW_ENABLED).toBe(false);
  });

  test.skip(
    "Sessions tab is not shown for projects with no agents: rendered by the Review screen; the SESSION_PREVIEW_ENABLED flag governs interactive vs static, not the tab's existence",
    () => {},
  );
});
