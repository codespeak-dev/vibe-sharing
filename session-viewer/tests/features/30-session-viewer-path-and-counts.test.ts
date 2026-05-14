import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Feature 30 covers correctness invariants for the session viewer:
 *  - Session count must match what's actually in the session file.
 *  - The session entries API must return the entries themselves so that
 *    "No messages found" is never shown for a session that has messages.
 *
 * The Next.js route handler reads a `CLAUDE_PROJECTS_DIR` constant baked at
 * module load. We mock it to point at a per-suite temp directory so the
 * route reads our fixtures instead of the developer's real ~/.claude.
 */

const FIXTURE_ROOT = path.join(
  os.tmpdir(),
  `viewer-claude-${process.pid}-${Date.now()}`,
);

// Replace CLAUDE_PROJECTS_DIR + CLAUDE_DIR everywhere the route + metadata
// modules look. cache-db.ts joins CLAUDE_DIR with the cache filename, so
// providing both keeps the cache scoped under our temp directory.
vi.mock("codespeak-vibe-share/config", () => ({
  CLAUDE_DIR: FIXTURE_ROOT,
  CLAUDE_PROJECTS_DIR: FIXTURE_ROOT,
}));

beforeAll(async () => {
  await fs.mkdir(FIXTURE_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs.rm(FIXTURE_ROOT, { recursive: true, force: true }).catch(() => {});
});

async function writeSession(opts: {
  projectPath: string;
  sessionId: string;
  lines: object[];
}): Promise<void> {
  // Encode same way as src/utils/paths.ts: replace "/" with "-".
  const encoded = opts.projectPath.replace(/\//g, "-");
  const sessionDir = path.join(FIXTURE_ROOT, encoded);
  await fs.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, `${opts.sessionId}.jsonl`);
  await fs.writeFile(
    file,
    opts.lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

function makeRequest(searchParams: Record<string, string>): unknown {
  const url = new URL("http://localhost/api/session-entries");
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  return { nextUrl: url };
}

describe("Feature: Session Viewer — Project Path Display and Session Count Accuracy", () => {
  test("Opening a session displays its messages: API returns the parsed entries (count matches the file)", async () => {
    const { GET } = await import(
      "../../src/app/api/session-entries/route.js"
    );
    const projectPath = "/Users/test/proj-30";
    const sessionId = "30303030-3030-3030-3030-303030303030";
    await writeSession({
      projectPath,
      sessionId,
      lines: [
        { type: "user", message: { content: [{ type: "text", text: "msg 1" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "reply" }] } },
        { type: "user", message: { content: [{ type: "text", text: "msg 2" }] } },
      ],
    });

    const projectPathBase64 = Buffer.from(projectPath).toString("base64url");
    const res = await GET(
      makeRequest({
        sessionId,
        projectPath: projectPathBase64,
        offset: "0",
        limit: "100",
      }) as never,
    );
    const body = await res.json();
    expect(body.entries.length).toBe(3);
    expect(body.total).toBe(3);
    expect(body.hasMore).toBe(false);
    expect(body.entries.map((e: { type: string }) => e.type)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  test("Session count in tab label matches session list count: API total reflects line count", async () => {
    const { GET } = await import(
      "../../src/app/api/session-entries/route.js"
    );
    const projectPath = "/Users/test/proj-count";
    const sessionId = "ababcdcd-abab-cdcd-abab-cdcdcdcdcdcd";
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: 7 }, (_, i) => ({
        type: "user",
        message: { content: [{ type: "text", text: "p" + i }] },
      })),
    });

    const res = await GET(
      makeRequest({
        sessionId,
        projectPath: Buffer.from(projectPath).toString("base64url"),
      }) as never,
    );
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(body.entries.length).toBe(7);
  });

  test("Pagination via offset/limit returns the right slice and hasMore flag", async () => {
    const { GET } = await import(
      "../../src/app/api/session-entries/route.js"
    );
    const projectPath = "/Users/test/proj-paginate";
    const sessionId = "12345678-1234-1234-1234-123456789012";
    await writeSession({
      projectPath,
      sessionId,
      lines: Array.from({ length: 25 }, (_, i) => ({
        type: "user",
        message: { content: [{ type: "text", text: `msg-${i}` }] },
      })),
    });

    const projectPathBase64 = Buffer.from(projectPath).toString("base64url");
    const page1 = await (
      await GET(
        makeRequest({
          sessionId,
          projectPath: projectPathBase64,
          offset: "0",
          limit: "10",
        }) as never,
      )
    ).json();
    expect(page1.entries.length).toBe(10);
    expect(page1.total).toBe(25);
    expect(page1.hasMore).toBe(true);

    const page3 = await (
      await GET(
        makeRequest({
          sessionId,
          projectPath: projectPathBase64,
          offset: "20",
          limit: "10",
        }) as never,
      )
    ).json();
    expect(page3.entries.length).toBe(5);
    expect(page3.hasMore).toBe(false);
  });

  test("Missing session returns 404 (not 200 with empty entries)", async () => {
    const { GET } = await import(
      "../../src/app/api/session-entries/route.js"
    );
    const res = await GET(
      makeRequest({
        sessionId: "00000000-0000-0000-0000-000000000000",
        projectPath: Buffer.from("/Users/test/no-such-project").toString(
          "base64url",
        ),
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  test("400 when sessionId or projectPath is missing", async () => {
    const { GET } = await import(
      "../../src/app/api/session-entries/route.js"
    );
    const res = await GET(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  test.skip(
    "Project path visible at top of review screen at all times: rendered by SessionListPage; visual contract",
    () => {},
  );
  test.skip(
    "Cursor sessions appear in the session list: requires real Cursor SQLite data; see 28",
    () => {},
  );
});
