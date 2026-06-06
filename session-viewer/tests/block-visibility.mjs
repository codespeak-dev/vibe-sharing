import { chromium } from "playwright";
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR-BASED replacement for the coupled grouping.test.ts unit test of the
// "block visibility" feature. The old test deep-equals buildDisplayItems' internal
// display-tree shape, so it false-fails any submission whose grouping architecture
// differs (or merely names its module something other than ./grouping). This suite
// instead grades the SAME behaviour through the rendered DOM:
//
//   • High-signal entries (user prompt, AskUserQuestion, the USER ANSWER to it,
//     the ExitPlanMode answer, a plan-file tool_use, a trailing completion report)
//     must be VISIBLE and EXPANDED (body shown) by default — present in the DOM AND
//     showing their body content WITHOUT any click.
//   • A run of >=2 plain tool_use/tool_result entries between user prompts must
//     COLLAPSE behind exactly one "··· … ···" group — those entries' cards must
//     NOT be in the DOM until the group is expanded.
//
// It drives the real Next.js app in headless Chromium against a deterministic
// seeded Claude session JSONL. It imports NO internal grouping symbol — only the
// rendered DOM is observed, so it is architecture-independent.
// ──────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SV_DIR = path.resolve(__dirname, "..");

const PORT = Number(process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? 3519);
const BASE = `http://localhost:${PORT}`;

// Fixture identity. The project path need not exist on disk — findSessionFile only
// uses encodeProjectPath(projectPath) ("/" → "-") to locate the JSONL dir under
// $HOME/.claude/projects/.
const PROJECT_PATH = "/home/fixture/block-visibility-proj";
// ADAPT: these two reproduce the reference impl's path-encoding conventions, used only to
// (a) place the seeded JSONL where the submission's session-file lookup will find it, and
// (b) build the URL the submission serves the session at. Repoint each to the submission's
// own scheme if it differs:
//   - encodeProjectPath ("/" → "-"): how the on-disk $HOME/.claude/projects/<dir> name is
//     derived from the project path. If the submission encodes the projects dir differently,
//     change this so the seeded JSONL lands in the dir the submission reads.
//   - base64url of the project path: how the project path is embedded in the session URL.
//     Repoint to the submission's encoder so SESSION_URL resolves.
// Neither is the graded behaviour (that's visibility/expansion below) — they only load the page.
const ENCODED_PROJECT_DIR = PROJECT_PATH.replace(/\//g, "-"); // encodeProjectPath
const SESSION_ID = "block-visibility-session";
const URL_PROJECT = Buffer.from(PROJECT_PATH).toString("base64url");
const SESSION_URL = `${BASE}/project/${URL_PROJECT}/session/${SESSION_ID}`;

// Distinctive marker text placed in the high-signal entries' rendered content. A marker
// appears in the DOM only when the entry's card is EXPANDED (its body section rendered) —
// never in the collapsed header — so "marker present" ⟺ "card expanded", not merely present.
const PROMPT_MARKER = "USER_PROMPT_BODY_MARKER_9a31fb";
const ANSWER_MARKER = "ASK_ANSWER_BODY_MARKER_d8b517"; // THE CRUX — the user's answer to AskUserQuestion
const EXIT_PLAN_ANSWER_MARKER = "EXITPLAN_ANSWER_BODY_MARKER_2f9a6c"; // answer to ExitPlanMode
const PLAN_MARKER = "PLAN_FILE_BODY_MARKER_71cd80"; // content of a .claude/plans/ Write tool_use
const REPORT_MARKER = "COMPLETION_REPORT_BODY_MARKER_e5a44d"; // trailing assistant text

const COLLAPSED_MARKER_1 = "COLLAPSED_TOOL_BODY_MARKER_aa1100"; // must be hidden until group expanded
const COLLAPSED_MARKER_2 = "COLLAPSED_TOOL_BODY_MARKER_bb2200";

// Entry line indices (0-based, assignment order in fixtureLines()).
const PROMPT = 0;
const ASK_QUESTION = 1; // assistant tool_use AskUserQuestion
const ASK_ANSWER = 2; // user tool_result answering it (agent-answer) — the crux
const EXIT_PLAN = 3; // assistant tool_use ExitPlanMode
const EXIT_PLAN_ANSWER = 4; // user tool_result answering ExitPlanMode (agent-answer)
const PLAN_WRITE = 5; // assistant tool_use Write to .claude/plans/
const COLLAPSED_USE_1 = 7; // first plain tool_use in the collapsed run
const COLLAPSED_RESULT_1 = 8;
const COLLAPSED_USE_2 = 9;
const COLLAPSED_RESULT_2 = 10;
const REPORT = 12; // trailing assistant text-only completion report

const T = (n) => new Date(Date.UTC(2024, 0, 1, 0, 0, n)).toISOString();

/**
 * Build the seeded session. After the reference impl's buildDisplayItems the high-signal
 * entries are primary + defaultExpanded (visible, body shown), and the run of plain
 * tool_use/tool_result entries between the two user prompts collapses into ONE group.
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
  const assistantText = (text, n) => ({
    type: "assistant",
    timestamp: T(n),
    message: { role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text }] },
  });

  const entries = [
    // 0: high-signal user prompt — visible + expanded
    userPrompt(`Please build the feature. ${PROMPT_MARKER}`, 0),
    // 1: AskUserQuestion tool_use — high-signal, visible + expanded
    toolUse("toolu_ask", "AskUserQuestion", { question: "Which option?" }, 1),
    // 2: the USER ANSWER to the AskUserQuestion (tool_result-only user entry) — THE CRUX
    toolResult("toolu_ask", `The user picked option A. ${ANSWER_MARKER}`, 2),
    // 3: ExitPlanMode tool_use
    toolUse("toolu_exit", "ExitPlanMode", { plan: "proceed with the plan" }, 3),
    // 4: the answer to ExitPlanMode (agent-answer) — visible + expanded
    toolResult("toolu_exit", `Plan approved. ${EXIT_PLAN_ANSWER_MARKER}`, 4),
    // 5: a tool_use referencing .claude/plans/ — high-signal, visible + expanded
    toolUse(
      "toolu_plan",
      "Write",
      { file_path: "/home/fixture/.claude/plans/feature-plan.md", content: `# Plan\n\n${PLAN_MARKER}` },
      5,
    ),
    // 6: a separating user prompt so the collapsed run sits BETWEEN two user prompts
    userPrompt("Now do the routine work.", 6),
    // 7-10: a run of >=2 plain tool_use/tool_result entries — must collapse into ONE group
    toolUse("toolu_bash", "Bash", { command: "echo routine-1" }, 7),
    toolResult("toolu_bash", `routine output one. ${COLLAPSED_MARKER_1}`, 8),
    toolUse("toolu_read", "Read", { file_path: "/home/fixture/routine.txt" }, 9),
    toolResult("toolu_read", `routine output two. ${COLLAPSED_MARKER_2}`, 10),
    // 11: closing user prompt that flushes the collapsed run
    userPrompt("Wrap it up.", 11),
    // 12: trailing assistant text-only completion report — visible + expanded
    assistantText(`All done. ${REPORT_MARKER}`, 12),
  ];
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ── DOM observation helpers ────────────────────────────────────────────────

/**
 * Capture the observable state of a single EntryCard (`#entry-<lineIndex>`):
 *   - present: whether the card element is in the DOM at all
 *   - hasBody: whether the card's body section is rendered (i.e. the card is EXPANDED)
 *   - bodyText: the body's text content ("" when no body)
 * Card markup (entry-card.tsx): <div id=entry-N><div header/>{showBody && <div body/>}</div>
 *
 * ADAPT: "#entry-<lineIndex>" is the reference impl's per-entry DOM id convention, and the
 * card's two-child markup (header = first child div, body = second child div) is its card
 * structure. The GRADED signal is `hasBody` / `bodyText.includes(MARKER)` — "is the entry's
 * body actually rendered/visible" — which is convention-independent. If the submission anchors
 * entries by a different scheme or structures the card differently, repoint the `#entry-N`
 * locator and the `xpath=./div[2]` body selector to the submission's per-entry element / body.
 */
async function cardState(page, lineIndex) {
  const card = page.locator(`#entry-${lineIndex}`);
  const present = (await card.count()) > 0;
  if (!present) return { present, hasBody: false, bodyText: "" };
  const body = card.locator("xpath=./div[2]");
  const hasBody = (await body.count()) > 0;
  const bodyText = hasBody ? ((await body.textContent()) ?? "") : "";
  return { present, hasBody, bodyText };
}

// ── Server lifecycle (mirrors tool-call-result-card-expand.mjs) ─────────────

describe("block visibility — high-signal entries visible+expanded; low-signal runs collapsed", () => {
  let browser;
  let context;
  let server;
  let tmpHome;

  before(async () => {
    // 1. Seed the fixture under a throwaway $HOME so CLAUDE_PROJECTS_DIR
    //    (= $HOME/.claude/projects) resolves to it.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "sv-bv-home-"));
    const projDir = path.join(tmpHome, ".claude", "projects", ENCODED_PROJECT_DIR);
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, `${SESSION_ID}.jsonl`), fixtureLines(), "utf-8");

    // 2. Start the Next.js dev server with the throwaway HOME.
    server = spawn(
      path.join(SV_DIR, "node_modules", ".bin", "next"),
      ["dev", "-p", String(PORT)],
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
   * T01: High-signal entries are visible AND expanded (body shown) by default (no interaction).
   *
   * Each high-signal entry must (a) have its card in the DOM and (b) be EXPANDED (body section
   * rendered). For the entries whose rendered body shows their content inline (user prompt, the
   * AskUserQuestion ANSWER, the ExitPlanMode answer, the plan-file write, the trailing report),
   * expansion is further proven by the distinctive marker being present in the DOM with no click.
   *
   * The AskUserQuestion REQUEST (#entry-1) is graded as visible+expanded (present && body rendered)
   * rather than by a body marker: the reference impl renders a tool_use's raw input behind an
   * inner toggle, so the question's input text is not auto-shown even though the card is expanded.
   * The crux signal (the user's ANSWER being visible) is graded by its marker below and in T02.
   */
  test("user prompt, AskUserQuestion request, its answer, ExitPlanMode answer, plan-file tool_use, and trailing report are all visible+expanded", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    const prompt = await cardState(page, PROMPT);
    const question = await cardState(page, ASK_QUESTION);
    const answer = await cardState(page, ASK_ANSWER);
    const exitPlanAnswer = await cardState(page, EXIT_PLAN_ANSWER);
    const planWrite = await cardState(page, PLAN_WRITE);
    const report = await cardState(page, REPORT);

    assert.deepEqual(
      {
        prompt: { present: prompt.present, hasBody: prompt.hasBody, showsMarker: prompt.bodyText.includes(PROMPT_MARKER) },
        question: { present: question.present, hasBody: question.hasBody },
        answer: { present: answer.present, hasBody: answer.hasBody, showsMarker: answer.bodyText.includes(ANSWER_MARKER) },
        exitPlanAnswer: { present: exitPlanAnswer.present, hasBody: exitPlanAnswer.hasBody, showsMarker: exitPlanAnswer.bodyText.includes(EXIT_PLAN_ANSWER_MARKER) },
        planWrite: { present: planWrite.present, hasBody: planWrite.hasBody, showsMarker: planWrite.bodyText.includes(PLAN_MARKER) },
        report: { present: report.present, hasBody: report.hasBody, showsMarker: report.bodyText.includes(REPORT_MARKER) },
      },
      {
        prompt: { present: true, hasBody: true, showsMarker: true },
        question: { present: true, hasBody: true },
        answer: { present: true, hasBody: true, showsMarker: true },
        exitPlanAnswer: { present: true, hasBody: true, showsMarker: true },
        planWrite: { present: true, hasBody: true, showsMarker: true },
        report: { present: true, hasBody: true, showsMarker: true },
      },
    );

    await page.close();
  });

  /*
   * T02 (DISCRIMINATION): The AskUserQuestion answer is visible WITHOUT interaction.
   *
   * This is the standalone discrimination assertion that protects against the under-faithfulness
   * the old test failed to grade correctly: a build that buries the answer inside a collapsed
   * group, or renders the answer card collapsed, must FAIL here. The assertion is strictly
   * "the answer marker is in the DOM with no click" — NOT "the answer exists somewhere".
   */
  test("the AskUserQuestion answer marker is visible in the DOM with no interaction (must fail a build that buries/collapses it)", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    const answerVisibleNoClick = await page.locator(`text=${ANSWER_MARKER}`).count();

    await page.close();
    assert.equal(answerVisibleNoClick, 1, "AskUserQuestion answer marker must be visible without any interaction");
  });

  /*
   * T03: The low-signal tool run (>=2 plain tool_use/tool_result entries between user prompts) is
   * FOLDED by default and remains REACHABLE — i.e. it doesn't take screen space on load, and there
   * is some way to expand it into view (nothing is truly hidden).
   *
   * This is intentionally AFFORDANCE-AGNOSTIC. The two graded contracts are:
   *   (1) folded-by-default — the run's cards and their body markers are NOT in the DOM on load
   *       (catches a build that over-surfaces low-signal entries as individual visible cards); and
   *   (2) reachable — clicking the page's collapse affordance(s) brings the run's cards into the DOM
   *       (catches a build that drops the entries with no way to see them).
   * It does NOT hard-match the reference impl's "··· … ···" glyph or require exactly one group, which
   * false-failed/timed-out on submissions that fold the run behind a different affordance (e.g.
   * "▶ Bash (2 blocks)") or split it. The prompt's "a SINGLE collapsed group, not many" nicety is
   * deliberately not hard-gated here, to stay robust to the submission's collapse UI.
   *
   * ADAPT: the affordance regex below recognises the reference impl's "··· <summary> ···" / "▸ …"
   * plus common alternatives (a chevron, or an "<N> messages|blocks|cards|entries" count label).
   * Repoint it if the submission labels its collapse control differently.
   */
  test("the low-signal tool run is folded by default and remains reachable (not surfaced, not truly hidden)", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    const targets = [COLLAPSED_USE_1, COLLAPSED_RESULT_1, COLLAPSED_USE_2, COLLAPSED_RESULT_2];
    const allPresent = async () => {
      const counts = await Promise.all(targets.map((i) => page.locator(`#entry-${i}`).count()));
      return counts.every((c) => c > 0);
    };
    const nonePresent = async () => {
      const counts = await Promise.all(targets.map((i) => page.locator(`#entry-${i}`).count()));
      return counts.every((c) => c === 0);
    };

    // (1) Folded by default — affordance-independent: the run's cards and markers are absent on load.
    const foldedByDefault =
      (await nonePresent()) &&
      (await page.locator(`text=${COLLAPSED_MARKER_1}`).count()) === 0 &&
      (await page.locator(`text=${COLLAPSED_MARKER_2}`).count()) === 0;

    // (2) Reachable — expand via generically-detected collapse affordances (fail-fast: each click is
    // bounded; each distinct affordance is clicked at most once so a toggle isn't re-collapsed).
    const AFFORDANCE = /···|⋯|▶|▸|▾|\b\d+\s*(message|block|entr|card|item)/i;
    const clicked = new Set();
    for (let pass = 0; pass < 6; pass++) {
      if (await allPresent()) break;
      // Snapshot the collapse-affordance labels for this pass in ONE call. allTextContents() does
      // not auto-wait, so it can't hang; iterating a live `.nth(i)` locator instead would call
      // textContent on elements that detach as earlier clicks mutate the DOM → a 30s timeout.
      let names = [];
      try {
        names = await page.getByRole("button", { name: AFFORDANCE }).allTextContents();
      } catch {
        break;
      }
      let progressed = false;
      for (const raw of names) {
        const name = (raw ?? "").trim();
        if (!name || clicked.has(name)) continue;
        clicked.add(name);
        try {
          await page.getByRole("button", { name }).first().click({ timeout: 2500 });
          progressed = true;
        } catch {
          /* affordance gone or not clickable right now */
        }
        if (await allPresent()) break;
      }
      if (!progressed) break;
    }
    const reachable = await allPresent();

    await page.close();

    assert.deepEqual(
      { foldedByDefault, reachable },
      { foldedByDefault: true, reachable: true },
    );
  });
});
