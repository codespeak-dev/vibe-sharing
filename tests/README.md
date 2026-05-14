# BDD Tests

The test suite mirrors the scenarios in `bdd.cs.md`. Two runners are used:

- **vitest** — unit + integration tests for everything that runs in Node
  (CLI utilities, AWS Lambda handlers, CDK stack assertions, Ink TUI screens
  via `ink-testing-library`).
- **playwright** — end-to-end tests for the static admin web UI
  (`backend/web-ui/*.html`).

## Layout

```
tests/
  features/                 # vitest, one file per BDD feature
    00-path-utilities.test.ts
    01-github-repo-setup.test.ts
    ...
    12-sharing-consent-default.test.tsx   # Ink TUI (uses .tsx for JSX)
    29-cli-redesign-discovery.test.tsx
  helpers/
    cdk-template.ts        # synthesize the CDK stack once per process
    lambda-event.ts        # build minimal API Gateway HTTP API v2 events
    tmp-project.ts         # spin up disposable git/non-git project dirs
  playwright/              # playwright specs (browser end-to-end)
    _server.mjs            # tiny static file server for backend/web-ui
    helpers.ts             # loginAs(), mockApi() for spec files
    17-web-ui-auth.spec.ts
    18-internal-email-management.spec.ts
    19-internal-uploads-preference.spec.ts
```

## Running

```sh
npm test            # vitest run + playwright test
npm run test:unit   # vitest only
npm run test:e2e    # playwright only
npm run test:watch  # vitest in watch mode
```

The first time `npm run test:e2e` runs, playwright needs Chromium installed:

```sh
npx playwright install chromium
```

## What each scenario maps to

Each scenario from `bdd.cs.md` becomes one of:

- **Real test** — exercises the actual code path, asserts the BDD outcome.
  Used for everything we can run in-process or in a controlled environment.
- **`test.skip(title, () => {})`** — declared skipped with a one-line reason
  for why the scenario can't be exercised here (typically: requires a real
  AWS deployment, real Slack webhook, real Cognito user, real DNS, real npm
  registry, or real Cursor SQLite data).
- **`test.todo(title)`** — placeholder for scenarios where the testable
  primitive exists but the integration glue would be too elaborate
  for a stubbed environment (e.g. the full project-discovery TUI flow).

## Coverage by surface

| Surface | Runner | Strategy |
|---|---|---|
| Path utilities, file tree, git state | vitest | Direct unit tests against `src/utils/*` and `src/git/*` using disposable temp directories |
| AWS Lambda handlers (presign, confirm, slack-notify) | vitest | `aws-sdk-client-mock` for AWS calls, `vi.stubGlobal("fetch", ...)` for Slack Web API |
| CDK stack | vitest | `aws-cdk-lib/assertions` `Template.fromStack(stack)` |
| Ink TUI screens (consent, thank-you) | vitest | `ink-testing-library` rendering + `stdin.write()` |
| Static admin web UI (uploads list, internal emails, login redirect) | playwright | Real Chromium against a tiny http server in `_server.mjs`; `page.route()` mocks `/api/*` |

## Why playwright (not jsdom) for the web UI

I tried jsdom first — it's in-process and ~50× faster. But Node 25 ships an
experimental built-in `localStorage` that shadows jsdom's with a stub that
has no methods, and working around it required polyfills that diverged from
how localStorage actually behaves in a browser. The whole point of the BDD
"preference persists in localStorage" scenario is that it persists in a
*real browser*, so playwright + Chromium is the more honest harness.

## Filling in `test.todo`

To convert a `test.todo` to a real test:

1. Replace `test.todo("...")` with `test("...", async () => { ... })`.
2. Reach for the right helper:
   - filesystem fixtures → `helpers/tmp-project.ts`
   - AWS calls → `mockClient` from `aws-sdk-client-mock`
   - CDK assertions → `getStackTemplate()` from `helpers/cdk-template.ts`
   - Ink screens → `render()` from `ink-testing-library`
3. Assert the observable behaviour from the BDD `Then` clause.

See `13-share-url-generation.test.ts` and `08-backend-security.test.ts` for
worked examples of the lambda + CDK style, and `12-sharing-consent-default.test.tsx`
for the Ink style.
