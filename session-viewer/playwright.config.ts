import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_HOME } from "./e2e/fixtures";

const PORT = Number(process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? 3123);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["junit", { outputFile: "playwright-junit.xml" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Precompiled production server (build once, then `next start`) instead of `next dev`:
    // on-demand route compilation under a saturated eval box blows the per-test timeout.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      HOME: FIXTURE_HOME,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
