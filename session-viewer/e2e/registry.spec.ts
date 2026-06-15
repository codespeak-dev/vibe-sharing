import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { PROJECT_ENCODED, SEEDED_TYPES, USER_MARKER } from "./fixtures";

// Behavioural replacement for the old registry-sections.test.tsx / registry-ui.test.tsx vitest
// component tests. Those statically imported the reference impl's per-type view
// (`@/app/registry/[typeId]/client` -> RegistryInstancesClient) and its `EntryCard`, and asserted a
// `[id^="entry-"]` DOM anchor. Every submission mounts the registry view at its own path (flat
// client page, `registry/client.tsx`, `registry-explorer.tsx`, a `[typeId]` sub-route) and renders
// examples its own way (MessageRenderer, JsonViewer, a custom card, raw <pre>), NONE of which emit
// `id="entry-N"` — so the old files failed to even load ("Failed to resolve import") or false-failed
// on the missing anchor. That is reference-internals coupling.
//
// This suite instead drives the REAL `/registry` route in a browser and grades the RENDERED DOM,
// mechanism-agnostic. It seeds three visibly-distinct kinds (a user prompt, an assistant text reply,
// a tool call), each carrying a distinctive marker, then proves each kind's example renders in the
// registry UI, that a kind with nothing cached shows an explicit empty state, and that clicking an
// example navigates to that example's session detail page.
//
// ADAPT (surface anchors only — never weaken WHAT is observed):
//   - REGISTRY_PATH: the route the registry view is mounted at. Repoint if a submission mounts it
//     elsewhere (locate by nav link / page content, not a hard component path).
//   - EMPTY_STATE_RE: the concept of an explicit "no cached examples" indicator. Extend the alternation
//     if a submission's empty-state copy uses different words; do NOT relax it to match any page text.
const REGISTRY_PATH = "/registry";

const EMPTY_STATE_RE =
  /no\s+(instances|examples|entries|matches|results|cached)|(empty|none\s+found|nothing\s+(found|cached)|not\s+found)/i;

// Generic, affordance-agnostic reveal control text. Some registries collapse a kind's examples behind
// a disclosure (a chevron, an "N examples/instances" count, a show/expand/view/find control) or behind
// a click into the kind's own section/sub-page. When a marker is not yet visible we click plausible
// controls and re-check — fail-fast (a missing control costs nothing) and non-destructive (we only
// ever try to REVEAL more, and assert on the marker, never on a control).
const REVEAL_LABEL_RE = /[▶▸►▾▼]|\bshow\b|\bexpand\b|\bview\b|\bfind\b|\bexamples?\b|\binstances?\b|\bbrowse\b/i;

/**
 * Trigger the base repo's own cache ingestion for each seeded session by hitting the shared
 * `/api/session-entries` route (present + identical in the base repo and every submission). This
 * parses the seeded JSONL and writes the cache the registry reads — the submission's OWN ingestion
 * path, so no reference-specific rebuild endpoint is assumed. The route resolves the file either at
 * the encoded project dir or by scanning all project dirs for `<sessionId>.jsonl`.
 */
async function ingestSeeds(request: APIRequestContext): Promise<void> {
  for (const seed of SEEDED_TYPES) {
    const url = `/api/session-entries?sessionId=${seed.sessionId}&projectPath=${PROJECT_ENCODED}`;
    // Retry transient failures: the very first ingestion request can race the cache DB's one-time
    // schema/WAL initialisation and 5xx once, then succeed. This retry hardens against that cold-start
    // race — it does NOT mask a persistent failure (a genuinely broken ingestion 5xxs on every retry).
    let status = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request.get(url);
      status = res.status();
      if (res.ok()) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status, `seeding ingestion for ${seed.sessionId} should succeed (last HTTP ${status})`).toBeLessThan(400);
  }
}

/** Is the marker's text present anywhere in the current document? */
async function markerVisible(page: Page, marker: string): Promise<boolean> {
  return (await page.locator(`text=${marker}`).count()) > 0;
}

// Candidate in-place expanders, tag-agnostic: a disclosure control can be a <button>/<summary>, a
// role=button, OR a plain <div onClick> header carrying a chevron glyph or an "examples/expand/view"
// label (as several registries render it). We include cursor-pointer elements so a clickable header
// div is reached; clicking a descendant bubbles to the header's onClick. This never synthesises
// content — it only tries to reveal more, and the caller asserts on the marker, not on any control.
function expanderLocator(page: Page) {
  return page
    .locator(
      "button, summary, [role='button'], details, [class*='cursor-pointer'], [class*='cursor: pointer']",
    )
    .filter({ hasText: REVEAL_LABEL_RE });
}

/**
 * On the current page, click every plausible in-place expander and re-check for the marker after
 * each. Handles collapse-by-default layouts where a kind's example (or the whole kind section) is
 * conditionally rendered only once its header/disclosure is clicked. Returns true once the marker
 * becomes present.
 */
async function expandInPlace(page: Page, marker: string): Promise<boolean> {
  if (await markerVisible(page, marker)) return true;
  const expanders = expanderLocator(page);
  const n = await expanders.count();
  for (let i = 0; i < n; i++) {
    const ex = expanders.nth(i);
    if (!(await ex.isVisible().catch(() => false))) continue;
    await ex.click({ timeout: 2000 }).catch(() => {});
    if (await markerAppearsWithin(page, marker, 1200)) return true;
  }
  return markerVisible(page, marker);
}

/**
 * Last-resort reveal for layouts where a kind is a plain clickable card/button with NO disclosure
 * text (no chevron / "expand" / "examples" label) — e.g. a `<button>` whose only text is the kind's
 * name — so a label-based expander can't recognise it. Click each visible button / role=button /
 * cursor-pointer card in turn (skipping ones already tried), re-checking for the marker; if a click
 * navigated away, come back to /registry and continue. Bounded and reveal-only: it asserts on the
 * marker, never on a control, and clicking category-filter/toggle controls is harmless because we
 * re-check after each and re-load if stranded.
 */
async function markerAppearsWithin(page: Page, marker: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await markerVisible(page, marker)) return true;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  return markerVisible(page, marker);
}

async function bruteExpand(page: Page, marker: string, from: string): Promise<boolean> {
  const clickables = page.locator("button, [role='button'], [class*='cursor-pointer']");
  const n = Math.min(await clickables.count(), 40);
  for (let i = 0; i < n; i++) {
    const el = clickables.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 2000 }).catch(() => {});
    // A click may fire an async example fetch; poll briefly so a slow fetch/render is not missed
    // before moving to the next control (which could re-collapse this one).
    if (await markerAppearsWithin(page, marker, 1500)) return true;
    if (!page.url().includes(from.replace(/^\//, "")) && !page.url().endsWith(from)) {
      // A click navigated away without revealing the marker — return and keep scanning from here.
      await page.goto(from).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  return markerVisible(page, marker);
}

/**
 * Ensure the given kind's example (identified by its marker) is revealed on the registry, returns
 * true once the marker text is present in the DOM. Mechanism-agnostic across the layouts seen:
 *   1. flat page that shows every kind's example inline (marker already there);
 *   2. flat page where each kind's examples are behind a disclosure / card-expand (expandInPlace);
 *   3. landing page whose kind cards link to a per-kind view/sub-page (click each registry link,
 *      re-checking, and returning to /registry between tries so a wrong guess can't strand us).
 * Every attempt starts from a fresh /registry load so a click that navigated away is never left
 * corrupting the next attempt.
 */
async function revealMarker(page: Page, marker: string): Promise<boolean> {
  await page.goto(REGISTRY_PATH);
  await page.waitForTimeout(300);
  if (await markerVisible(page, marker)) return true;
  if (await expandInPlace(page, marker)) return true;

  // Landing → per-kind: click each registry link, expand on the destination, re-check, then reset.
  const hrefs = new Set<string>();
  const links = page.locator('a[href*="registry"]');
  const linkCount = await links.count();
  for (let i = 0; i < linkCount; i++) {
    const href = await links.nth(i).getAttribute("href").catch(() => null);
    if (href && href !== REGISTRY_PATH && !href.endsWith("/registry")) hrefs.add(href);
  }
  for (const href of hrefs) {
    await page.goto(href).catch(() => {});
    await page.waitForTimeout(300);
    if (await markerVisible(page, marker)) return true;
    if (await expandInPlace(page, marker)) return true;
  }

  // Last resort: kind cards that are plain clickable buttons with no disclosure label.
  await page.goto(REGISTRY_PATH).catch(() => {});
  await page.waitForTimeout(300);
  if (await bruteExpand(page, marker, REGISTRY_PATH)) return true;

  await page.goto(REGISTRY_PATH).catch(() => {});
  return markerVisible(page, marker);
}

/** Is an explicit empty-state indicator present on the current page? */
async function emptyStateVisible(page: Page): Promise<boolean> {
  return (await page.getByText(EMPTY_STATE_RE).count()) > 0;
}

/**
 * Reveal an explicit "no cached examples" indicator for a kind with nothing seeded. Only three kinds
 * are seeded, so the many other kinds the viewer discerns have nothing cached and must expose an
 * empty state. Mechanism-agnostic like revealMarker: it may be inline on /registry, behind a
 * disclosure, or on a per-kind sub-page reached from a landing link.
 */
async function revealEmptyState(page: Page): Promise<boolean> {
  await page.goto(REGISTRY_PATH);
  await page.waitForTimeout(300);
  if (await emptyStateVisible(page)) return true;

  const expanders = expanderLocator(page);
  const n = await expanders.count();
  for (let i = 0; i < n; i++) {
    const ex = expanders.nth(i);
    if (!(await ex.isVisible().catch(() => false))) continue;
    await ex.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(200);
    if (await emptyStateVisible(page)) return true;
  }

  const hrefs = new Set<string>();
  const links = page.locator('a[href*="registry"]');
  const linkCount = await links.count();
  for (let i = 0; i < linkCount; i++) {
    const href = await links.nth(i).getAttribute("href").catch(() => null);
    if (href && href !== REGISTRY_PATH && !href.endsWith("/registry")) hrefs.add(href);
  }
  for (const href of hrefs) {
    await page.goto(href).catch(() => {});
    await page.waitForTimeout(250);
    if (await emptyStateVisible(page)) return true;
  }
  return false;
}

test.beforeEach(async ({ request }) => {
  await ingestSeeds(request);
});

/*
 * T01 + T02: every kind the viewer discerns renders its own section, and each shows >=1 real cached
 * example (proven by that kind's distinctive marker being present in the registry UI). Discrimination:
 * a build that renders no per-kind example sections cannot surface any marker and fails.
 */
test.describe("Registry renders each discerned kind's real cached example", () => {
  test("each seeded kind's real example (its marker) is present in the registry UI", async ({ page }) => {
    const found: string[] = [];
    for (const seed of SEEDED_TYPES) {
      const ok = await revealMarker(page, seed.marker);
      expect(ok, `the ${seed.sessionId} kind's example marker "${seed.marker}" should appear in the registry UI`).toBe(true);
      found.push(seed.marker);
    }
    // All three distinct kinds surfaced their own example — a build collapsing everything to one
    // section, or rendering no per-kind examples, cannot reach this.
    expect(new Set(found).size).toBe(SEEDED_TYPES.length);
    expect(found.length).toBeGreaterThan(1);
  });
});

/*
 * T06: a kind with no cached example still shows an explicit empty state (not silently omitted). Only
 * three kinds are seeded, so the many other kinds the viewer discerns (subagents, plans, tool-results,
 * misc, …) have nothing cached; at least one such kind must expose an empty-state indicator.
 */
test.describe("A kind with no cached example shows an explicit empty state", () => {
  test("the registry surfaces an explicit no-examples indicator for an unseeded kind", async ({ page }) => {
    const hasEmptyState = await revealEmptyState(page);
    expect(
      hasEmptyState,
      "an unseeded kind should show an explicit empty-state indicator, not be silently omitted",
    ).toBe(true);
  });
});

/*
 * T08 + T09: clicking an example navigates to that example's session detail page. Scheme-agnostic:
 * the destination URL must contain `/session/` and the example's session id. The per-line deep-link
 * scheme (#entry-N / #L-N / ?line= / ?highlight=) is NOT required to be uniform — only that the click
 * reaches the correct session's detail page.
 */
test.describe("Clicking an example navigates to its session detail page", () => {
  test("an example click lands on the seeded example's session detail page", async ({ page }) => {
    // Use the user-prompt kind: its marker renders in every viewer (plain text body).
    const seed = SEEDED_TYPES.find((s) => s.marker === USER_MARKER)!;
    const revealed = await revealMarker(page, seed.marker);
    expect(revealed, "the user-prompt example must be visible before it can be clicked").toBe(true);

    // The revealed example exposes a control that navigates to its session. Prefer an explicit link
    // to THIS example's session (any hash/query scheme); otherwise click the element carrying the
    // marker (a card whose onClick navigates). Then assert we reach THIS example's session detail
    // page — scheme-agnostic: the destination URL contains /session/ and the seeded session id.
    const sessionLink = page.locator(`a[href*="/session/"][href*="${seed.sessionId}"]`);
    if ((await sessionLink.count()) > 0) {
      await sessionLink.first().click();
    } else {
      await page.locator(`text=${seed.marker}`).first().click();
    }

    await page.waitForURL((url) => url.pathname.includes("/session/") && url.href.includes(seed.sessionId), {
      timeout: 15000,
    });
  });
});
