import { test, expect } from "@playwright/test";
import { loginAs, mockApi } from "./helpers.js";

test.describe("Feature: Web UI — File Browsing and Authentication", () => {
  test("Authenticate before accessing uploaded files: unauthenticated visit redirects to Cognito hosted UI", async ({ page }) => {
    // No id_token in sessionStorage → init() calls redirectToLogin(), which sets
    // window.location.href = "https://<cognito>/oauth2/authorize?...". Intercept
    // the resulting request so we can assert on the URL without needing to
    // actually navigate (which would exit the test origin).
    const cognitoRequest = page.waitForRequest(
      (req) => req.url().includes("/oauth2/authorize"),
      { timeout: 5_000 },
    );
    await page.route("**/*amazoncognito.com/**", (route) => route.abort());
    await page.goto("/");

    const req = await cognitoRequest;
    const url = new URL(req.url());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")?.length ?? 0).toBeGreaterThan(20);
  });

  test("Gain access to uploaded files after successful authentication: list rendered with download links", async ({ page }) => {
    await loginAs(page);
    await mockApi(page, [
      {
        url: /\/api\/v1\/uploads$/,
        json: {
          uploads: [
            {
              uploadId: "u-1",
              filename: "archive.zip",
              sizeBytes: 1024,
              userName: "Ting",
              userEmail: "ting@codespeak.dev",
              repoUrl: "https://github.com/codespeak-dev/vibe-sharing",
              downloadUrl: "https://example.com/archive.zip",
              createdAt: "2026-01-01T00:00:00Z",
              confirmedAt: "2026-01-01T00:01:00Z",
            },
          ],
        },
      },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: [] } },
    ]);

    await page.goto("/");
    await page.waitForSelector("table#uploads-table tbody tr");

    // Filename rendered as a download link
    const link = page.locator("a.download-link", { hasText: "archive.zip" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://example.com/archive.zip");
  });

  test("View shortened and linked repository URL ('user/repo' hyperlink to GitHub) in the UI", async ({ page }) => {
    await loginAs(page);
    await mockApi(page, [
      {
        url: /\/api\/v1\/uploads$/,
        json: {
          uploads: [
            {
              uploadId: "u-1",
              filename: "x.zip",
              sizeBytes: 10,
              repoUrl: "git@github.com:codespeak-dev/vibe-sharing.git",
              downloadUrl: "https://example.com/x.zip",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
      { url: /\/api\/v1\/slack-threads$/, json: { threads: [] } },
      { url: /\/api\/v1\/internal-emails$/, json: { emails: [] } },
    ]);
    await page.goto("/");
    await page.waitForSelector("table#uploads-table tbody tr");

    // Should be rendered as <a href="https://github.com/codespeak-dev/vibe-sharing">codespeak-dev/vibe-sharing</a>
    const repoLink = page.locator("td a", { hasText: "codespeak-dev/vibe-sharing" });
    await expect(repoLink).toBeVisible();
    await expect(repoLink).toHaveAttribute(
      "href",
      "https://github.com/codespeak-dev/vibe-sharing",
    );
  });

  // Scenarios that need real cloud services. Declared as skipped tests so the
  // BDD scenario list stays exhaustive in playwright reports.
  const skipped = [
    "Add a new team member to the Cognito user pool: requires real Cognito",
    "Remove a team member from the Cognito user pool: requires real Cognito",
    "Self-register as a codespeak.dev staff member: requires real Cognito",
    "Receive a temporary password and set a permanent password on first login: requires real Cognito + real email",
    "View authenticated user's email address in the UI: not surfaced in current static page",
    "Access the application via the custom domain admin.vibe-share.codespeak.dev: requires real DNS + ACM",
    "Request ACM certificate in us-east-1 and add DNS validation record: requires real ACM",
    "Deploy CDK stack and receive live infrastructure outputs: requires real AWS",
    "Configure web UI with correct OAuth settings from stack outputs: human config step",
    "Update Cognito callback URLs to avoid login flow errors: assertion at deploy time",
    "Create a test user and verify they can authenticate: requires real Cognito",
  ];
  for (const title of skipped) {
    test.skip(title, () => {});
  }
});
