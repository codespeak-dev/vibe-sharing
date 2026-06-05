import { chromium } from "playwright";
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────────────────────────────────
// This suite exercises the "tool-call topical group auto-expands its result
// card" feature implemented in:
//   - session-viewer/src/lib/grouping.ts          (buildLayer2 → tool-call TopicalGroup)
//   - .../session/[sessionId]/client.tsx          (ToolCallGroupView forceExpanded={...||chunk.isLast})
//
// It drives the real Next.js app in a headless Chromium against a deterministic
// seeded Claude session JSONL, so the assertions observe the actual rendered
// DOM produced by the real forceExpanded render path (no stubs/mocks).
// ──────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SV_DIR = path.resolve(__dirname, "..");

const PORT = Number(process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? 3517);
const BASE = `http://localhost:${PORT}`;

// Fixture identity. The project path need not exist on disk — findSessionFile
// only uses encodeProjectPath(projectPath) ("/" → "-") to locate the JSONL dir
// under $HOME/.claude/projects/.
const PROJECT_PATH = "/home/fixture/tool-call-expand-proj";
// ADAPT: these two reproduce the reference impl's path-encoding conventions, used only to
// (a) place the fixture JSONL where the submission's session-file lookup will find it, and
// (b) build the URL the submission serves the session at. Repoint each to the submission's
// own scheme if it differs:
//   - encodeProjectPath ("/" → "-"): how the on-disk $HOME/.claude/projects/<dir> name is
//     derived from the project path. If the submission encodes the projects dir differently,
//     change this so the seeded JSONL lands in the dir the submission reads.
//   - encodeForUrl (base64url of the project path): how the project path is embedded in the
//     session URL. Repoint to the submission's encoder so SESSION_URL resolves.
// Neither is the graded behaviour (that's the auto-expand below) — they only make the page load.
const ENCODED_PROJECT_DIR = PROJECT_PATH.replace(/\//g, "-"); // encodeProjectPath
const SESSION_ID = "tool-call-expand-session";
const URL_PROJECT = Buffer.from(PROJECT_PATH).toString("base64url"); // encodeForUrl
const SESSION_URL = `${BASE}/project/${URL_PROJECT}/session/${SESSION_ID}`;

// Distinctive markers placed as tool_result *content*. Result content is only
// rendered in the DOM when the result EntryCard is expanded (its <pre> body),
// never in the collapsed header — so "marker present" ⟺ "result card expanded".
const BASH_RESULT_MARKER = "BASH_RESULT_BODY_MARKER_7f3a91";
const READ_RESULT_MARKER = "READ_RESULT_BODY_MARKER_2b5c08";
const GREP_RESULT_MARKER = "GREP_RESULT_BODY_MARKER_d41e6a";

// Entry line indices (0-based, assignment order in the JSONL below).
const BASH_REQUEST = 1; // assistant tool_use Bash
const BASH_RESULT = 2; // user tool_result for Bash  (LAST entry of its tool-call group)
const GREP_REQUEST = 6; // assistant tool_use Grep
const GREP_RESULT = 7; // user tool_result for Grep  (LAST entry of its tool-call group)

const T = (n) => new Date(Date.UTC(2024, 0, 1, 0, 0, n)).toISOString();

/**
 * Build the seeded session. Structure after grouping.buildDisplayItems:
 *   #0 user-prompt                          (primary, standalone)
 *   collapsed-group A (entryCount 4, TWO topical-group items):
 *     tool-call group: [#1 Bash use, #2 Bash result]
 *     tool-call group: [#3 Read use, #4 Read result]
 *   #5 user-prompt                          (primary, standalone — flushes A)
 *   collapsed-group B (entryCount 2, ONE topical-group item → autoExpand path):
 *     tool-call group: [#6 Grep use, #7 Grep result]
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
    userPrompt("Please run the first batch of tools.", 0),
    toolUse("toolu_bash", "Bash", { command: "echo bash-request-7f3a91" }, 1),
    toolResult("toolu_bash", BASH_RESULT_MARKER, 2),
    toolUse("toolu_read", "Read", { file_path: "/home/fixture/read-target-2b5c08.txt" }, 3),
    toolResult("toolu_read", READ_RESULT_MARKER, 4),
    userPrompt("Now run one more tool.", 5),
    toolUse("toolu_grep", "Grep", { pattern: "grep-request-d41e6a" }, 6),
    toolResult("toolu_grep", GREP_RESULT_MARKER, 7),
  ];
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ── DOM observation helpers ────────────────────────────────────────────────

/**
 * Capture the full observable state of a single EntryCard (`#entry-<lineIndex>`):
 *   - chevron: the header's leading glyph — "▼" when expanded, "▶" when collapsed
 *   - hasBody: whether the card's body section is rendered at all
 *   - bodyText: the body's text content ("" when no body)
 * Card markup (entry-card.tsx): <div id=entry-N><div header><span chevron/>…</div>{showBody && <div body/>}</div>
 *
 * ADAPT: this helper hard-codes three reference-impl identities. The GRADED signal is only
 * `hasBody` / `bodyText.includes(MARKER)` — i.e. "is the card's result body actually rendered"
 * — which is convention-independent and should be kept. The other two are reference shapes:
 *   - "#entry-<lineIndex>" is the reference impl's per-entry DOM id convention. If the submission
 *     anchors entries by a different scheme (data attribute, different id prefix), repoint this
 *     locator to the submission's per-entry element.
 *   - the card's two-child markup (header = first child div, body = second child div) and the
 *     chevron glyphs "▼"(expanded)/"▶"(collapsed) in the header's first <span> are the reference
 *     entry-card structure. If the submission's card differs, repoint the `xpath=./div[1]/span[1]`
 *     (chevron) and `xpath=./div[2]` (body) selectors to its header/body elements. The chevron
 *     glyph assertions are redundant corroboration of expand state; if the submission uses a
 *     different expand indicator, repoint the chevron read (or rely on `hasBody`/`bodyText` alone).
 */
async function cardState(page, lineIndex) {
  const card = page.locator(`#entry-${lineIndex}`);
  await card.waitFor({ state: "attached", timeout: 20_000 });
  const chevron = (
    await card.locator("xpath=./div[1]/span[1]").first().textContent()
  )?.trim();
  const body = card.locator("xpath=./div[2]");
  const hasBody = (await body.count()) > 0;
  const bodyText = hasBody ? ((await body.textContent()) ?? "") : "";
  return { chevron, hasBody, bodyText };
}

/** Click the collapsed CollapsedGroupView whose header reads "▸ N cards".
 *
 * ADAPT: "<N> cards" is the reference impl's collapsed-group header label (rendered as
 * "▸ <entryCount> cards"). The graded behaviour is only that consecutive non-primary entries
 * are bundled into a collapsed group the user can expand — not the wording. If the submission
 * labels its collapsed group differently (e.g. "<N> items", "<N> hidden", an icon-only toggle),
 * repoint this to whatever affordance expands the collapsed group holding the target cards. The
 * `cardCount` argument is the entry count used to disambiguate which collapsed group to click. */
async function expandCollapsedGroup(page, cardCount) {
  const header = page.getByRole("button", { name: new RegExp(`${cardCount} cards`) });
  await header.waitFor({ state: "visible", timeout: 30_000 });
  await header.click();
}

/** Click the collapsed tool-call group whose primary (request) card is #entry-<requestIndex>.
 *
 * ADAPT: "div.relative.cursor-pointer" is the reference impl's wrapper class for a collapsed
 * tool-call group (the clickable element that expands the group). Repoint this to whatever
 * element in the submission is the click target that expands the tool-call group containing the
 * request card — the graded behaviour is "clicking the collapsed tool-call group expands it",
 * not this class. The `#entry-<requestIndex>` filter still scopes to the right group (subject to
 * the per-entry id convention noted on cardState). */
async function expandToolCallGroup(page, requestIndex) {
  const wrapper = page
    .locator("div.relative.cursor-pointer")
    .filter({ has: page.locator(`#entry-${requestIndex}`) });
  await wrapper.waitFor({ state: "visible", timeout: 20_000 });
  await wrapper.click();
}

// ── Server lifecycle ───────────────────────────────────────────────────────

describe("tool-call topical group → result card auto-expand", () => {
  let browser;
  let context;
  let server;
  let tmpHome;

  before(async () => {
    // 1. Seed the fixture under a throwaway $HOME so CLAUDE_PROJECTS_DIR
    //    (= $HOME/.claude/projects) resolves to it.
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "sv-tc-home-"));
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
   * T01: Scenario: Expanding a tool-call topical group auto-expands its result card
   *
   * Given the user is viewing a session detail page whose entries include a non-primary `tool_use` block followed (after at most light-noise entries) by its matching `tool_result` block, so `buildLayer2` in `session-viewer/src/lib/grouping.ts` produces a `TopicalGroup` with `groupType === "tool-call"` whose `entries` are `[toolUseEntry, ...lightNoise, toolResultEntry]`
   * And that topical group sits inside a `CollapsedGroupView` that holds more than one item (so the group does NOT auto-expand and is shown as a collapsed `ToolCallGroupView` — the `tool_use` `EntryCard` with a `+N` badge overlay)
   * And the user has expanded the surrounding collapsed group via its `▸ XX cards` header
   * When the user clicks the collapsed tool-call group to expand it
   * Then the expanded group renders inside the indigo-tinted body (`bg-indigo-950/15` with `border-indigo-900/30`) showing a `▾ <summary>` toggle followed by the group's `EntryCard`s
   * And the result card — the `EntryCard` for the `tool_result` entry — is rendered already expanded (chevron `▼`, body content visible) in that same click, without the user clicking the result card's own header
   */
  test("expanding the tool-call group renders the indigo body, the ▾ summary toggle, and an already-expanded result card", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    await expandCollapsedGroup(page, 4); // surrounding multi-item collapsed group
    await expandToolCallGroup(page, BASH_REQUEST); // single click on the collapsed tool-call group

    // ADAPT: the expanded tool-call group's body is the reference impl's indigo-tinted nested
    // container ("bg-indigo-950/15" + "border-indigo-900/30") preceded by a "▾ <summary>" toggle
    // button whose <summary> is the tool name. The GRADED behaviour is that expanding the group
    // renders its cards inside a distinct nested container with a collapse toggle — NOT the specific
    // indigo colours or the "▾ " glyph. If the submission styles the expanded group differently,
    // repoint the `[class*="bg-indigo-950/15"]` locator to the submission's expanded-group container
    // (the element that wraps the group's cards) and relax `hasIndigoBg`/`hasIndigoBorder`/`toggleText`
    // to the submission's equivalents. "Bash" in the expected toggle is the tool name from the
    // fixture's tool_use (derivable), the "▾ " prefix is the reference collapse glyph.
    const indigoBody = page
      .locator('[class*="bg-indigo-950/15"]')
      .filter({ has: page.locator(`#entry-${BASH_RESULT}`) });
    const indigoClass = (await indigoBody.getAttribute("class")) ?? "";
    const toggleText = (
      await indigoBody.locator("xpath=preceding-sibling::button[1]").textContent()
    )?.trim();

    const result = await cardState(page, BASH_RESULT);

    assert.deepEqual(
      {
        indigoBodyCount: await indigoBody.count(),
        hasIndigoBg: indigoClass.includes("bg-indigo-950/15"),
        hasIndigoBorder: indigoClass.includes("border-indigo-900/30"),
        toggleText,
        resultChevron: result.chevron,
        resultHasBody: result.hasBody,
        resultBodyShowsMarker: result.bodyText.includes(BASH_RESULT_MARKER),
      },
      {
        indigoBodyCount: 1,
        hasIndigoBg: true,
        hasIndigoBorder: true,
        toggleText: "▾ Bash",
        resultChevron: "▼",
        resultHasBody: true,
        resultBodyShowsMarker: true,
      },
    );

    await page.close();
  });

  /*
   * T02: Scenario: Only the result card auto-expands — the request card stays collapsed
   *
   * Given a `TopicalGroup` of `groupType === "tool-call"` containing a `tool_use` (request) card and its `tool_result` (result) card, rendered collapsed inside an already-expanded `CollapsedGroupView`
   * When the user clicks the tool-call group to expand it
   * Then the result card (`EntryCard` for the `tool_result` entry) is rendered expanded with its body visible
   * And the request card (`EntryCard` for the `tool_use` entry) remains in its default collapsed state (chevron `▶`, no body shown)
   */
  test("only the result card auto-expands; the request card stays collapsed", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    await expandCollapsedGroup(page, 4);
    await expandToolCallGroup(page, BASH_REQUEST);

    const request = await cardState(page, BASH_REQUEST);
    const result = await cardState(page, BASH_RESULT);

    // Full differential state of BOTH cards in the expanded group.
    assert.deepEqual(
      {
        request: {
          chevron: request.chevron,
          hasBody: request.hasBody,
        },
        result: {
          chevron: result.chevron,
          hasBody: result.hasBody,
          bodyShowsMarker: result.bodyText.includes(BASH_RESULT_MARKER),
        },
      },
      {
        request: { chevron: "▶", hasBody: false },
        result: { chevron: "▼", hasBody: true, bodyShowsMarker: true },
      },
    );

    await page.close();
  });

  /*
   * T03: Scenario: Auto-expanded tool-call group (sole child of a collapsed group) also expands its result card
   *
   * Given a `CollapsedGroupView` whose only item is a single `TopicalGroup` of `groupType === "tool-call"`, so the existing rule expands both the collapsed group and its single topical-group child simultaneously (the `autoExpand={group.items.length === 1 && item.kind === "topical-group"}` path in `client.tsx`)
   * When the page renders and the user expands that collapsed group
   * Then the tool-call topical group is shown already expanded (no separate click on the group)
   * And its result card (`EntryCard` for the `tool_result` entry) is rendered expanded with its body visible, with no additional user interaction
   */
  test("sole-child tool-call group auto-expands and shows its result card body on a single collapsed-group click", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    // Single click on the sole-child collapsed group — NO click on the topical group itself.
    await expandCollapsedGroup(page, 2);

    // ADAPT: same reference-impl anchors as T01 — the expanded group's indigo container
    // ("bg-indigo-950/15") and its "▾ <summary>" toggle (here "▾ Grep", the fixture's tool name).
    // Graded behaviour is the auto-expanded group rendering its cards in a distinct container with
    // a collapse toggle; repoint the container locator and `toggleText` to the submission's
    // equivalents if it styles/labels the expanded group differently.
    const indigoBody = page
      .locator('[class*="bg-indigo-950/15"]')
      .filter({ has: page.locator(`#entry-${GREP_RESULT}`) });
    const toggleText = (
      await indigoBody.locator("xpath=preceding-sibling::button[1]").textContent()
    )?.trim();

    const request = await cardState(page, GREP_REQUEST);
    const result = await cardState(page, GREP_RESULT);

    assert.deepEqual(
      {
        toggleText,
        request: { chevron: request.chevron, hasBody: request.hasBody },
        result: {
          chevron: result.chevron,
          hasBody: result.hasBody,
          bodyShowsMarker: result.bodyText.includes(GREP_RESULT_MARKER),
        },
      },
      {
        toggleText: "▾ Grep",
        request: { chevron: "▶", hasBody: false },
        result: { chevron: "▼", hasBody: true, bodyShowsMarker: true },
      },
    );

    await page.close();
  });

  /*
   * T04: Scenario: Re-expanding the group after collapsing it re-expands the result card
   *
   * Given the user has expanded a `groupType === "tool-call"` `TopicalGroup` (per T01) and seen its result card expanded
   * When the user clicks the group's `▾ <summary>` header to collapse it
   * And then clicks the now-`▸` collapsed group again to expand it a second time
   * Then on the second expansion the result card (`EntryCard` for the `tool_result` entry) is again rendered expanded with its body visible, without any extra click on the result card itself
   */
  test("re-expanding the group after collapsing it re-expands the result card", async () => {
    const page = await context.newPage();
    await page.goto(SESSION_URL);
    await page.waitForLoadState("networkidle");

    await expandCollapsedGroup(page, 4);
    await expandToolCallGroup(page, BASH_REQUEST);

    // First expansion: result card is open with its body.
    const firstResult = await cardState(page, BASH_RESULT);

    // Collapse the group via its ▾ Bash toggle → children unmount.
    // ADAPT: "▾ Bash" is the reference impl's expanded-group collapse toggle (collapse glyph "▾"
    // + tool-name summary). Repoint this to the submission's collapse affordance for the tool-call
    // group if it differs; the graded behaviour is that collapsing then re-expanding the group
    // re-expands the result card, not this exact label.
    await page.getByRole("button", { name: /^▾ Bash/ }).click();
    await page.locator(`#entry-${BASH_RESULT}`).waitFor({ state: "detached", timeout: 20_000 });
    const detachedDuringCollapse = (await page.locator(`#entry-${BASH_RESULT}`).count()) === 0;

    // Re-expand the now-collapsed tool-call group a second time.
    await expandToolCallGroup(page, BASH_REQUEST);

    const request = await cardState(page, BASH_REQUEST);
    const secondResult = await cardState(page, BASH_RESULT);

    assert.deepEqual(
      {
        firstResult: {
          chevron: firstResult.chevron,
          hasBody: firstResult.hasBody,
          bodyShowsMarker: firstResult.bodyText.includes(BASH_RESULT_MARKER),
        },
        detachedDuringCollapse,
        request: { chevron: request.chevron, hasBody: request.hasBody },
        secondResult: {
          chevron: secondResult.chevron,
          hasBody: secondResult.hasBody,
          bodyShowsMarker: secondResult.bodyText.includes(BASH_RESULT_MARKER),
        },
      },
      {
        firstResult: { chevron: "▼", hasBody: true, bodyShowsMarker: true },
        detachedDuringCollapse: true,
        request: { chevron: "▶", hasBody: false },
        secondResult: { chevron: "▼", hasBody: true, bodyShowsMarker: true },
      },
    );

    await page.close();
  });
});
