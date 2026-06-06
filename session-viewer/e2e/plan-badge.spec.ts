import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  PROJECT_ENCODED,
  SESSION_A_ID,
  SESSION_B_ID,
  SESSION_A_TITLE,
  SESSION_B_TITLE,
  PLAN_MESSAGE_TEXT,
} from './fixtures';

const PROJECT_URL = `/project/${PROJECT_ENCODED}`;

// These tests grade the BEHAVIOUR in each scenario docstring, not the reference impl's mechanism.
// The reference realises the feature with an <a href="…#entry-N"> badge and a ring highlight; a
// correct submission may use a <button>/onClick + a query param + any highlight. So the badge is
// located by its accessible TEXT ("plan") and driven by CLICKING it (which exercises whatever
// navigation scheme the submission emits), and arrival is asserted by the plan message's rendered
// CONTENT plus a generic "visually distinguished" check — never by an anchor/hash/DOM-id literal.
//
// ADAPT (only the surface labels below are reference conventions; repoint to the submission's):
//   - `badgeText` ("plan") — the badge's visible label. Repoint if the submission labels it
//     differently. The graded fact is that a distinct interactive control navigates to the plan
//     message; the word is incidental.
//   - `isTargetHighlighted` treats a ring/box-shadow (or outline) near the target entry as the
//     "this is the target" marker (the reference uses `ring-1 ring-purple-500/60`, which compiles
//     to a box-shadow). If the submission distinguishes the target another way (background/border
//     colour, a data-attribute), extend this helper to detect that treatment.
//   - `errorText` (/^Error:/) — the reference's error-banner prefix; repoint to the submission's
//     error affordance if it surfaces load errors differently.
const badgeText = 'plan';
const errorText = /^Error:/;

/**
 * The "plan" badge inside the card whose visible title is `title`. Located by text within the
 * innermost element that shows both the (unique) session title and a `plan` control, so it works
 * whether the badge is an <a>, a <button>, or a span-with-onClick. Not scoped to any anchor/href.
 */
function planBadge(page: Page, title: string): Locator {
  const card = page
    .locator('div', { hasText: title })
    .filter({ has: page.getByText(badgeText, { exact: true }) })
    .last();
  return card.getByText(badgeText, { exact: true });
}

/**
 * Is the plan-referencing entry visually marked as the arrived-at target? Climbs a few ancestors of
 * the plan message text looking for a ring/box-shadow or outline — the generic "highlighted" signal,
 * independent of the exact class names. Returns the detected treatment or 'none'.
 */
async function highlightOf(locator: Locator): Promise<string> {
  return locator.evaluate((node: Element) => {
    // Drop any :focus-visible / browser focus ring on the currently-focused element first, so a
    // focus outline on a just-clicked control (badge/link) is not mistaken for the app's persistent
    // target highlight. The app marks the arrived-at entry with a class-driven ring/box-shadow that
    // survives blur; a focus ring does not.
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') active.blur();
    let el: Element | null = node;
    for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
      const s = getComputedStyle(el as Element);
      if (s.boxShadow && s.boxShadow !== 'none') return `box-shadow:${s.boxShadow}`;
      if (s.outlineStyle && s.outlineStyle !== 'none') return `outline:${s.outlineStyle}`;
    }
    return 'none';
  });
}

async function targetHighlight(page: Page): Promise<string> {
  return highlightOf(page.getByText(PLAN_MESSAGE_TEXT).first());
}

/** Assert we landed on the session-detail page for `sessionId` (scheme-agnostic: hash OR query). */
async function expectOnSessionDetail(page: Page, sessionId: string): Promise<void> {
  await page.waitForURL((url) => url.pathname.includes('/session/') && url.href.includes(sessionId));
}

/**
 * Given the URL the plan badge navigates to (its href, or the URL captured after a real click), build
 * an out-of-range/stale target in the SAME deep-link scheme by perturbing only the tail AFTER the
 * sessionId — a numeric line index (`#line-2`, `#entry-3`) is bumped out of range, and a keyed target
 * (`?highlightId=…`, `?scrollToPlan=…`) has its value replaced with a non-existent one. The digits
 * inside the sessionId are never touched. Returns null if the URL carries no target token at all (a
 * client-only navigation with no URL-addressable deep link), so a stale deep-link cannot be
 * synthesised in the submission's scheme.
 */
function staleTargetOf(navUrl: string, sessionId: string): string | null {
  const idIdx = navUrl.indexOf(sessionId);
  if (idIdx < 0) return null;
  const cut = idIdx + sessionId.length;
  const base = navUrl.slice(0, cut);
  const tail = navUrl.slice(cut);
  const keyed = tail.match(/^([#?].*?=)([^&#]+)(.*)$/);
  if (keyed) {
    const bogus = /^\d+$/.test(keyed[2]) ? '999999' : 'stale-nonexistent-target-999999';
    return base + keyed[1] + bogus + keyed[3];
  }
  if (/\d/.test(tail)) {
    return base + tail.replace(/(\d+)(?!.*\d)/, '999999');
  }
  return null;
}

/**
 * Assert arrival at the plan target: the plan message is rendered and scrolled into view, and it is
 * visually distinguished as the target. Used after navigating via the badge (T02/T04) or into a
 * collapsed group (T05).
 */
async function expectArrivedAtPlan(page: Page): Promise<void> {
  const planText = page.getByText(PLAN_MESSAGE_TEXT).first();
  await expect(planText).toBeVisible();
  await expect(planText).toBeInViewport();
  await expect
    .poll(() => targetHighlight(page), {
      message: 'plan target entry should be visually highlighted after arrival',
      timeout: 10_000,
    })
    .not.toBe('none');
}

test.describe('Plan badge — project list page', () => {
  /*
   * T02: Scenario: The plan badge renders as an interactive link to the session detail page targeting the plan message
   *
   * Given a `SessionCard` is rendered with `hasPlans` true, a known `sessionId`, a `projectHref` such as `/project/xyz`,
   * and the plan message's line index
   * When the card renders
   * Then the `plan` badge is an anchor (`<a>`) element whose `href` begins with `${projectHref}/session/${sessionId}`
   * And the `href` encodes the plan message's line index (hash or query parameter), distinguishing it from the plain
   * session-detail link
   *
   * Graded (mechanism-agnostic): a DISTINCT interactive "plan" control exists on the card and,
   * when activated, navigates to THIS session's detail page AND lands on the plan message (the plan
   * entry is scrolled into view and highlighted) — distinguishing it from the plain card link, which
   * would open the session with no plan target.
   */
  test('T02: plan badge is a distinct interactive control that navigates to the session at the plan message', async ({ page }) => {
    await page.goto(PROJECT_URL);

    const badge = planBadge(page, SESSION_A_TITLE);
    await expect(badge).toHaveCount(1);

    await badge.click();
    await expectOnSessionDetail(page, SESSION_A_ID);
    await expectArrivedAtPlan(page);
  });

  /*
   * T03: Scenario: Clicking the plan badge produces exactly one navigation, distinct from the card body
   *
   * Given a `SessionCard` with a `plan` badge, where the whole card is otherwise a link to `${projectHref}/session/${sessionId}`
   * When the user clicks the `plan` badge
   * Then the browser navigates once, to the session detail URL carrying the plan-message target
   * And clicking the card body outside the badge instead navigates to `${projectHref}/session/${sessionId}` with no plan-message target
   */
  test('T03: badge click arrives at the plan message; card body click opens the plain session with no plan target', async ({ page }) => {
    // — Badge click arrives at the plan target.
    await page.goto(PROJECT_URL);
    await planBadge(page, SESSION_A_TITLE).click();
    await expectOnSessionDetail(page, SESSION_A_ID);
    await expectArrivedAtPlan(page);

    // — Card body click (the title text, inside the card but not the badge) opens the plain session:
    // same session, but NOT arrived at the plan target (no scroll-to / highlight).
    await page.goto(PROJECT_URL);
    await page.getByText(SESSION_A_TITLE, { exact: true }).click();
    await expectOnSessionDetail(page, SESSION_A_ID);
    await expect(page.getByText(PLAN_MESSAGE_TEXT).first()).toBeVisible();
    expect(await targetHighlight(page)).toBe('none');
  });
});

test.describe('Plan badge — session detail deep link', () => {
  /*
   * T04: Scenario: Arriving via the plan badge scrolls the plan-referencing EntryCard into view
   *
   * Given the session detail page (`SessionClient`) is opened with a deep-link target identifying a message line index
   * When `SessionClient` finishes its initial `fetchPage` and renders the `EntryCard` list
   * Then the `EntryCard` whose `lineIndex` equals the target is scrolled into the viewport
   * And it is visually distinguishable as the target (e.g. a highlight/ring class)
   *
   * Arrival is driven by CLICKING the badge (the submission's own navigation scheme) rather than by
   * hardcoding a `#entry-N` deep-link URL, so any hash/query scheme is exercised the way a real user
   * reaches the page.
   */
  test('T04: arriving via the plan badge scrolls the plan entry into view and highlights it', async ({ page }) => {
    await page.goto(PROJECT_URL);
    await planBadge(page, SESSION_A_TITLE).click();
    await expectOnSessionDetail(page, SESSION_A_ID);
    await expectArrivedAtPlan(page);

    // A non-plan entry (line 0) is NOT the target: it is not highlighted.
    const firstMsg = page.getByText('Hello world').first();
    await expect(firstMsg).toBeVisible();
    expect(await highlightOf(firstMsg)).toBe('none');
  });

  /*
   * T05: Scenario: A plan message inside a collapsed group is revealed on arrival
   *
   * Given the plan-referencing message is a non-user message that `SessionClient` groups into a `CollapsedGroup`
   * (collapsed by default behind a `··· N messages ···` button)
   * When the user navigates to the session detail page via the plan badge
   * Then the containing group is expanded so the targeted `EntryCard` is rendered and scrolled into view,
   * rather than remaining hidden behind the ellipsis
   *
   * Session B's plan message is an assistant entry that lands inside a collapsed group by default; a
   * correct impl must auto-expand the group so the target is visible. We assert the plan message is
   * VISIBLE (not hidden behind the collapse toggle) and highlighted — agnostic to the toggle's label.
   */
  test('T05: plan badge target inside a collapsed group is revealed (group auto-expands) and highlighted', async ({ page }) => {
    await page.goto(PROJECT_URL);
    await planBadge(page, SESSION_B_TITLE).click();
    await expectOnSessionDetail(page, SESSION_B_ID);
    // If the group stayed collapsed, the plan message would not be rendered/visible — so this both
    // proves auto-expansion and that the target was reached.
    await expectArrivedAtPlan(page);
  });

  /*
   * T06: Scenario: A stale or out-of-range plan target renders the page gracefully
   *
   * Given the session detail page is opened with a deep-link line index that matches no rendered entry
   * (e.g. a truncated/stale session)
   * When `SessionClient` finishes loading entries
   * Then all entries render normally, no scroll-into-view is attempted for the missing target,
   * and no error message is shown
   *
   * The stale target is expressed in the SUBMISSION's own deep-link scheme, discovered from a REAL
   * badge navigation — its href for an <a>/<Link>, or the URL captured after clicking a
   * <button>/<span> that navigates programmatically (router.push). The discovered target token is
   * then perturbed to an out-of-range value (see `staleTargetOf`). A submission that encodes no
   * URL-addressable plan target (client-only navigation) cannot demonstrate this scenario and fails
   * the assertion below. ADAPT: `staleTargetOf` recognises numeric-index (`#line-N`, `#entry-N`) and
   * keyed (`?highlightId=…`, `?scrollToPlan=…`) schemes; extend it only if the submission uses a
   * fundamentally different target encoding — do NOT hand-write a stale URL that bypasses the badge.
   */
  test('T06: a stale/out-of-range plan target renders all entries with no highlight and no error', async ({ page }) => {
    await page.goto(PROJECT_URL);
    const badge = planBadge(page, SESSION_A_TITLE);
    await expect(badge).toHaveCount(1);

    // Discover the submission's deep-link scheme from a REAL navigation: an <a>/<Link> exposes it as
    // an href without navigating; a <button>/<span> that navigates programmatically exposes it only
    // in the URL after a click. (The previous version read ONLY the static href, so a button-based
    // badge yielded no URL and fell through to a plain load that never exercised staleness — a
    // spurious pass.)
    let navUrl = await badge.getAttribute('href');
    if (!navUrl) {
      await badge.click();
      await expectOnSessionDetail(page, SESSION_A_ID);
      navUrl = page.url();
      // The click left us ON the detail page with the REAL target highlighted; return to the list so
      // the stale-target load below is a FRESH document navigation. A hash-only goto from the already
      // -open page would not re-run the page's hash parsing, and the real highlight would wrongly
      // persist — exactly how a real user reaches a stale deep-link is a fresh load, not a hash swap.
      await page.goto(PROJECT_URL);
    }

    // Perturb the target token to an out-of-range value in the submission's own scheme. A correct
    // submission encodes a URL-addressable plan target (T02), so this yields a genuinely stale
    // deep-link; if it does not, the graceful-staleness scenario cannot be exercised.
    const staleUrl = staleTargetOf(navUrl, SESSION_A_ID);
    expect(
      staleUrl,
      'the plan badge must encode a URL-addressable target (hash or query) so a stale deep-link can be derived',
    ).not.toBeNull();
    await page.goto(staleUrl!);

    // Entries still render normally.
    await expect(page.getByText('Hello world').first()).toBeVisible();
    await expect(page.getByText(PLAN_MESSAGE_TEXT).first()).toBeVisible();

    // Nothing is highlighted as a target (the stale index matches no entry).
    expect(await targetHighlight(page)).toBe('none');

    // No error UI is shown.
    await expect(page.getByText(errorText)).toHaveCount(0);
  });
});
