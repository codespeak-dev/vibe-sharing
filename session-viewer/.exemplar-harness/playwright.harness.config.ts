// The base project ships the full `playwright` package (playwright@^1.59.1), NOT the
// separate `@playwright/test` package. The test runner is exposed at the `playwright/test`
// subpath. Importing from `@playwright/test` here would fail to resolve against the
// toolchain the rubric requires the submission to reuse (T01), making T02 UNGRADABLE.
import { defineConfig } from "playwright/test";
import path from "node:path";

// Harness config: runs the SUBMISSION'S own test files against a server the
// harness controls (no webServer here), so the impl can be swapped between the
// buggy and fixed variants. testDir defaults to the whole app (cwd); override
// with HARNESS_TESTDIR. The gold behaviour test is NOT present in this model.
//
// ADAPT: the submission's Playwright tests are discovered as `**/*.spec.ts` under
// session-viewer. If a submission places its e2e tests elsewhere or names them
// `.test.ts`, set HARNESS_TESTDIR (in harness.sh) or widen testMatch to match.
const port = process.env.CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER ?? "3000";
const td = process.env.HARNESS_TESTDIR ?? ".";

export default defineConfig({
  testDir: path.isAbsolute(td) ? td : path.resolve(process.cwd(), td),
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/node_modules/**", "**/.next/**", "**/.exemplar-harness/**"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
