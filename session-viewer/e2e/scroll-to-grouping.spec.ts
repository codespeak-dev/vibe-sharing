// Import from `playwright/test` — the test runner exposed by the base project's
// existing `playwright@^1.59.1` dependency (no separate `@playwright/test` install).
import { test, expect } from "playwright/test";

// Reference test for the "open in session / scroll-to-target" behaviour.
//
// It navigates to the deterministic fixture session the harness seeds under
// $HOME/.claude/projects, targeting a card (lineIndex 3) that is hidden inside a
// collapsed group by default, and asserts the deep link reveals the group, scrolls
// the target into view, and highlights it.
//
// The bug being reproduced is an ASYNC-LOAD race: the scroll/highlight guard is set
// before the target has rendered, so once the entries arrive the effect never
// retries and the highlight never lands. To make that race DETERMINISTIC (rather
// than depending on how fast the local API happens to respond), the test holds the
// entries response for ~600ms so the target is guaranteed absent during the initial
// scroll pass. Against the BUGGY client this test then reliably FAILS; against the
// FIXED client (which retries as entries arrive) it PASSES.

// The fixture the harness seeds (kept in sync with harness.sh):
const FIX_PROJECT_PATH = "/fixture/scroll-project";
const FIX_SESSION_ID = "f1x2u3r4-0000-4000-8000-000000000001";
const FIX_TARGET_LINE = 3;

// The app serves the project at /project/<base64url(projectPath)>.
const projectSegment = Buffer.from(FIX_PROJECT_PATH).toString("base64url");
const SESSION_URL = `/project/${projectSegment}/session/${FIX_SESSION_ID}`;

test("deep link to a card inside a collapsed group reveals, scrolls to and highlights it", async ({ page }) => {
  // Deterministically model the async load: hold the entries response so the target
  // is guaranteed not yet rendered during the client's first scroll-to-target pass.
  await page.route("**/api/session-entries**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });

  // Navigate straight to the session with the hash targeting the hidden card.
  await page.goto(`${SESSION_URL}#entry-${FIX_TARGET_LINE}`);

  // The transcript must load (the fixture session is present on disk).
  await page.waitForSelector("text=Showing", { timeout: 15000 });

  const target = page.locator(`#entry-${FIX_TARGET_LINE}`);

  // The target lives inside a collapsed group that is closed by default; the deep
  // link must auto-expand it so the target card is actually in the DOM and visible.
  await expect(target).toBeVisible({ timeout: 15000 });

  // The scroll-to-target effect must add the highlight ring once the target has
  // rendered — this is the behaviour the buggy client fails to deliver.
  await expect(target).toHaveClass(/ring-purple-500\/60/, { timeout: 15000 });

  // And it must be scrolled into the viewport, not left off-screen.
  const inView = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  expect(inView).toBe(true);
});
