import { chromium } from "playwright";
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR-BASED replacement for the coupled tool-result-grouping unit test.
// The old test imported `buildDisplayItems` from ../src/lib/grouping.ts and
// deep-equaled its internal DisplayItem tree (kind/groupType/summary/entries),
// so it false-fails any submission whose grouping module path, function name,
// or tree shape differs — even a correct one. This suite grades the SAME
// behaviour through the rendered DOM, importing NO internal grouping symbol.
//
// Feature under test: a tool_use entry and its matching tool_result are merged
// into ONE tool-call group summarised by the tool name, and an intervening
// light-noise `progress` entry between them does NOT break the pairing. (The
// case's diff added `progress` to LIGHT_NOISE_TYPES; pre-fix the progress
// entry split the pair into separate ungrouped cards.)
//
// Two seeded pairs, each call/result separated by a `progress` entry:
//   • an `Agent` (subagent) tool_use → group summarised by the tool name
//     ("Subagent" in the reference impl's rename of Agent), and
//   • an ordinary `Read` tool_use → group summarised "Read".
// For each pair the test asserts the tool_use card and the tool_result card
// resolve to the SAME group container summarised by the tool name, and that
// the intervening progress entry did not surface as a sibling card outside the
// group. Discrimination anchor: a build that renders the call and result as
// separate ungrouped cards (no shared group) FAILS.
//
// It drives the real Next.js app in headless Chromium against a deterministic
// seeded Claude session JSONL — architecture-independent (only the rendered
// DOM is observed).
// ──────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SV_DIR = path.resolve(__dirname, "..");

// This suite uses the harness-assigned port directly; its companion
// tool-result-grouping.browser.mjs uses assigned+5 so the two servers don't
// collide when both files run in one `node --test` invocation (both stay inside
// the arm's reserved 10-port slot — see components/infra/next_dev_port.py).
const PORT = Number(process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? 3521);
const BASE = `http://localhost:${PORT}`;

// Fixture identity. The project path need not exist on disk — the session-file
// lookup only uses encodeProjectPath(projectPath) ("/" → "-") to locate the
// JSONL dir under $HOME/.claude/projects/.
const PROJECT_PATH = "/home/fixture/tool-result-grouping-proj";
// ADAPT: these two reproduce the reference impl's path-encoding conventions, used only to
// (a) place the seeded JSONL where the submission's session-file lookup will find it, and
// (b) build the URL the submission serves the session at. Repoint each to the submission's
// own scheme if it differs:
//   - encodeProjectPath ("/" → "-"): how the on-disk $HOME/.claude/projects/<dir> name is
//     derived from the project path. If the submission encodes the projects dir differently,
//     change this so the seeded JSONL lands in the dir the submission reads.
//   - base64url of the project path: how the project path is embedded in the session URL.
//     Repoint to the submission's encoder so SESSION_URL resolves.
// Neither is the graded behaviour (that's the grouping below) — they only load the page.
const ENCODED_PROJECT_DIR = PROJECT_PATH.replace(/\//g, "-"); // encodeProjectPath
const SESSION_ID = "tool-result-grouping-session";
const URL_PROJECT = Buffer.from(PROJECT_PATH).toString("base64url");
const SESSION_URL = `${BASE}/project/${URL_PROJECT}/session/${SESSION_ID}`;

// Distinctive markers placed as tool_result *content* — rendered in the DOM only
// when the result card is expanded, so a marker's presence proves the result card
// rendered (not merely that its header exists).
const SUBAGENT_RESULT_MARKER = "SUBAGENT_RESULT_BODY_MARKER_8c41d2";
const READ_RESULT_MARKER = "READ_RESULT_BODY_MARKER_3fa097";

// Entry line indices (0-based, assignment order in fixtureLines()).
const PROMPT_1 = 0;
const SUBAGENT_CALL = 1; // assistant tool_use Agent
const SUBAGENT_PROGRESS = 2; // intervening light-noise `progress` (the case's new light-noise type)
const SUBAGENT_RESULT = 3; // user tool_result for the Agent call
const PROMPT_2 = 4; // separating user prompt — flushes the subagent collapsed group
const READ_CALL = 5; // assistant tool_use Read
const READ_PROGRESS = 6; // intervening light-noise `progress`
const READ_RESULT = 7; // user tool_result for the Read call

const T = (n) => new Date(Date.UTC(2024, 0, 1, 0, 0, n)).toISOString();

/**
 * Build the seeded session. After grouping, each tool_use + intervening progress
 * + matching tool_result becomes ONE tool-call group (the call's tool name as
 * summary), and that non-primary group sits inside a collapsed group flushed by
 * the surrounding user prompts.
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
  // A `progress` entry — the light-noise type this case's diff newly made
  // non-breaking. Top-level type "progress" (raw.type also "progress").
  const progress = (n) => ({ type: "progress", timestamp: T(n) });

  const entries = [
    userPrompt("Spawn a subagent.", 0),
    toolUse("toolu_agent", "Agent", { description: "spawn subagent", subagent_type: "explorer" }, 1),
    progress(2),
    toolResult("toolu_agent", `subagent finished. ${SUBAGENT_RESULT_MARKER}`, 3),
    userPrompt("Now read a file.", 4),
    toolUse("toolu_read", "Read", { file_path: "/home/fixture/target-3fa097.txt" }, 5),
    progress(6),
    toolResult("toolu_read", `file contents. ${READ_RESULT_MARKER}`, 7),
  ];
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ── DOM observation helpers (affordance-agnostic, fail-fast — §E.3b) ─────────

/**
 * Resolve whether the call card and result card share ONE tool-call group whose
 * summary is the tool name. We walk up from the call card and, for the SHALLOWEST
 * ancestor that also contains the result card AND exposes a group-toggle naming
 * the tool, classify that toggle's text:
 *
 *   • a TOOL-CALL group toggle summarises the group by the tool name alone
 *     (e.g. "▾ Subagent" / "▾ Read") — it carries NO list-collapse tally; whereas
 *   • a generic collapsed-wrapper toggle that merely *aggregates* the run carries a
 *     "<N> cards" count and/or "<N> other" tally alongside the tool name
 *     (e.g. "▾ 3 cards 1 Subagent, 3 other"). That wrapper exists in BOTH the
 *     grouped and the un-grouped build, so matching it would pass a broken build.
 *
 * The discriminating signal (`sharedToolGroup`) is therefore: the shallowest
 * shared-ancestor whose toggle names the tool is a tool-call-style summary (tool
 * name, no card/other tally). A build that leaves the pair ungrouped has only the
 * aggregate wrapper around the two cards — no tool-named, tally-free group — and
 * FAILS here. This observes the user-visible contract ("the two cards live in one
 * group summarised by the tool name") without pinning the container element/glyph.
 *
 * ADAPT: `#entry-<lineIndex>` is the reference impl's per-entry card DOM id
 * convention — repoint the `entry-${n}` ids if the submission anchors entries
 * differently. The summary is matched as "contains the tool name but is not an
 * aggregate <N> cards/other tally"; relax the tally exclusion only if the
 * submission's tool-call group legitimately shows a count in its own summary.
 */
function sharedGroupProbe() {
  return ([callLine, resultLine, toolName]) => {
    const visible = (el) => (el ? !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) : false);
    // A collapsed-RUN aggregate tally (vs. a per-pair tool-call summary).
    const isAggregateTally = (text) => /\d+\s*cards?/i.test(text) || /\d+\s*other/i.test(text);
    // A group toggle is a grouping control, never part of an entry card's own
    // header/body — exclude any control that lives inside an `#entry-*` card (the
    // result card header carries a "Subagent" tool badge, which would otherwise
    // falsely match as a tool-named group toggle).
    const insideEntryCard = (el) => !!(el.closest && el.closest('[id^="entry-"]'));
    const call = document.getElementById(`entry-${callLine}`);
    const result = document.getElementById(`entry-${resultLine}`);
    if (!call || !result) {
      return { callAttached: !!call, resultAttached: !!result, callVisible: visible(call), resultVisible: visible(result), sharedToolGroup: false };
    }
    // Walk up from the call card; find the shallowest ancestor that also contains
    // the result and exposes a tool-named, tally-free group toggle.
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
        // An ancestor that contains both but only has an aggregate-tally toggle is
        // the generic collapsed wrapper, not the tool-call group — walking further
        // up only finds more generic wrappers, so stop searching.
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

// ── Server lifecycle (mirrors block-visibility.mjs / tool-call-result-card-expand.mjs) ──

describe("tool_use ↔ tool_result grouping (live render) — pair merges into one tool-call group named by the tool, progress does not split it", () => {
  let browser;
  let context;
  let server;
  let tmpHome;

  before(async () => {
    // 1. Seed the fixture under a throwaway $HOME so CLAUDE_PROJECTS_DIR
    //    (= $HOME/.claude/projects) resolves to it.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "sv-trg-home-"));
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
   * Given a session contains an assistant `tool_use` whose tool name is `Agent`
   * (the subagent call) followed — with an intervening light-noise `progress`
   * entry between — by the user entry carrying its matching `tool_result`
   * When the session detail page is opened (with the call entry in the hash so
   * the enclosing collapsed group auto-expands)
   * Then the subagent tool_use card and its tool_result card resolve to the SAME
   * tool-call group container, summarised by the tool name ("Subagent")
   * And the intervening progress entry did not split the pair
   * And a build that renders them as separate ungrouped cards FAILS here.
   */
  test("T01: the subagent tool_use card and its tool_result card resolve to one shared group summarised 'Subagent', undivided by the intervening progress", async () => {
    const page = await context.newPage();
    // Open with the call entry in the hash so the (non-primary) tool-call group
    // and its enclosing collapsed group auto-expand — no affordance-specific click.
    // ADAPT: `#entry-<lineIndex>` deep-link hash is the reference impl's auto-expand
    // mechanism; if the submission reveals a grouped pair differently, repoint this
    // to its equivalent reveal (e.g. expandAll, or click its collapse affordance).
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
   * T02: Scenario: An ordinary tool call is grouped with its tool_result into one topical group
   *
   * Given a session contains an assistant `tool_use` for an ordinary tool (`Read`)
   * followed — with an intervening light-noise `progress` entry between — by its
   * matching user `tool_result`
   * When the session detail page is opened (with the call entry in the hash)
   * Then the tool_use card and the tool_result card resolve to the SAME tool-call
   * group container, summarised by the tool name ("Read"), with the progress not
   * splitting them — a build rendering them ungrouped FAILS.
   */
  test("T02: an ordinary Read tool_use card and its tool_result card resolve to one shared group summarised 'Read', undivided by the intervening progress", async () => {
    const page = await context.newPage();
    await page.goto(`${SESSION_URL}#entry-${READ_CALL}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`#entry-${READ_RESULT}`).waitFor({ state: "attached", timeout: 20_000 });

    const r = await page.evaluate(sharedGroupProbe(), [READ_CALL, READ_RESULT, "Read"]);

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
   * T03 (DISCRIMINATION): the intervening progress entry is INSIDE the group, not
   * a sibling card flanking it.
   *
   * Re-states the crux of the case's diff (progress is light-noise, so it does not
   * break the pair) as a standalone observable: when the subagent pair's group is
   * revealed, the result card body marker is visible WITHOUT separately expanding
   * the result card — i.e. the result genuinely lives in the (revealed) group and
   * is shown — and the progress entry between them did not appear as a standalone
   * primary card outside any group at the page's top level. A build where progress
   * split the pair leaves the result as a separate, still-collapsed card whose
   * body marker is absent here.
   */
  test("T03: with the subagent group revealed, the result body marker is shown (result lives in the group) and progress did not surface as a top-level standalone card", async () => {
    const page = await context.newPage();
    await page.goto(`${SESSION_URL}#entry-${SUBAGENT_CALL}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`#entry-${SUBAGENT_RESULT}`).waitFor({ state: "attached", timeout: 20_000 });

    const resultMarkerShown = (await page.locator(`text=${SUBAGENT_RESULT_MARKER}`).count()) > 0;

    // The intervening progress entry shares the SAME tool-named (tally-free) group
    // as the call — it didn't split the pair into separate ungrouped cards. We find
    // the call's tool-call group (shallowest ancestor whose toggle names the tool
    // and is NOT an aggregate "<N> cards/other" wrapper) and require it to contain
    // the progress entry too (or the progress to be folded into that group's body,
    // i.e. not rendered as its own card at all).
    const progressInsideGroup = await page.evaluate(([callLine, progressLine, toolName]) => {
      const isAggregateTally = (text) => /\d+\s*cards?/i.test(text) || /\d+\s*other/i.test(text);
      const insideEntryCard = (el) => !!(el.closest && el.closest('[id^="entry-"]'));
      const call = document.getElementById(`entry-${callLine}`);
      const prog = document.getElementById(`entry-${progressLine}`);
      if (!call) return false;
      let toolGroup = null;
      let cur = call.parentElement;
      while (cur) {
        const controls = Array.from(cur.querySelectorAll("button, [role='button'], .cursor-pointer")).filter(
          (c) => !insideEntryCard(c),
        );
        const toggle = controls.find((c) => {
          const txt = (c.textContent ?? "").trim();
          return txt.includes(toolName) && !isAggregateTally(txt);
        });
        if (toggle) {
          toolGroup = cur;
          break;
        }
        cur = cur.parentElement;
      }
      if (!toolGroup) return false;
      // Progress folded into the group's body (no own card) is acceptable; if it
      // has a card, that card must live inside the same tool-call group.
      return !prog || toolGroup.contains(prog);
    }, [SUBAGENT_CALL, SUBAGENT_PROGRESS, "Subagent"]);

    await page.close();

    assert.deepEqual(
      { resultMarkerShown, progressInsideGroup },
      { resultMarkerShown: true, progressInsideGroup: true },
    );
  });
});
