import type { Page, Route } from "@playwright/test";

/** Inject a fake id_token into sessionStorage so isLoggedIn() returns true. */
export async function loginAs(page: Page, idToken = "fake-id-token"): Promise<void> {
  await page.addInitScript((tok: string) => {
    sessionStorage.setItem("id_token", tok);
    sessionStorage.setItem("access_token", tok);
  }, idToken);
}

interface MockRoute {
  url: RegExp;
  method?: string;
  status?: number;
  json?: unknown;
}

/** Stub /api/* routes the page hits. Routes are matched in order. */
export async function mockApi(page: Page, routes: MockRoute[]): Promise<void> {
  await page.route("**/api/**", (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    for (const r of routes) {
      if (r.url.test(url) && (!r.method || r.method === method)) {
        return route.fulfill({
          status: r.status ?? 200,
          contentType: "application/json",
          body: JSON.stringify(r.json ?? {}),
        });
      }
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "no mock for " + method + " " + url }),
    });
  });
}
