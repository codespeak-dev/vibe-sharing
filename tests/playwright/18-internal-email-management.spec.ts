import { test, expect } from "@playwright/test";
import { loginAs, mockApi } from "./helpers.js";

test.describe("Feature: Internal Email Management", () => {
  test("Main table hides internal emails by default", async ({ page }) => {
    await loginAs(page);
    await mockApi(page, [
      {
        url: /\/api\/v1\/uploads$/,
        json: {
          uploads: [
            {
              uploadId: "u-internal",
              filename: "internal.zip",
              sizeBytes: 1024,
              userEmail: "ting@codespeak.dev",
              downloadUrl: "https://example.com/i.zip",
              createdAt: "2026-01-01T00:00:00Z",
            },
            {
              uploadId: "u-external",
              filename: "external.zip",
              sizeBytes: 2048,
              userEmail: "ext@example.com",
              downloadUrl: "https://example.com/e.zip",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: ["ting@codespeak.dev"] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("table#uploads-table tbody tr");

    // Internal upload should be hidden when 'Show internal' is unchecked.
    await expect(page.locator("td a.download-link", { hasText: "external.zip" })).toBeVisible();
    await expect(page.locator("td a.download-link", { hasText: "internal.zip" })).toHaveCount(0);
  });

  test("Show internal emails by checking the 'Show internal' toggle", async ({ page }) => {
    await loginAs(page);
    await mockApi(page, [
      {
        url: /\/api\/v1\/uploads$/,
        json: {
          uploads: [
            {
              uploadId: "u-internal",
              filename: "internal.zip",
              sizeBytes: 1024,
              userEmail: "ting@codespeak.dev",
              downloadUrl: "https://example.com/i.zip",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: ["ting@codespeak.dev"] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("#show-internal");

    // Hidden initially
    await expect(page.locator("td a.download-link", { hasText: "internal.zip" })).toHaveCount(0);

    // Toggle on → should appear
    await page.locator("#show-internal").check();
    await expect(page.locator("td a.download-link", { hasText: "internal.zip" })).toBeVisible();
  });

  test("Mark a user's email as internal from the main table row: clicking Hide adds the email to the internal set and refreshes the table to exclude that row", async ({ page }) => {
    await loginAs(page);
    let internalEmailsResponse = { emails: [] as string[] };
    let postedEmails: string[] = [];

    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();

      if (/\/api\/v1\/uploads$/.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            uploads: [
              {
                uploadId: "u-1",
                filename: "ext.zip",
                sizeBytes: 1024,
                userEmail: "ext@example.com",
                downloadUrl: "https://example.com/e.zip",
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        });
      }
      if (/\/api\/v1\/slack-threads$/.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ threads: [] }),
        });
      }
      if (/\/api\/v1\/internal-emails$/.test(url)) {
        if (method === "POST") {
          const body = req.postDataJSON() as { email: string };
          postedEmails.push(body.email);
          internalEmailsResponse.emails.push(body.email);
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(internalEmailsResponse),
        });
      }
      return route.fulfill({ status: 404, body: "{}" });
    });

    await page.goto("/");
    await page.waitForSelector("button.btn-mark-internal");

    await page.locator("button.btn-mark-internal").click();
    // Wait for the POST + applyFilter to complete.
    await page.waitForFunction(
      () => !document.querySelector("button.btn-mark-internal"),
      { timeout: 5_000 },
    );

    expect(postedEmails).toContain("ext@example.com");
    // Row is now hidden (internal, default filter).
    await expect(page.locator("td a.download-link", { hasText: "ext.zip" })).toHaveCount(0);
  });

  test("Add an email to the internal list via the dedicated management page", async ({ page }) => {
    await loginAs(page);
    let emails: string[] = [];

    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (/\/api\/v1\/internal-emails$/.test(url)) {
        if (method === "POST") {
          const body = req.postDataJSON() as { email: string };
          emails.push(body.email);
          return route.fulfill({ status: 200, body: "{}" });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ emails }),
        });
      }
      return route.fulfill({ status: 404 });
    });

    await page.goto("/internal-emails.html");
    await page.waitForSelector("#new-email");

    await page.locator("#new-email").fill("alice@example.com");
    await page.locator("#add-btn").click();

    await page.waitForSelector("#emails-table tbody tr", { timeout: 5_000 });
    expect(emails).toContain("alice@example.com");
    await expect(page.locator("td", { hasText: "alice@example.com" })).toBeVisible();
  });
});
