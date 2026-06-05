import { chromium } from "playwright";
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────────────────────────────────
// Live-render (Playwright) tests for the subagent tool_use ↔ tool_result
// topical grouping introduced by this case's diff (the `Agent` call is paired
// with its tool_result into one tool-call group rendered by the session viewer;
// pre-fix it fell through to a standalone card with no enclosing group).
//
// Previously this suite pinned a NON-REPRODUCIBLE fixture: a developer's
// absolute machine path + a fixed real session UUID, served by a dev server
// assumed to already hold that session in its SQLite cache. None of that exists
// in the grading environment. It now SEEDS its own deterministic session JSONL
// under a throwaway $HOME and spawns the Next.js server itself — self-contained,
// mirroring tests/block-visibility.mjs and tests/tool-call-result-card-expand.mjs.
// The behavioural assertions are preserved (the pair shares one group summarised
// by the tool name; expand reveals both cards; collapse drops the result).
// ──────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SV_DIR = path.resolve(__dirname, "..");

// This suite and tool-result-grouping.unit.mjs each spawn their OWN Next.js dev
// server and may run in the SAME `node --test` invocation, so they must not share
// a port. The harness assigns each case+arm a 10-port slot
// (components/infra/next_dev_port.py: PORT_BASE + case_index*ARM_STRIDE, arms at
// +0/+1); unit.mjs uses the assigned port, this file uses assigned+5 — still
// inside the arm's reserved 10-port window and distinct from the other arm's slot.
const PORT = Number(process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? 3522) + 5;
const BASE = `http://localhost:${PORT}`;

// Fixture identity. The project path need not exist on disk — the session-file
// lookup only uses encodeProjectPath(projectPath) ("/" → "-") to locate the
// JSONL dir under $HOME/.claude/projects/.
const PROJECT_PATH = "/home/fixture/subagent-grouping-proj";
// ADAPT: these two reproduce the reference impl's path-encoding conventions, used only to
// (a) place the seeded JSONL where the submission's session-file lookup will find it, and
// (b) build the URL the submission serves the session at. Repoint each to the submission's
// own scheme if it differs (encodeProjectPath "/" → "-" for the on-disk dir; base64url of
// the project path for the URL). Neither is the graded behaviour.
const ENCODED_PROJECT_DIR = PROJECT_PATH.replace(/\//g, "-"); // encodeProjectPath
const SESSION_ID = "subagent-grouping-session";
const URL_PROJECT = Buffer.from(PROJECT_PATH).toString("base64url");
const SESSION_URL = `${BASE}/project/${URL_PROJECT}/session/${SESSION_ID}`;

// Distinctive marker placed as the subagent tool_result content — rendered only
// when the result card is expanded, so "marker present" ⟺ "result card expanded".
const SUBAGENT_RESULT_MARKER = "SUBAGENT_RESULT_BODY_MARKER_b71e30";

// Entry line indices (0-based, assignment order in fixtureLines()).
const PROMPT = 0;
const SUBAGENT_CALL = 1; // assistant tool_use Agent
const SUBAGENT_RESULT = 2; // user tool_result matching the Agent call

const T = (n) => new Date(Date.UTC(2024, 0, 1, 0, 0, n)).toISOString();

/**
 * Seed a session whose Agent tool_use is immediately followed by its matching
 * tool_result. After grouping these two merge into ONE tool-call group named by
 * the tool ("Subagent"), nested in a collapsed group flushed by the user prompts.
 */
function fixtureLines() {
  const userPrompt = (text, n) => ({
    type: "user",
    timestamp: T(n),
    message: { role: "user", content: [{ type: "text", text }] },
  });
  const toolUse = (id, name, input, n) => ({
    type: "assistant",
    timestamp: T(n),
    message: {
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
  const toolResult = (id, content, n) => ({
    type: "user",
    timestamp: T(n),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
  });

  const entries = [
    userPrompt("Spawn a subagent to do the work.", 0),
    toolUse("toolu_agent", "Agent", { description: "spawn subagent", subagent_type: "explorer" }, 1),
    toolResult("toolu_agent", `subagent finished. ${SUBAGENT_RESULT_MARKER}`, 2),
  ];
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ── DOM helpers (affordance-agnostic, fail-fast — §E.3b) ─────────────────────

/**
 * Resolve whether the call card and result card share ONE tool-call group whose
 * summary is the tool name. Walk up from the call card to the SHALLOWEST ancestor
 * that also contains the result and exposes a group toggle naming the tool, then
 * classify that toggle: a TOOL-CALL group summarises by the tool name alone
 * ("▾ Subagent"), whereas the generic collapsed-RUN wrapper that aggregates the
 * pair carries a "<N> cards"/"<N> other" tally alongside the tool name
 * ("▾ 3 cards 1 Subagent, 3 other") and exists in BOTH the grouped and un-grouped
 * builds. So `sharedToolGroup` requires a tool-named, tally-free group — a build
 * that leaves the pair ungrouped has only the aggregate wrapper and FAILS.
 *
 * ADAPT: `#entry-<lineIndex>` is the reference impl's per-entry card DOM id
 * convention; the group toggle text contains the prescribed tool-name summary
 * ("Subagent" for an Agent call) and is matched as "names the tool but is not an
 * aggregate <N> cards/other tally". Repoint the ids / relax these if the
 * submission anchors entries or labels its tool-call group differently.
 */
function sharedGroupProbe() {
  return ([callLine, resultLine, toolName]) => {
    const visible = (el) => (el ? !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) : false);
    const isAggregateTally = (text) => /\d+\s*cards?/i.test(text) || /\d+\s*other/i.test(text);
    // A group toggle is never part of an entry card's own header/body — exclude
    // controls inside an `#entry-*` card (the result card header carries a tool
    // badge that would otherwise falsely match as a tool-named group toggle).
    const insideEntryCard = (el) => !!(el.closest && el.closest('[id^="entry-"]'));
    const call = document.getElementById(`entry-${callLine}`);
    const result = document.getElementById(`entry-${resultLine}`);
    if (!call || !result) {
      return { callAttached: !!call, resultAttached: !!result, callVisible: visible(call), resultVisible: visible(result), sharedToolGroup: false };
    }
    let sharedToolGroup = false;
    let cur = call.parentElement;
    while (cur) {
      if (cur.contains(result)) {
        const controls = Array.from(cur.querySelectorAll("button, [role='button'], .cursor-pointer")).filter(
          (c) => !insideEntryCard(c),
        );
        const toggle = controls.find((c) => {
          const txt = (c.textContent ?? "").trim();
          return txt.includes(toolName) && !isAggregateTally(txt);
        });
        if (toggle) {
          sharedToolGroup = true;
          break;
        }
        const aggregateOnly = controls.some((c) => isAggregateTally((c.textContent ?? "").trim()));
        if (aggregateOnly) break;
      }
      cur = cur.parentElement;
    }
    return {
      callAttached: true,
      resultAttached: true,
      callVisible: visible(call),
      resultVisible: visible(result),
      sharedToolGroup,
    };
  };
}

// ── Server lifecycle (mirrors block-visibility.mjs) ──────────────────────────

describe("subagent tool_use ↔ tool_result topical grouping (live render, seeded fixture)", () => {
  let browser;
  let context;
  let server;
  let tmpHome;

  before(async () => {
    // 1. Seed the fixture under a throwaway $HOME so CLAUDE_PROJECTS_DIR
    //    (= $HOME/.claude/projects) resolves to it.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "sv-sag-home-"));
    const projDir = path.join(tmpHome, ".claude", "projects", ENCODED_PROJECT_DIR);
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, `${SESSION_ID}.jsonl`), fixtureLines(), "utf-8");

    // 2. Start the precompiled Next.js server (`next start`) with the throwaway HOME.
    // `next start` serves the prebuilt `.next` (built in setup_commands) with no per-request
    // compile, so the server-ready poll resolves in seconds instead of racing a cold Turbopack
    // compile that, under a saturated eval box, blows the 180s deadline and cancels the suite.
    server = spawn(
      path.join(SV_DIR, "node_modules", ".bin", "next"),
      ["start", "-p", String(PORT)],
      {
        cwd: SV_DIR,
        env: { ...process.env, HOME: tmpHome, PORT: String(PORT) },
        detached: true,
        stdio: "ignore",
      },
    );

    // 3. Wait until the seeded session page is served (dev compiles on demand).
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(SESSION_URL, { method: "GET" });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        /* server not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, "Next.js dev server did not become ready in time");

    browser = await chromium.launch();
    context = await browser.newContext();
  });

  after(async () => {
    await browser?.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    if (tmpHome) {
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  /*
   * T01: Scenario: Subagent tool call is grouped with its tool_result into one topical group
   *
   * Given a session contains an assistant `Agent` tool_use immediately followed
   * by the user entry carrying its matching tool_result
   * When the session detail page is opened (with the call entry in the hash so the
   * enclosing collapsed group and its tool-call group auto-expand)
   * Then the subagent tool_use card and its tool_result card resolve to the SAME
   * tool-call group container, summarised by the tool name ("Subagent")
   * And before the fix this fails — the subagent call renders as a standalone card
   * with no enclosing group.
   */
  test("T01: the subagent tool_use card and its tool_result card resolve to the same group summarised 'Subagent'", async () => {
    const page = await context.newPage();
    // ADAPT: `#entry-<lineIndex>` deep-link hash auto-expands the enclosing groups
    // in the reference impl; repoint to the submission's reveal mechanism if it differs.
    await page.goto(`${SESSION_URL}#entry-${SUBAGENT_CALL}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`#entry-${SUBAGENT_RESULT}`).waitFor({ state: "attached", timeout: 20_000 });

    const r = await page.evaluate(sharedGroupProbe(), [SUBAGENT_CALL, SUBAGENT_RESULT, "Subagent"]);

    assert.deepEqual(
      r,
      {
        callAttached: true,
        resultAttached: true,
        callVisible: true,
        resultVisible: true,
        sharedToolGroup: true,
      },
    );

    await page.close();
  });

  /*
   * T03: Scenario: Expanding the grouped pair reveals both the tool_use card and the tool_result card
   *
   * Given the subagent tool_use and its tool_result are grouped into one tool-call
   * group (per T01)
   * When the group is revealed (the call entry is in the hash so it auto-expands)
   * Then both the tool_use card and the tool_result card are present and visible,
   * and the result card's body marker is shown — neither card is lost.
   * And collapsing the group via its tool-named toggle drops the (non-primary)
   * tool_result card while keeping the primary tool_use card.
   */
  test("T03: revealing the group shows BOTH cards (result body marker visible); collapsing it drops the result card but keeps the call card", async () => {
    const page = await context.newPage();
    await page.goto(`${SESSION_URL}#entry-${SUBAGENT_CALL}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`#entry-${SUBAGENT_RESULT}`).waitFor({ state: "attached", timeout: 20_000 });

    // Revealed state: both cards present + visible, result body marker shown.
    const revealed = await page.evaluate(([callLine, resultLine, marker]) => {
      const visible = (el) => (el ? !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) : false);
      const call = document.getElementById(`entry-${callLine}`);
      const result = document.getElementById(`entry-${resultLine}`);
      return {
        callAttached: !!call,
        resultAttached: !!result,
        callVisible: visible(call),
        resultVisible: visible(result),
        resultMarkerShown: (document.body.textContent ?? "").includes(marker),
      };
    }, [SUBAGENT_CALL, SUBAGENT_RESULT, SUBAGENT_RESULT_MARKER]);

    assert.deepEqual(
      revealed,
      { callAttached: true, resultAttached: true, callVisible: true, resultVisible: true, resultMarkerShown: true },
    );

    // Collapse the tool-call group via its tool-named toggle. Found generically:
    // the shallowest ancestor of both cards whose toggle names the tool and is NOT
    // an aggregate "<N> cards/other" wrapper (that distinguishes the per-pair
    // tool-call group from the collapsed-run wrapper above it). Fail-fast: bounded
    // click, no 30s affordance hang (§E.3b).
    // ADAPT: the collapse toggle is matched by "control whose text contains the
    // tool name 'Subagent', outside the entry cards, and not an aggregate tally" —
    // repoint if the submission labels its tool-call group's toggle differently.
    const toggleHandle = await page.evaluateHandle(([callLine, resultLine, toolName]) => {
      const isAggregateTally = (text) => /\d+\s*cards?/i.test(text) || /\d+\s*other/i.test(text);
      const insideEntryCard = (el) => !!(el.closest && el.closest('[id^="entry-"]'));
      const call = document.getElementById(`entry-${callLine}`);
      const result = document.getElementById(`entry-${resultLine}`);
      if (!call) return null;
      let cur = call.parentElement;
      while (cur) {
        if (result && cur.contains(result)) {
          const controls = Array.from(cur.querySelectorAll("button, [role='button'], .cursor-pointer")).filter(
            (c) => !insideEntryCard(c),
          );
          const toggle = controls.find((c) => {
            const txt = (c.textContent ?? "").trim();
            return txt.includes(toolName) && !isAggregateTally(txt);
          });
          if (toggle) return toggle;
        }
        cur = cur.parentElement;
      }
      return null;
    }, [SUBAGENT_CALL, SUBAGENT_RESULT, "Subagent"]);

    const toggleEl = toggleHandle.asElement();
    assert.ok(toggleEl, "the revealed group must expose a tool-named toggle to collapse it");
    await toggleEl.click({ timeout: 3000 });
    await page.locator(`#entry-${SUBAGENT_RESULT}`).waitFor({ state: "detached", timeout: 10_000 });

    const collapsed = await page.evaluate(([callLine, resultLine]) => {
      return {
        callAttached: !!document.getElementById(`entry-${callLine}`),
        resultAttached: !!document.getElementById(`entry-${resultLine}`),
      };
    }, [SUBAGENT_CALL, SUBAGENT_RESULT]);

    await page.close();

    assert.deepEqual(
      collapsed,
      { callAttached: true, resultAttached: false },
    );
  });
});
