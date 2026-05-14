import { test, expect } from "@playwright/test";
import { loginAs, mockApi } from "./helpers.js";

test.describe("Feature: Internal Uploads Preference Persistence", () => {
  test("Save 'Show internal uploads' preference to localStorage when enabled", async ({ page }) => {
    await loginAs(page);
    await mockApi(page, [
      { url: /\/api\/v1\/uploads$/, json: { uploads: [] } },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: [] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("#show-internal");

    await page.locator("#show-internal").check();

    const stored = await page.evaluate(() => localStorage.getItem("show-internal"));
    expect(stored).toBe("true");
  });

  test("Restore 'Show internal uploads' preference from localStorage on page load", async ({ page }) => {
    await loginAs(page);
    await page.addInitScript(() => {
      localStorage.setItem("show-internal", "true");
    });
    await mockApi(page, [
      { url: /\/api\/v1\/uploads$/, json: { uploads: [] } },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: [] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("#show-internal");

    await expect(page.locator("#show-internal")).toBeChecked();
  });

  test("Save 'Show internal uploads' preference when disabled (toggled off)", async ({ page }) => {
    await loginAs(page);
    await page.addInitScript(() => {
      localStorage.setItem("show-internal", "true");
    });
    await mockApi(page, [
      { url: /\/api\/v1\/uploads$/, json: { uploads: [] } },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: [] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("#show-internal");
    await expect(page.locator("#show-internal")).toBeChecked();

    await page.locator("#show-internal").uncheck();

    const stored = await page.evaluate(() => localStorage.getItem("show-internal"));
    expect(stored).toBe("false");
  });
});
