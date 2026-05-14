import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    video: "off",
    headless: true,
  },
  webServer: {
    // Serve the static web-ui with a tiny http-server (uses Node http; see helpers/web-ui-server.ts).
    command: `node tests/playwright/_server.mjs ${PORT}`,
    port: PORT,
    timeout: 10_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
