import { chromium } from "playwright";
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:3000";

describe("registry → session navigation", () => {
  let browser;
  let page;

  after(async () => {
    await browser?.close();
  });

  test("clicking 'open in session' scrolls to and highlights the entry", async () => {
    browser = await chromium.launch();
    const context = await browser.newContext();
    page = await context.newPage();

    // 1. Go to the tool-call registry page
    await page.goto(`${BASE}/registry/tool-call`);
    await page.waitForLoadState("networkidle");

    // 2. Find the first "open in session →" link
    const link = page.locator('a:has-text("open in session")').first();
    const href = await link.getAttribute("href");
    assert.ok(href, "Expected an 'open in session' link");
    const match = href.match(/#entry-(\d+)$/);
    assert.ok(match, `Link href should contain #entry-N, got: ${href}`);
    const entryId = `entry-${match[1]}`;

    // 3. Click the link (Next.js client-side navigation)
    await link.click();

    // 4. Wait for the entry element to exist in the DOM
    const entry = page.locator(`#${entryId}`);
    await entry.waitFor({ state: "attached", timeout: 10_000 });

    // 5. Give the scroll + highlight effect time to fire (rAF-based)
    await page.waitForTimeout(1000);

    // 6. Assert the highlight ring class was applied
    const classes = await entry.getAttribute("class");
    assert.ok(
      classes?.includes("ring-purple-500/60"),
      `Expected highlight ring class on #${entryId}, got classes: ${classes}`,
    );

    // 7. Assert the element is in the viewport (scroll worked)
    const isVisible = await entry.isVisible();
    assert.ok(isVisible, `#${entryId} should be visible in viewport`);
    const box = await entry.boundingBox();
    assert.ok(box, `#${entryId} should have a bounding box`);
    const viewport = page.viewportSize();
    assert.ok(
      box.y >= 0 && box.y < viewport.height,
      `#${entryId} should be scrolled into view (y=${box.y}, viewport=${viewport.height})`,
    );
  });
});
