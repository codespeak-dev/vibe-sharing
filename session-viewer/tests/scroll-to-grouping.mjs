// E2E suite for the "scroll to entry across the grouping pipeline" feature.
//
// Driven by node's built-in test runner (`node --test`) and Playwright's
// `chromium` API against a *running* production build of the session viewer.
//
// Wiring contract (set by the launch command, see the B-phase manifest):
//   - The Next.js server is started with HOME pointed at a throwaway fixture
//     home so `CLAUDE_PROJECTS_DIR` (= $HOME/.claude/projects) resolves there.
//   - This test process keeps the REAL $HOME (so Playwright finds its browser
//     binary) and receives the server's home via $SV_FIXTURE_HOME, so it can
//     drop the fixture session JSONL where the server will read it.
//   - The app is reachable at $SV_BASE_URL (default http://localhost:3000).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

const BASE = process.env.SV_BASE_URL ?? "http://localhost:3000";
const CWD = "/fixture/proj";
const SESSION_ID = "scroll-fixture-session";
const ENCODED_PROJECT = Buffer.from(CWD).toString("base64url");
const SESSION_URL = `${BASE}/project/${ENCODED_PROJECT}/session/${SESSION_ID}`;
const REGISTRY_URL = `${BASE}/registry/tool-call`;

// Highlight classes the fixed scroll effect applies to the target entry card.
const RING_CLASSES = ["ring-1", "ring-purple-500/60"];

// ── Fixture session ────────────────────────────────────────────────
// Seven non-blank JSONL lines → lineIndex 0..6. After buildDisplayItems():
//   L0 user-prompt   (primary, visible)
//   L1 Bash tool-call (non-primary) → CollapsedGroup #1, single card        [T03 target]
//   L2 assistant-text (primary, visible) — separates the two groups
//   L3 Agent/subagent (non-primary, standalone)            ─┐ CollapsedGroup #2
//   L4 Read tool-call (non-primary) ─┐ TopicalGroup        ─┤  (2 items → topical
//   L5 Grep tool-call (non-primary) ─┘  (nested in CG #2)  ─┘   does NOT auto-expand) [T04 target]
//   L6 user-prompt   (primary, visible)
// L1 carries the latest timestamp, so it is the first /registry/tool-call instance.
const FIXTURE_LINES = [
  { type: "user", cwd: CWD, timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "INITIAL USER PROMPT. " + "padding ".repeat(60) }] } },
  { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:10:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "tool-bash-1", name: "Bash", input: { command: "echo scroll-target-bash" } }] } },
  { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:01:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "ASSISTANT RESPONSE separating the groups. " + "padding ".repeat(60) }] } },
  { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:02:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "tool-agent-1", name: "Agent", input: { description: "explore subtask", prompt: "go explore" } }] } },
  { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:03:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "tool-read-1", name: "Read", input: { file_path: "/fixture/proj/a.txt" } }] } },
  { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:04:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "tool-grep-1", name: "Grep", input: { pattern: "needle" } }] } },
  { type: "user", cwd: CWD, timestamp: "2026-01-01T00:05:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "FINAL USER PROMPT closing the session. " + "padding ".repeat(60) }] } },
];

const VIEWPORT = { width: 1280, height: 600 };

let browser;

before(async () => {
  // Drop the fixture session where the server (HOME=$SV_FIXTURE_HOME) reads it.
  const fixtureHome = process.env.SV_FIXTURE_HOME;
  assert.ok(fixtureHome, "SV_FIXTURE_HOME must point at the server's fixture HOME");
  const projectsDir = path.join(fixtureHome, ".claude", "projects", "-fixture-proj");
  await fs.mkdir(projectsDir, { recursive: true });
  const jsonl = FIXTURE_LINES.map((o) => JSON.stringify(o)).join("\n") + "\n";
  await fs.writeFile(path.join(projectsDir, `${SESSION_ID}.jsonl`), jsonl, "utf-8");

  // Rebuild the cross-session registry index so /registry/tool-call lists our instances.
  const res = await fetch(`${BASE}/api/registry-rebuild`, { method: "POST" });
  const body = await res.json();
  assert.ok(res.ok && body.ok, `registry rebuild failed: ${JSON.stringify(body)}`);
  assert.ok(body.entriesIndexed >= FIXTURE_LINES.length, `expected the fixture entries to be indexed, got ${JSON.stringify(body)}`);

  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

// ── Helpers ─────────────────────────────────────────────────────────

async function newPage() {
  const context = await browser.newContext({ viewport: VIEWPORT });
  return context.newPage();
}

// Real sessions hold hundreds-to-thousands of entries, so the `/api/session-entries`
// fetch resolves *after* the page's first paint — the very condition the scroll fix
// targets (defer marking `scrolledRef` until the target element actually exists).
// The fixture is tiny and would otherwise load before the initial scroll attempt,
// masking the race. We add deterministic fetch latency to reproduce production timing.
// This delays only the data fetch; the grouping, scroll, highlight, and expansion
// under test all still run for real.
async function installSlowEntriesFetch(page, ms = 700) {
  await page.route("**/api/session-entries**", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Snapshot the full observable highlight/scroll/expand state of a target entry card. */
async function readEntryState(page, lineIndex) {
  return page.evaluate((id) => {
    const el = document.getElementById(`entry-${id}`);
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const classes = Array.from(el.classList);
    const expanded = Array.from(el.querySelectorAll("button")).some(
      (b) => (b.textContent ?? "").trim() === "JSON",
    );
    return {
      exists: true,
      classes,
      top: r.top,
      bottom: r.bottom,
      innerHeight: window.innerHeight,
      expanded,
    };
  }, lineIndex);
}

/** Wait until the target entry card exists, is highlighted, and sits within the viewport. */
async function waitForHighlightedInView(page, lineIndex, timeout = 15000) {
  await page.waitForSelector(`#entry-${lineIndex}`, { timeout });
  await page.waitForFunction(
    ({ id, ring }) => {
      const el = document.getElementById(`entry-${id}`);
      if (!el) return false;
      if (!ring.every((c) => el.classList.contains(c))) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    },
    { id: lineIndex, ring: RING_CLASSES },
    { timeout },
  );
}

/** Assert a target card's full correct end state: highlighted + within viewport. */
function assertHighlightedInView(state, lineIndex) {
  assert.equal(state.exists, true, `#entry-${lineIndex} should be rendered`);
  for (const cls of RING_CLASSES) {
    assert.ok(state.classes.includes(cls), `#entry-${lineIndex} should carry highlight class ${cls}; had [${state.classes.join(" ")}]`);
  }
  assert.ok(
    state.top >= 0 && state.top < state.innerHeight,
    `#entry-${lineIndex} bounding-box top (${state.top}) should be within viewport height (${state.innerHeight})`,
  );
}

/** Assert a card is NOT present in the DOM (its containing group stayed collapsed). */
async function assertEntryAbsent(page, lineIndex) {
  const present = await page.evaluate((id) => !!document.getElementById(`entry-${id}`), lineIndex);
  assert.equal(present, false, `#entry-${lineIndex} should be absent (its group must stay collapsed)`);
}

/** Assert a card IS present in the DOM. */
async function assertEntryPresent(page, lineIndex) {
  const present = await page.evaluate((id) => !!document.getElementById(`entry-${id}`), lineIndex);
  assert.equal(present, true, `#entry-${lineIndex} should be rendered`);
}

// ── Scenarios ───────────────────────────────────────────────────────

/*
 * T01: Scenario: Playwright suite drives the running session viewer in Chromium
 *
 * Given `playwright` (`^1.59.1`) is a devDependency in `session-viewer/package.json` and a `test` npm script is wired to run the test files under `session-viewer/tests/`
 * And the Next.js session viewer is running and reachable at `http://localhost:3000`
 * When the developer runs the test script from `session-viewer/`
 * Then a headless Chromium browser launches via `chromium.launch()` from the `playwright` package
 * And the suite navigates to the app, executes its scenarios, closes the browser, and the process exits 0 when all tests pass
 */
test("T01 the npm test harness is wired and a real Chromium reaches the running app", async () => {
  // Harness wiring: the case added the `test` script and pins playwright as a devDependency.
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  assert.equal(pkg.scripts.test, "node --test 'tests/**/*.mjs'", "package.json must wire the node:test runner over tests/**/*.mjs");
  assert.equal(pkg.devDependencies.playwright, "^1.59.1", "package.json must declare the playwright ^1.59.1 devDependency");

  // Real browser process (chromium.launch from the playwright package, exercised in before())
  // navigates to the live app and observes real rendered content.
  const page = await newPage();
  const response = await page.goto(SESSION_URL, { waitUntil: "domcontentloaded" });
  assert.ok(response.ok(), `app should serve the session page, got HTTP ${response.status()}`);
  await page.waitForSelector("#entry-0", { timeout: 15000 });
  const shows = await page.evaluate(() => document.body.innerText.includes("of 7 entries"));
  assert.ok(shows, "the running app should report it is showing the 7 fixture entries");
  await page.context().close();
});

/*
 * T02: Scenario: "open in session" link scrolls to and highlights the target entry
 *
 * Given the `/registry/tool-call` page lists registry instances, each with an `open in session →` Next.js `Link` whose `href` ends in `#entry-N` (built by `sessionLink()` as `/project/<base64url-cwd>/session/<sessionId>#entry-<lineIndex>`)
 * When the test clicks the first `open in session →` link
 * Then the browser navigates to the target session page
 * And the target entry element `#entry-N` gains the highlight class `ring-purple-500/60`
 * And `#entry-N` is scrolled into the viewport (its bounding box top is within the viewport height)
 */
test("T02 clicking the first 'open in session' link scrolls to and highlights the target entry", async () => {
  const page = await newPage();
  await installSlowEntriesFetch(page);
  await page.goto(REGISTRY_URL, { waitUntil: "domcontentloaded" });

  const link = page.locator('a:has-text("open in session")').first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  const href = await link.getAttribute("href");
  const m = /#entry-(\d+)$/.exec(href ?? "");
  assert.ok(m, `the open-in-session link href should end in #entry-N, got ${href}`);
  const target = Number(m[1]);

  await link.click();
  await page.waitForURL(`**/session/${SESSION_ID}#entry-${target}`, { timeout: 15000 });
  await waitForHighlightedInView(page, target);

  assertHighlightedInView(await readEntryState(page, target), target);
  await page.context().close();
});

/*
 * T03: Scenario: Hash targeting a card hidden inside a collapsed group expands it
 *
 * Given a session contains an entry that is not visible by default because the three-layer grouping pipeline (`buildDisplayItems`) places it inside a `CollapsedGroup`
 * When the test navigates directly to that session URL with the hash `#entry-N` targeting the hidden entry
 * Then `SessionClient` parses `highlightEntry` from the hash and the containing `CollapsedGroup` auto-expands (its `containsHighlight` becomes true)
 * And the target `EntryCard` is rendered force-expanded, scrolled into view with `block: "center"`, and highlighted with `ring-purple-500/60`
 */
test("T03 hash targeting a card hidden inside a collapsed group expands, highlights, and scrolls to it", async () => {
  const target = 1; // Bash tool-call, the single card inside CollapsedGroup #1
  const page = await newPage();
  await installSlowEntriesFetch(page);
  await page.goto(`${SESSION_URL}#entry-${target}`, { waitUntil: "domcontentloaded" });
  await waitForHighlightedInView(page, target);

  const state = await readEntryState(page, target);
  assertHighlightedInView(state, target);
  assert.equal(state.expanded, true, "the targeted card must be force-expanded");

  // Only the containing group expands: the OTHER collapsed group's cards stay unrendered.
  await assertEntryAbsent(page, 3); // subagent in CollapsedGroup #2
  await assertEntryAbsent(page, 4); // Read in the nested topical group
  await assertEntryAbsent(page, 5); // Grep in the nested topical group
  await page.context().close();
});

/*
 * T04: Scenario: Target inside a nested topical group is revealed and highlighted
 *
 * Given the target entry sits inside a `TopicalGroup` that is itself nested within a `CollapsedGroup`
 * When the test navigates to the session URL with the hash `#entry-N` targeting that entry
 * Then both the `CollapsedGroup` and the inner `TopicalGroup` auto-expand (both compute `containsHighlight` true)
 * And the target `EntryCard` is rendered force-expanded, scrolled into view, and highlighted with `ring-purple-500/60`
 */
test("T04 hash targeting a card inside a nested topical group reveals both groups and highlights it", async () => {
  const target = 4; // Read tool-call inside TopicalGroup nested in CollapsedGroup #2
  const page = await newPage();
  await installSlowEntriesFetch(page);
  await page.goto(`${SESSION_URL}#entry-${target}`, { waitUntil: "domcontentloaded" });
  await waitForHighlightedInView(page, target);

  const state = await readEntryState(page, target);
  assertHighlightedInView(state, target);
  assert.equal(state.expanded, true, "the targeted card must be force-expanded");

  // Outer CollapsedGroup #2 expanded → its standalone sibling renders.
  await assertEntryPresent(page, 3); // subagent sibling
  // Inner TopicalGroup expanded → the non-target sibling tool-call also renders.
  await assertEntryPresent(page, 5); // Grep sibling in the same topical group
  // The unrelated CollapsedGroup #1 stayed collapsed.
  await assertEntryAbsent(page, 1);
  await page.context().close();
});

/*
 * T05: Scenario: "open in session" uses client-side routing and still highlights
 *
 * Given the registry `open in session →` element is a Next.js `Link` (client-side navigation), not a plain full-reload anchor
 * When the test clicks it to enter the session page
 * Then navigation happens as a client-side transition (no full document reload)
 * And after the transition the target `#entry-N` is still scrolled into view and highlighted with `ring-purple-500/60`
 */
test("T05 'open in session' navigates client-side (no full reload) and still highlights the target", async () => {
  const page = await newPage();
  await installSlowEntriesFetch(page);
  await page.goto(REGISTRY_URL, { waitUntil: "domcontentloaded" });

  const link = page.locator('a:has-text("open in session")').first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  const href = await link.getAttribute("href");
  const target = Number(/#entry-(\d+)$/.exec(href ?? "")?.[1]);
  assert.ok(Number.isInteger(target), `expected #entry-N href, got ${href}`);

  // Plant a sentinel on the live window; a full document reload would wipe it.
  const sentinel = `sentinel-${target}-keepme`;
  await page.evaluate((s) => { window.__noFullReload = s; }, sentinel);

  await link.click();
  await page.waitForURL(`**/session/${SESSION_ID}#entry-${target}`, { timeout: 15000 });

  const survived = await page.evaluate(() => window.__noFullReload);
  assert.equal(survived, sentinel, "the window sentinel must survive → navigation was a client-side transition, not a full reload");

  await waitForHighlightedInView(page, target);
  assertHighlightedInView(await readEntryState(page, target), target);
  await page.context().close();
});

/*
 * T06: Scenario: Hash change within the same open session re-scrolls to the new target
 *
 * Given a session page is already open and showing a highlighted entry `#entry-A`
 * When the URL hash changes to a different entry `#entry-B` in the same session (e.g. via a back-link or `window.location.hash` assignment)
 * Then `SessionClient`'s `hashchange` listener re-reads the hash, sets `highlightEntry` to B, and resets `scrolledRef`
 * And `#entry-B` is scrolled into view and highlighted with `ring-purple-500/60`
 */
test("T06 a hash change within the open session re-scrolls to and highlights the new target", async () => {
  const A = 1; // Bash card in CollapsedGroup #1
  const B = 4; // Read card in the nested topical group of CollapsedGroup #2
  const page = await newPage();
  await installSlowEntriesFetch(page);

  // Page open and already showing #entry-A highlighted.
  await page.goto(`${SESSION_URL}#entry-${A}`, { waitUntil: "domcontentloaded" });
  await waitForHighlightedInView(page, A);
  assertHighlightedInView(await readEntryState(page, A), A);

  // Change the hash to a different entry in the same loaded session.
  await page.evaluate((b) => { window.location.hash = `#entry-${b}`; }, B);

  // The hashchange listener re-targets B, resets scrolledRef, and B is scrolled into view + highlighted.
  await waitForHighlightedInView(page, B);
  const stateB = await readEntryState(page, B);
  assertHighlightedInView(stateB, B);
  assert.equal(stateB.expanded, true, "the new target must be force-expanded after the hash change");
  await page.context().close();
});
