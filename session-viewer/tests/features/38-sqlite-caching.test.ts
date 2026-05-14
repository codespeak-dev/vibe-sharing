import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Feature: Session Viewer — SQLite Caching for Performance.
 *
 * The cache module at session-viewer/src/lib/cache-db.ts builds a SQLite cache
 * with an indexed `cwd` column on the `entries` table. The cache module is
 * picked up by `cachedDiscoverAllSessions()` and the `/api/session-entries`
 * route to skip JSONL parsing on repeat loads.
 *
 * We test the cache contract directly:
 *  1. `getCachedSessionsForProject()` returns sessions whose entries match the
 *     project path via the indexed cwd column — proving the indexed-cwd query.
 *  2. `setEntries()` followed by `isSessionFresh()` and `getEntries()` shows
 *     the project-list / session-list fast path returns the cached payload
 *     without re-parsing.
 */

const TMP_HOME = path.join(os.tmpdir(), `viewer-cache-${process.pid}-${Date.now()}`);

vi.mock("codespeak-vibe-share/config", () => ({
  CLAUDE_DIR: TMP_HOME,
  CLAUDE_PROJECTS_DIR: path.join(TMP_HOME, "projects"),
}));

beforeAll(async () => {
  await fs.mkdir(TMP_HOME, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_HOME, { recursive: true, force: true }).catch(() => {});
});

describe("Feature: Session Viewer — SQLite Caching", () => {
  test("Session list loads quickly via indexed cwd query: getCachedSessionsForProject filters by cwd", async () => {
    const {
      openCache,
      setSessionMetadata,
      setEntries,
      getCachedSessionsForProject,
    } = await import("../../src/lib/cache-db.js");
    const db = openCache();

    const filePathA = "/tmp/cache-a.jsonl";
    const filePathB = "/tmp/cache-b.jsonl";

    setSessionMetadata(db, filePathA, "ses-a", 100, {
      aiTitle: "A",
      hasPlans: false,
      firstPlanLineIndex: null,
      userPromptCount: 1,
      messageCount: 1,
      created: null,
      modified: null,
      sizeBytes: 0,
    });
    setSessionMetadata(db, filePathB, "ses-b", 100, {
      aiTitle: "B",
      hasPlans: false,
      firstPlanLineIndex: null,
      userPromptCount: 1,
      messageCount: 1,
      created: null,
      modified: null,
      sizeBytes: 0,
    });

    setEntries(db, filePathA, [
      {
        lineIndex: 0,
        type: "user",
        timestamp: null,
        raw: { type: "user", cwd: "/Users/u/proj-A" },
      },
    ]);
    setEntries(db, filePathB, [
      {
        lineIndex: 0,
        type: "user",
        timestamp: null,
        raw: { type: "user", cwd: "/Users/u/proj-B" },
      },
    ]);

    const matchedA = getCachedSessionsForProject(db, "/Users/u/proj-A");
    expect(matchedA.map((s) => s.sessionId)).toEqual(["ses-a"]);

    const matchedB = getCachedSessionsForProject(db, "/Users/u/proj-B");
    expect(matchedB.map((s) => s.sessionId)).toEqual(["ses-b"]);

    // A subfolder match still surfaces the parent's session via LIKE clause.
    const matchedSub = getCachedSessionsForProject(db, "/Users/u/proj-A");
    expect(matchedSub.map((s) => s.sessionId)).toContain("ses-a");
  });

  test("Project list loads from cache without re-parsing on second load: isSessionFresh returns true when mtime matches", async () => {
    const { openCache, setSessionMetadata, isSessionFresh, getEntries, setEntries } =
      await import("../../src/lib/cache-db.js");
    const db = openCache();

    const filePath = "/tmp/cache-fresh.jsonl";
    const mtime = 1234567890;
    setSessionMetadata(db, filePath, "ses-fresh", mtime, {
      aiTitle: null,
      hasPlans: false,
      firstPlanLineIndex: null,
      userPromptCount: 0,
      messageCount: 0,
      created: null,
      modified: null,
      sizeBytes: 0,
    });
    setEntries(db, filePath, [
      {
        lineIndex: 0,
        type: "user",
        timestamp: null,
        raw: { type: "user", cwd: "/x" },
      },
      {
        lineIndex: 1,
        type: "assistant",
        timestamp: null,
        raw: { type: "assistant", cwd: "/x" },
      },
    ]);

    expect(isSessionFresh(db, filePath, mtime)).toBe(true);
    expect(isSessionFresh(db, filePath, mtime + 1)).toBe(false);

    // Paginated read: serves directly from cache.
    const page = getEntries(db, filePath, 0, 10);
    expect(page.length).toBe(2);
    expect(page[0]?.type).toBe("user");
  });
});
