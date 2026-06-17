# Vibe Sharing — Specification

## Overview

Vibe Sharing is a developer tool for capturing and sharing AI-assisted coding projects. It consists of a CLI tool that packages project files and AI agent session histories into portable archives and uploads them to a secure AWS backend; a web admin UI for browsing and downloading uploaded archives; a session viewer application for exploring AI agent session histories in depth; and a personality analysis subsystem for characterising developer behaviour from session data. The system is designed for non-technical users who need zero-configuration operation, and for developers who need detailed session inspection and analysis.

---

## Foundation

**Stack:** TypeScript, Node.js 22.x, React, Next.js (session-viewer), ink (CLI TUI), AWS CDK, AWS Lambda, API Gateway HTTP API, DynamoDB, S3, Cognito, SNS, CloudWatch, SSM Parameter Store, SQLite, react-markdown with remark-gfm, Playwright.

**Architecture:**
- *Deployment topology:* Serverless AWS backend (Lambda + API Gateway + DynamoDB + S3) fronted by a custom domain (vibe-share.codespeak.dev); CDK manages all infrastructure; web admin UI is a static CloudFront-hosted site with Cognito-gated access; session-viewer is a Next.js development server; CLI is distributed via npm/npx.
- *Communication pattern:* CLI uses presigned S3 URLs for upload (presign → PUT → confirm flow); all Lambda endpoints are routed through API Gateway HTTP API; Slack notifications use SNS topics with Lambda subscribers; CloudWatch alarms publish to an SNS alarms topic.
- *Data model:* DynamoDB stores upload metadata (uploadId, status, timestamp, IP, email, name, repoUrl); S3 stores zip archives; SQLite stores session viewer cache (session metadata, entries, entry tags); SSM Parameter Store stores secrets (Slack webhook URL).
- *Availability mode:* Upload event notifications are fire-and-forget; SNS retries Slack Lambda up to 2 additional times on failure.

**Cross-cutting constraints:**
- No card may ever be permanently hidden or irrecoverably inaccessible in the session viewer — collapsed or grouped cards must always provide an expand mechanism.
- All Lambda functions use Node.js 22.x runtime.
- Secret redaction is a v1 requirement; transcripts routinely contain pasted secrets and must be sanitised before packaging.
- The CLI tool must be usable by non-technical users who will abandon at the first point of friction — failures must never surface as raw stack traces or silent exits.
- Secrets and credentials belonging to the tool operator must never be present on the user's machine.
- Installation must require as few dependencies as possible, ideally zero steps for the end user.

---

## Features

### CLI Tool (`codespeak-vibe-share`)

**Distribution and invocation:** Distributed via npm as `@codespeak/vibe-share`; invocable as `npx @codespeak/vibe-share` with no prior installation. The bin field maps the command name `codespeak-vibe-share` for global installs. The entry point must include a Node.js shebang (`#!/usr/bin/env node`). The package publishes only the compiled `dist/` directory. A `prepublishOnly` script runs TypeScript compilation before publish. Version numbering follows semver.

**Project detection:**
- Detects whether the current directory is under Git version control.
- Correctly identifies the project root when invoked from any subfolder, including projects without a `.git` directory. When git-based root detection fails and the cwd is a subfolder, the tool must not silently use the wrong encoded path for session lookup.
- For Git projects: produces `git status`, two separate git diff files (unstaged changes and all uncommitted changes vs HEAD), a recursive file listing, a git bundle with all refs (`--all`), and an `untracked/` directory containing untracked non-gitignored files.
- For empty Git repositories (no commits): captures all files as untracked via `git ls-files --others --exclude-standard` and archives them under `project/untracked/`.
- For Git repositories where bundle creation fails (shallow clone, corrupted refs): tracked file paths appear in `file-listing.txt` and untracked files are included if selected; the system degrades gracefully. `createGitBundle()` catches errors and returns null; bundle inclusion is gated on a null check.
- For non-Git directories: walks the directory using exclude patterns without invoking the git bundle code path.

**Session discovery:**
- Locates Claude Code session directories at `~/.claude/projects/<encoded-path>/`, including all subagent session files and `tool-results/` directories.
- Discovers sessions across all Git worktrees associated with the same repository; sessions from all worktrees are collected and presented together. Branch information for each worktree is read directly from `.git/worktrees/<name>/HEAD`.
- Supports Codex and Gemini session discovery in addition to Claude Code.
- When the session directory layout is unknown, suggests candidate directories by searching for files referencing the project path rather than requiring manual path entry.
- If no supported agent session is found, the heuristic worktree-based discovery is the supported path; manual filesystem browsing is not offered.

**Archive construction:**
- Archive filename is derived from the repository name extracted from the git remote URL (supporting SSH, HTTPS, and other formats, stripping `.git` suffix); falls back to the project folder name when no remote is available. Format: `<reponame>-<timestamp>.zip`.
- Archive layout mirrors the real `.claude` folder hierarchy under `sessions/.claude/`, preserving `projects/<encoded-path>/`, `plans/`, and `debug/` subdirectories.
- Zip entry paths for all files are computed using the archive root and relative path resolution.
- Archive filenames must not include any `vibe-share` prefix or infix.
- Plan files referenced in session transcripts (detected via grep) are copied into `sessions/.claude/plans/`.
- Debug files referenced in session transcripts (detected via grep, pattern `.claude/debug/<uuid>.txt`) are copied into `sessions/.claude/debug/`.
- Only referenced plan and debug files are included — orphaned files are excluded.
- Project files are filtered to exclude secrets (`.env` files, key files, sensitive content), dependency directories (`node_modules`, `venv`), and gitignored files.
- Binary file detection or per-file size limits prevent accidental inclusion of large binaries.
- Symlink handling prevents external file leakage and infinite directory walk cycles.
- Archive size estimation sums: for Git repos — text output sizes, git bundle file size, and untracked file sizes; for non-Git repos — all project file sizes. The total is initialised with the project size estimate, not zero.

**Secret protection:**
- Four-layer approach: secret file exclusion, gitignore filtering, transcript redaction patterns, and limitations documentation.
- Sensitive keys found in session data are masked/redacted before inclusion in the archive — raw secret values are never packaged.
- A `(best effort)` qualifier appears in all secrets-protection messaging to set accurate expectations.

**Upload flow:**
- Checks backend availability via the health endpoint before proceeding; falls back to local zip save if the backend is unreachable.
- Backend URL defaults to `https://vibe-share.codespeak.dev`; overridable via `VIBE_SHARING_API_URL` environment variable.
- Pre-populates email and username from git config at startup; prompts only when git config values are absent.
- Auto-detects git remote URL to pre-populate the repo URL field; skips the repo URL prompt entirely when no git remotes are configured.
- Metadata fields (email, name, repo URL) are optional and do not block uploads.
- Generates a correlation/request ID that flows through each step of the upload journey.
- Writes a local diagnostic log file on every run with timestamped debug output.
- On upload failure, displays which step failed, suggests `--output` flag for local saving, and suggests `--verbose` for detailed diagnostics. With `--verbose`, displays full error cause chain including HTTP status code and response body.
- Automatically sends error telemetry to the backend on failure, capturing error type, failure step, OS version, Node version, and sanitised error message. Telemetry payloads contain no PII or sensitive content.
- Post-upload messaging does not display a download URL.

**Privacy and consent:**
- Displays a clear privacy notice before any file packaging or upload, explaining data collection, use, and that no credentials are shared. The notice is warm, reassuring, and prominently displayed.
- Requires explicit user confirmation before uploading. The sharing consent prompt defaults to `Y`.
- Provides a review option before sharing.

**Local zip fallback:** When the backend is unavailable or the user declines upload, produces a local zip file.

**Platform support:** macOS, Linux, and Windows without platform-specific setup.

**Claude Code plugin:** A Claude Code slash command (`/vibe-share`) invokes the tool in `--scan` mode. The plugin installation path resolution correctly finds the script before executing. Plugin infrastructure files (`.claude-plugin/`) are not specially excluded from archives.

**Modes:**
- *Scan mode:* Reports counts of session transcripts, plan files, and debug files found in the project.
- *Build mode:* Collects and packages all referenced sessions, plans, and debug files into a zip archive; outputs a build report with session count, plan count, and debug count.
- *Review mode:* Previews the contents of the packaged zip archive.

**Test requirements:**
- After publishing, run `npx codespeak-vibe-share --version` to verify the package installs and executes correctly.
- Run `npm pack --dry-run` before publishing to verify only `dist/` files are included.

---

### AWS Backend

**Infrastructure (CDK):**
- All infrastructure defined in AWS CDK; deployable via CDK CLI commands with no AWS Console interaction.
- Stack deployed to `eu-north-1`. CDK stack `env` configured with explicit account and region.
- Lambda functions bundled via esbuild within CDK; CommonJS module format.
- A `cdk-deploy` script in `scripts/` invokes CDK deploy with auto-approve automatically.
- An `.envrc` file at the project root sets `AWS_PROFILE` to `'default'` and is automatically sourced by direnv; unset when leaving the directory. The `scripts/` directory is also added to PATH via `.envrc`.
- Bootstrap must be run with an explicit environment argument (`aws://ACCOUNT_ID/REGION`) when no `cdk.json` is present in the current directory.
- Default deployment region is sourced from a configuration file rather than hardcoded inline.
- Configuration values (CORS origins, alarm email, SSM parameter name) are extracted to a shared `config.ts` file.

**API endpoints:**
- `POST /presign`: validates request, generates an S3 PUT presigned URL, stores upload record in DynamoDB, publishes upload-requested event to SNS. Accepts optional reporter payload (email, name, repo URL). Upload file size capped at 5 GB.
- `POST /confirm`: verifies the S3 object exists via HeadObject (requires `s3:GetObject`), marks upload confirmed in DynamoDB, publishes upload-confirmed or upload-failed event to SNS.
- `GET /health`: returns status ok.
- `GET /api/v1/uploads`: returns confirmed uploads with presigned download URLs (1-hour expiry); protected by Cognito JWT authorizer.
- `POST /telemetry`: receives CLI error payloads and stores or forwards error data.
- API Gateway HTTP API with throttling; rate limiting at 10 requests per minute per IP.

**S3:**
- Stores all uploaded zip archives indefinitely with no lifecycle expiry or automatic deletion.
- CORS allowed origins sourced from `s3CorsAllowedOrigins` in config (supports wildcard patterns, e.g. `*.codespeak.dev`).
- Presigned PUT URLs enforce Content-Type `application/zip` via AWS SDK v3 `getSignedUrl`; S3 rejects mismatched Content-Type with 403.

**DynamoDB:**
- Stores upload metadata: `uploadId`, `status`, `timestamp`, `IP`, `email`, `name`, `repoUrl`, `s3Key`.
- Point-in-time recovery enabled via `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`.
- Presign Lambda IAM: `dynamodb:PutItem` only. Confirm Lambda IAM: `dynamodb:GetItem` and `dynamodb:UpdateItem` only.

**IAM:** Least-privilege — only permissions actively used are granted. `s3:GetObject` (not `s3:HeadObject`) is the correct permission for HeadObject API calls.

**CORS:**
- API Gateway `allowOrigins` uses `corsAllowedOrigins` from config: explicit domain list without wildcards (e.g. `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`). API Gateway HTTP API v2 does not support wildcard characters in `allowOrigins`.
- S3 CORS uses `s3CorsAllowedOrigins` which may include wildcard subdomain patterns.

**CloudWatch alarms:**
- Alarms trigger on: Lambda errors exceeding 5 in 5 minutes; API 4xx errors exceeding 50; API 5xx errors exceeding 5.
- All alarms configured with both `addAlarmAction` and `addOkAction` so recovery events produce notifications.
- Notifications published to an SNS alarms topic delivering to `alarms@codespeak.dev` email and to the Slack webhook Lambda.

**Upload events SNS topic:**
- Separate from the alarms SNS topic.
- Presign Lambda publishes upload-requested events (filename, size, IP, user info); confirm Lambda publishes upload-confirmed or upload-failed events (filename, size, share URL). Both are fire-and-forget.
- A shared helper function is used by both Lambdas to publish notifications, avoiding duplicated SNS publish logic.
- Both Lambdas have IAM permission to publish to this topic; its ARN is passed via environment variables.
- No email subscription on this topic — Slack only.

**Slack notification Lambda:**
- Retrieves webhook URL from SSM Parameter Store at `/vibe-share/slack-webhook-url` (SecureString); requires `--overwrite` on parameter creation to avoid `ParameterAlreadyExists` errors.
- Caches webhook URL with a 5-minute TTL; invalidates cache immediately on receiving an error response from Slack.
- Throws on Slack delivery failure so SNS treats delivery as failed and retries (up to 2 additional times).
- Logs a warning and continues gracefully if the SSM parameter is absent (so email alerting is unaffected).
- Top-level Slack message is human-readable plain text; thread reply contains full structured data as pretty-printed JSON in triple-backtick code fences.
- Each upload event generates its own independent Slack thread.
- Initial message includes user name, email, and repository URL.
- For uploads from internal users (determined by querying `InternalEmailsTable` at notification time with no caching), the top-level message is prefixed with the `:codespeak:` emoji.
- Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first claims thread creation; the other polls until completion.
- CloudWatch alarm notifications follow the same message structure: human-readable top-level with JSON in thread reply.
- The `slack-notify` Lambda has read access to `InternalEmailsTable` and receives its table name via environment variable.

**Alarm email:** Stored in version-controlled `config.ts` (non-sensitive); not stored in SSM.

**`backend/README.md`:** Documents setup, configuration, SSM parameter creation, and usage including the requirement to create `/vibe-share/slack-webhook-url` before deploying the Slack Lambda.

---

### Custom Domain and DNS

- ACM SSL certificate provisioned for `vibe-share.codespeak.dev` with DNS validation.
- API Gateway custom domain mapping configured to point `vibe-share.codespeak.dev` to the existing API Gateway regional endpoint.
- DNS records configured manually at the external registrar (not via Route 53 automation).
- CDK outputs expose the custom domain target and hosted zone ID.
- The custom domain name is defined exactly once in the codebase.

---

### Web Admin UI

**Authentication:** Amazon Cognito user pool with hosted domain for OAuth. Self-registration enabled for `@codespeak.dev` email addresses only. A pre-sign-up Lambda validates the email domain, rejects non-`@codespeak.dev` addresses, and delegates verification to Cognito's built-in flow (does not auto-confirm or auto-verify). Email delivery uses Amazon SES (configured in `us-east-1`, `us-west-2`, or `eu-west-1`) to avoid the Cognito default sender's 50-email/day cap. Users receive a temporary password via email and must set a permanent password on first login.

**Infrastructure:**
- CloudFront distribution serves the static web UI at `https://admin.vibe-share.codespeak.dev`.
- ACM certificate for `admin.vibe-share.codespeak.dev` created in `us-east-1` (CloudFront architectural requirement); imported into the CDK stack and attached to the CloudFront distribution as an alternate domain name.
- Cognito callback and logout URLs set to the CloudFront domain.

**File browsing:**
- Authenticated users can browse and download uploaded files.
- `GET /api/v1/uploads` returns confirmed uploads with 1-hour presigned download URLs.
- The download link in Slack notifications points to a URL that prompts Cognito login if unauthenticated, then immediately starts the download.

**Internal email management:**
- User emails can be flagged as internal; internal data is persisted in a database (`InternalEmailsTable`).
- Internal emails are filtered out from the main user table by default; a checkbox toggle shows or hides them.
- A per-row button on the main table marks a user's email as internal.
- A dedicated page allows adding emails to the internal list.
- Internal upload rows display a 🛠️ wrench emoji prepended to the filename and use a grey background (`#f0f0f0`, hover `#e8e8e8`).
- The `Show internal uploads` checkbox state is saved to and restored from `localStorage`.

**User management:** A `create-user` script accepts an email argument, resolves the Cognito User Pool ID from CDK stack outputs, and invokes `admin-create-user` via AWS CLI.

**GitHub URL normalisation:** All recognised GitHub URL formats (HTTPS with/without `.git`, SSH `git@github.com:`, `git://`, URLs with trailing paths) are normalised to a `user/repo` display label rendered as a hyperlink to `https://github.com/user/repo`.

**UI:**
- Simple design; no elaborate styling required.
- User email address and repository URL displayed in the UI.
- GitHub URLs displayed in shortened `user/repo` format as a clickable link.

---

### Operational Scripts

**Status script (`status.sh`):** Queries DynamoDB and displays all upload records in a formatted table. Columns (in order): NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. SIZE is human-readable (e.g. `2MB`). Timestamps in ISO 8601. CONFIRMED shows `-` when absent. Lambda log fetching is opt-in via `--logs`.

**Clear-uploads script:** Displays count of items to be deleted, requires the user to type `delete all` exactly as confirmation, then deletes all DynamoDB records and all S3 objects in a single script invocation.

**Header:** `=== DynamoDB Uploads ===` followed by total record count.

---

### CLI TUI (ink-based)

The CLI uses ink (React for terminal) as its TUI framework.

**Project list screen:**
- Opens immediately on launch regardless of entry point or current directory.
- Scans agent directories on startup to collect all known project/workspace paths.
- If the current working directory falls under a listed project, that project is marked `(current dir)` and sorted to index 0.
- Displays all discovered projects; worktree entries for the same git repository are merged into a single entry with combined agent lists and aggregated session counts.
- Projects sorted by total session count across all agents, descending.
- Greeting by first name sourced from git config when available.
- Shows `Share another project:` heading after one or more projects have been shared.
- Includes a `Share another project` option.
- Scrollable when entries exceed visible terminal height.

**Project share screen:**
- Displays project path, repo URL if present, agents used with session counts per agent (including all worktrees), file count and lines of code broken down by programming language (by file extension), total commit count across all branches, untracked file count, and tracked-but-uncommitted file count.
- Excludes `node_modules`, `venv`, and similar dependency/virtual-environment folders and gitignored files from file and LOC counts.
- Displays worktree count.
- Shows a welcome header when it is the first screen the user sees.
- Escape navigates to the project list screen.
- Shows a legend with Shift+Enter for primary action and Esc for back.

**Consent screen:**
- Displays CodeSpeak's data use terms (permission to study the project, no commercial software built from the code, retraction via `support@codespeak.dev`).
- Enter (prominent) confirms consent; Esc (secondary) dismisses.

**Review before sharing screen:**
- Has a Sessions tab (and Code and git tabs).
- Sessions tab: when `SESSION_PREVIEW_ENABLED` (`VIBE_SHARING_SESSION_PREVIEW` env var, default false) is disabled, displays a static read-only list of agent names and session counts; when enabled, renders an interactive agent list that drills into a full agent tab with session preview.
- Sessions tab is only shown if the project has agents.
- Code tab: navigable file tree; files excluded from sharing explicitly marked `Not Shared`; `Not Shared` folders cannot be opened; Enter on a file previews its text content.
- git tab: git branches and commit list per branch.
- Prominent Share CTA; back action returns to share project screen.
- Focus zone state cycles through: tabs, content, action buttons. Only the active zone processes keyboard input. Tab key cycles between zones. Down arrow in tabs zone moves focus to content zone. Up/down at content list boundaries move focus to adjacent zone.
- Tab component displays cyan color, bold text, and cursor indicator only when its content zone is active; dimmed styling when inactive.
- ScrollableList `active` prop gates keyboard input handling.
- Legend at bottom indicating Tab key navigation and available shortcuts.

**Post-share screen:**
- Thank You box with `Share Another` as default highlighted action and `Quit` as secondary.
- Deletion instructions appear as a footnote outside the Thank You box.

**Session preview:**
- Pressing Esc while previewing a file's contents returns to the Files tab of the Preview screen.
- Opening a session displays its messages; sessions with empty names display a fallback label.
- Claude session first messages have `<ide_*>` tags stripped before display.

**Navigation:**
- Arrow keys and Enter for navigation and selection throughout.
- Shift+Enter triggers the primary action on the focused element.
- Escape binding indicated on the Back button; Shift+Enter binding indicated on the primary action button.
- `GO_PROJECT_LIST` action clears navigation history; `currentProjectPath` is only set on initial load.

**Progress:** Progress bars displayed during long-running operations.

**Feature flag:** `SESSION_PREVIEW_ENABLED` controlled via `VIBE_SHARING_SESSION_PREVIEW` environment variable; defaults to false. Agents section in share-project screen is always visible regardless of flag state.

---

### Session Discovery (Core Library)

**Claude Code:** Scans non-indexed JSONL files in addition to the sessions index. Project filtering reads working directory only from user-type messages. Empty `firstPrompt` strings are converted to null at the provider level. Worktree session files are located via `findClaudeSessionFile` lookup.

**Cursor:** Locates workspace via `findWorkspaceStorageDir` scanning `workspaceStorage/*/workspace.json`. Extracts all composerIds for a workspace from `workspace state.vscdb` via `getWorkspaceComposerIds`. Discovers plans from registry via `discoverPlansFromRegistry` querying `composer.planRegistry` in global `state.vscdb`, merged with blob-scanning so both discovery strategies always run. Recovers orphaned workspaces (no valid `workspace.json`) by extracting paths embedded in `store.db` blob data via regex matching the path followed by a newline or quote character, validated with a directory existence check. Includes Composer sessions by querying `composer.composerData` from `state.vscdb` files in `~/Library/Application Support/Cursor/User/workspaceStorage/`. Deduplicates Composer sessions using seen identifiers.

**Cursor archive construction:** Copies `store.db` SQLite files wholesale rather than extracting individual JSON blobs. Creates a filtered `state.vscdb` extract (1 per project) containing `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData UUID` entries from `cursorDiskKV`; extraction uses `sqlite3 CLI` with `-readonly` flag. Generates a `discovery-manifest.json` with intermediate findings (hashes, slugs, composerIds, plan matches, original paths, algorithms). Archive replicates the `.cursor` subtree structure.

**Gemini:** Protobuf extraction is best-effort file-level only; grepping binary protobuf files for path strings is unreliable without a proto schema.

**AgentProvider interface:** Includes an optional `getArchiveRoot` method returning the root directory path for archive operations. The Claude provider implements `getArchiveRoot` returning the `~/.claude` directory path.

**Worktree discovery:** Works on archived repos without requiring git command availability. `get_worktree_info()` reads from `.git/worktrees/<name>/HEAD` to extract branch refs and return path+branch pairs.

**Session filtering:** `findSessions()` supports optional filtering by agent type so only sessions from specified agents are returned; filtering occurs at the discovery level.

**Non-goals for discovery:**
- Manual filesystem browsing and file picking for session selection.
- Human-readable JSONL extraction of Cursor database contents.

---

### Session Viewer (Next.js Application)

The session viewer is a Next.js application in the `session-viewer/` directory. It imports session discovery logic from the parent project's compiled `dist/` rather than duplicating it.

#### Data Layer and Caching

**SQLite cache** stores session metadata, session entries (with `cwd`, `type`, `timestamp` columns with `cwd` indexed), and entry tags (tool uses, plan refs). The database is stored at the project repository root (one level above `session-viewer/`), resolved via `process.cwd()` navigating one level up (not `import.meta.dirname`, which resolves to the compiled `.next` directory at runtime). All three files (`.session-viewer-cache.db`, `.db-wal`, `.db-shm`) are excluded from version control.

**Cache ingest logic** is centralised in the cache database module, colocated with `SessionEntry` type definitions, and not duplicated across routes.

**Session entries API** serves paginated results from SQLite rather than parsing JSONL files on each request. `cwd` column is indexed for fast project-path filtering.

**Project discovery cache:** `discoverAllProjects()` results (agent directory scans, git worktree list output) are cached in SQLite with a 30-second TTL. First load and subsequent loads within TTL window are fast.

**Session detail page:** Server component pre-loads all session entries and passes them as props to the client component. The server component is `force-dynamic`. Metadata is retrieved via single-file read (message count, creation/modification timestamps, file size) without scanning other sessions. Session discovery data and metadata are fetched in parallel.

**Rebuild Index button:** Triggers a full re-index of all session JSONL files, populates `visual:` tags across the entire dataset, and returns results to the UI after completion.

#### Session List (Project Page)

- Sessions are displayed in a single-column list sorted by last message timestamp, most recently active first.
- Each session card shows: AI-generated title (from `ai-title` entry type) or fallback preview; agent name badge; plan badge (purple) when the session contains plan file references; start timestamp, end timestamp, and duration.
- Timestamp display rules: 24-hour format; same-day sessions show date once with both times and duration; multi-day same-year sessions show month/day for both endpoints; cross-year sessions show full date including year; single-timestamp sessions show date/time only with no arrow or duration.
- Message and prompt counts displayed as `XX msgs (YY prompts)`; user prompt count excludes entries where all content blocks are `tool_result`.
- Session card container navigates to the session via `onClick`/`router.push`; plan badge navigates independently to the plan entry via anchor element with `stopPropagation`.
- Project page displays only Claude Code agent sessions.

**Single-pass JSONL scanning** extracts session titles, plans, and prompt counts in one read per file. Session plan detection scans for `~/.claude/plans/` path references in actual `tool_use` blocks of type `Write`, `Read`, or `Edit` — not textual mentions in `tool_result` content.

#### Session Detail Page

**Navigation:** URL hash targets a specific entry. Hash is parsed after client-side mount. `CollapsedGroupView` and `TopicalGroupView` check if they contain the target entry and auto-expand if matched. `EntryCard` receives `forceExpanded=true` when its entry matches `highlightEntry`. `SessionClient` threads `highlightEntry` through `DisplayItemView` to child components via prop-drilling. Highlighted entry state is read synchronously during initial render (not in a post-mount effect). A `hashchange` event listener handles both initial load and same-page hash navigation.

`PlanBadge` on the session detail page uses a button element that assigns directly to `window.location.hash` to fire the native `hashchange` event. Session card plan badges on the project page use plain anchor tags.

Scroll to target element is deferred until after both React's commit phase and the browser's paint phase using nested `requestAnimationFrame` callbacks. The scrolled flag is set only after a successful scroll to a real DOM element.

All same-origin internal navigation uses Next.js `Link` component (not plain anchor tags).

**Session metadata display:** AI-generated title as heading; agent name badge and plan badge; session ID in monospace; stats row (message count, prompt count, date/time range with duration, file size). Shared `SessionStats` component used by both session card and session detail page.

**Model display:** Most frequently used model displayed at session level in format `Models: <model> x<count> (default) ...` sorted by usage descending. Individual cards show model label only when it differs from the session-level most common model.

#### Three-Layer Display Pipeline

Card display is computed in three ordered layers:

1. **Per-card defaults:** Each card is classified with `isPrimary` and `defaultExpanded` flags based on signal level and card type.
2. **Topical grouping (Layer 2):** Consecutive semantically related cards (tool-call cycles, progress runs) are merged into topical groups. A tool_use entry that has a matching tool_result is always grouped with that result, regardless of what entries appear between them. Topical groups form only when they contain two or more cards; single-card sequences remain standalone. Filler entries join an active topical group. Thinking entries do not initiate or bridge groups with agent tool result cards.
3. **Collapsed-group formation (Layer 3):** Between any two primary-interest cards there is at most one collapsed group, regardless of the quantity or variety of non-primary-interest cards. A topical group acts as a single unit inside a collapsed group.

**Primary-interest cards** (expanded by default and not placed inside collapsed groups): user prompts, agent questions, answers to AskUserQuestion/ExitPlanMode, plans, completion reports.

**Collapsed group headers:** Left side: `▸ XXX cards` (e.g. `▸ 47 cards`). Middle: tool-call breakdown in `N ToolName` format (e.g. `3 Subagent`, `8 Bash`). Right side: duration (adaptive formatting — milliseconds only for sub-second, seconds only under one minute, minutes and seconds otherwise). Duration is computed from the span between earliest and latest timestamps among the group's entries. The `other` group does not display duration. Topical group summaries display tool name and count (e.g. `1 Read` or `3 Read, 2 Bash`). The term `Subagent` is used throughout (not `Agent`).

**Visual grouping:** Collapsed groups use `bg-blue-950/20` background with `border-blue-900/30` border. Topical groups use `bg-indigo-950/15` background with `border-indigo-900/30` border when expanded.

**Auto-expansion:** When a collapsed group is expanded and contains exactly one topical group as its sole child, that topical group expands simultaneously. Groups containing only queue-operation entries auto-expand on initial render. The reapply-key mechanism resets expanded state only in response to actual reapply-key changes, not on initial mount (tracked via ref).

**Eager pagination:** All entries load automatically in sequence without requiring user scroll interaction. Once a page completes loading and more entries exist, the next page is fetched immediately.

**Expand All** and **Re-apply Filter** controls are available in the session view interface.

#### Card Types and Rendering

**User messages:** Displayed expanded by default. Blue background scheme (`bg-blue-950/50`, `border-blue-700/40`). Plain text (no markdown). Blue role badge.

**Tool-result messages** (user messages where all content blocks are `tool_result`): Collapsed by default. Amber `tool result` badge in header.

**Assistant messages:** Green background scheme (`bg-green-950/40`, `border-green-800/40`). Green role badge. Text blocks render as GitHub Flavored Markdown (headings, lists, code blocks, tables, bold, italic, inline code).

**Thinking blocks:** Tagged with a secondary tag label. Collapsed state shows a content preview.

**AskUserQuestion:** Rendered as a set of options with radio buttons; selected option is visually marked. `Other` option rendered as a radio button consistent with others; if selected, its radio button is marked selected and any user comment displayed with attribution. `toolResultMap` maps `tool_use_id` to result content string. Free-form answers that match no predefined option are displayed as fallback output. For `multiSelect`, all selected options are marked.

**ExitPlanMode:** Rendered expanded by default. Four distinct answer types: `Approved`; `Keep planning`; `Cancel` (no comment); `Other` (free-form comment not tied to specific plan sections). When the user provides feedback on specific plan sections, the response option selector is hidden. Distinguishing condition between `Cancel` and `Other` is the presence of a user-provided comment.

**Plan file interactions:** `Write`/`Edit` tool_use blocks targeting `~/.claude/plans/*.md` render the file's markdown content with a plan name header (e.g. `Plan: snug-sprouting-kahan`) using purple-tinted Tailwind typography styling. `Read` tool_result blocks for plan files also render markdown. Markdown tables render as formatted HTML tables via `remark-gfm`. Purple badge added to entry cards referencing plan files.

**Edit tool_use blocks (non-plan):** Rendered as unified diff. Line-level comparison via LCS algorithm; removed lines prefixed `-` colored red; added lines prefixed `+` colored green. Changed substrings within lines identified via character-level common-prefix/suffix algorithm and highlighted with brighter/more intense version of line color.

**Subagent cards:** Cyan-tinted container styling. Type and description in the card title bar. Card body shows: `Prompt` heading above prompt markdown content (no description repetition); standalone `Worked for XXs` duration label between prompt and result sections; result content rendered as markdown. Elapsed time computed between tool_use message and corresponding tool_result. Each subagent card enriched with its corresponding result data from a later tool_result card. Each subagent tool_result card includes a link back to its corresponding tool_call card. Subagent tool calls group together only when the tool_use and its result are separated exclusively by progress cards and other filler entries (not thinking entries).

**TodoWrite cards:** Classified with a dedicated `todo-write` entry tag; grouped topically only with other TodoWrite entries. Rendered with status icons: `·` pending, `▶` in progress, `✓` completed, `✗` cancelled. Card header shows `[completed/total]` ratio badge, then up to two change parts as inline status icon + truncated item text; when more than two todos are affected, a count-based summary (e.g. `3 completed, 1 added`). First TodoWrite call shows a status breakdown when non-pending items are present. Topical group headers for pure-TodoWrite groups display the same rich summary format as individual card headers. Mixed-tool group headers retain count format (e.g. `3 TodoWrite, 2 Read`). Todo items matched by `content` field for diff computation. Diff uses green for added items and blue for status-changed items.

**ai-title cards:** Title text in card header; no card body.

**FileSnapshot cards:** Cards with no tracked files show `no files tracked` in the card header with no body. Cards with tracked files render an expandable file list in the card body.

**IDE context tags (`<ide_*>`):** Rendered as grey clickable badge elements with monospace font and angle bracket notation (e.g. `<ide_opened_file>`). Clicking toggles expanded state to show/hide full tag content in a scrollable panel. Long paths truncated from the beginning with `...` prefix. CWD prefix replaced with `$CWD`. Collapsed badge shows first 60 characters of first line with truncation and CWD substitution applied.

**Tool call headers:** Bash commands: trailing truncation preserving the command start. File paths: leading ellipsis truncation. Tool names: amber badges. Tool result headers: tool name and file path looked up from tool metadata map. `projectPath` is threaded from server component through the component hierarchy; `cwd` derived from `projectPath` with fallback to `entry.raw.cwd`.

**Message timestamps:** Display date, hours, minutes, and seconds; positioned at the right-most end of the header row via `margin-left: auto`; visible in both collapsed and expanded states. Rendered/JSON toggle buttons are only visible when the entry is expanded and positioned to the left of the timestamp.

**Tool block headers:** Display identical content in both collapsed and expanded states (no information added or removed on expand).

**Tool call/result blocks:** Expanded by default when the parent entry is opened. When a tool result block is expanded, file contents within are also expanded automatically.

#### Filter System

**FilterState** is persisted to `localStorage` and loaded on initialisation. Filter controls reflect the current active filter on load.

**Per-tag filter controls** independently override card expansion state and visibility promotion while preserving structural grouping. Logical grouping is a structural property and is not subject to per-tag filter override. Collapsing an expanded filter tag pill updates the conversation entries to reflect the new filter state.

**Filter pill visual states:**
- Active/on: filled category-specific background with colored text.
  - Tool calls: `bg-[#3d2f0f] text-yellow-300`; Prompts: `bg-blue-900 text-blue-300`; Plans: `bg-purple-900 text-purple-300`; Progress/queue ops/file snapshots: `bg-neutral-800 text-neutral-400`; AI title: `bg-cyan-900 text-cyan-300`.
- Off/disabled (non-primary): `bg-neutral-900` grey background, colored border matching category color, `text-neutral-600` grey text (outlined appearance).
- Customised pills: amber ring indicator.

Tag pill left side (tag name) bright when primary, dim when collapsed. Right side chevron reflects current expanded/collapsed default state.

**DisplayOverrides** object threads per-tag customisations through the pipeline functions (`classify`, `isPrimaryItem`, `buildLayer2`, `buildLayer3`, `buildDisplayItems`) without restructuring core grouping logic. `FilterState` is converted to `DisplayOverrides` format before being passed to `buildDisplayItems`.

#### Message Type Registry

- A dedicated registry page enumerates all known message types with real example instances sourced from the cache database.
- Each message type or card type must expose search criteria (filters, matchers, or identifiers) that can locate relevant messages in the cache. Adding a new type without exposing search criteria causes a compile-time enforcement failure.
- `SQL` query for `getInstancesByTag` uses `COALESCE` to fall back to a sibling entry's `cwd` when the current entry's `cwd` is null (covering `last-prompt`, `ai-title`, and similar types).
- Initial registry data load is server-side (DB query); client-side fetching only for pagination load-more.

#### Session Viewer — Dark/Light Theme

- Supports dark and light color schemes.
- A theme toggle control is accessible on every page.

#### Session Viewer — Diff Rendering

- Unified diff format with per-line syntax.
- Within each changed line, the specific changed substring is highlighted at the character/token level with a distinct color on the exact added or removed characters.

#### Test Requirements

- Playwright E2E tests in `tests/scroll-to-entry.mjs` cover navigating directly to a URL targeting a specific card not visible by default; assert that the card receives the highlight ring styling class and the viewport scrolls to it.
- Navigation tests simulate real user flow by clicking Next.js `Link` elements rather than using `page.goto()`.
- Forward navigation tests assert that content is visible immediately on first check with no stuck loading state.
- Tests runnable via the existing `test` script in `package.json`; assume dev server on port 3000.

---

### Personality Analysis (`vibe-personality`)

**Purpose:** Detects and quantifies developer personality traits from code, git history, and Claude Code agent sessions. Currently Claude Code sessions only.

**Structure:**
- Central tracking file at `intent/vibe-personality/TRACKING.md`.
- Per-metric plan files in `metrics/` subdirectory.
- Prompt templates at `prompts/plan.md`, `prompts/implement.md`, `prompts/test.md`, `prompts/done.md`, `prompts/sync.md`.
- General instructions in `intent/vibe-personality/CLAUDE.md`.
- All 49 raw candidate metrics from `vibe-personality.md` have corresponding rows in `TRACKING.md`.

**TRACKING.md:**
- Each metric row shows: status emoji, metric name, visible inline definition/description, and a clickable `cursor://` link to the appropriate stage prompt.
- Links advance to the next stage's prompt as metrics progress.
- A clickable `🔄 Sync` link at the top opens Claude Code with instructions to diff `vibe-personality.md` against `TRACKING.md` and surface missing metrics for human review before addition.

**Impatience metric (`metrics/impatience.md`):**
- Detects three signal types: sequence interruptions (user-prompt appearing after tool-cycle-group), explicit tool rejections (error-flagged events with rejection content), and orphan `tool_use` events (tool_use with no matching tool_result).
- Calculates three normalised rate metrics: impatience events per user message, impatience events per minute, and tool rejection rate as a ratio.
- Uses `buildSegments()` grouping utility from `grouping.ts`.
- Implementation lives in `src/personality/impatience.ts`.

**Permission observability (`intent/vibe-personality/permissions.md`):**
- Claude session JSONL records permission prompt events, permission mode switch events, user agreement/decline/alternative responses, and successful tool executions.
- No explicit field distinguishes user-clicked approval from auto-approval; this is an architectural limitation of the Claude Code client.
- Auto-approval can be approximated using the `permissionMode` field combined with `permissions.allow` patterns from `settings.json`.
- User rejection is definitively detectable via `is_error` `tool_result`.

**Test requirements for personality metrics:**
- Synthetic test entries covering each of the three impatience signal types.
- Real session validation confirming metric produces sensible values.
- Edge case coverage for ambiguous signals (e.g. orphan `tool_use` caused by system errors).

**Non-goals:**
- Non-Claude coding agent support (Cursor, Cline) in the first version.
- Full 32-archetype named type system in the initial implementation.
- V.I.B.E.S. trait-level or sub-signal-level tracking granularity.
- Threshold classification for impatience levels; weighting scheme across signal types.

---

### Session Log Extraction Script

A self-contained executable script that:
- Reads all Claude session log files for the current project from `~/.claude`.
- Extracts: user messages, `AskUserQuestion` tool prompts, user answers, `ExitPlanMode` requests with plan approval/rejection results, TODO creation and status change events, and Claude implementation-completion messages.
- Writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters.
- Additionally writes one per-session file per session into `intent/sessions/`, each containing only that session's extracted items separated by `==========` delimiters.
- Output is Markdown format with entries sorted chronologically.

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected in favour of AWS CDK because SST is not officially AWS-supported.
- **S3 lifecycle rule auto-deleting uploads after 90 days** — rejected; all uploaded data must be retained indefinitely.
- **Auth0 for authentication** — considered as external authentication provider; not selected in favour of AWS-native Cognito.
- **Cloudflare Access with email OTP** — required DNS migration to Cloudflare; not selected. Shared password via CloudFront and Lambda@Edge — does not support per-user access control; not selected.
- **AWS Chatbot integration for Slack notifications** — involves manual OAuth setup in the AWS Console; rejected in favour of Slack webhook Lambda to retain formatting control and avoid AWS-managed service dependency.
- **Storing the Slack webhook URL in a configuration file** — rejected in favour of SSM Parameter Store to avoid exposing sensitive credentials in source code.
- **Using `s3:HeadObject` as the IAM action for HeadObject API calls** — `s3:HeadObject` is not a valid IAM action; the correct permission is `s3:GetObject`.
- **Admin-only user creation** — replaced by allowing self-service sign-up restricted to the `@codespeak.dev` domain.
- **Pre-sign-up Lambda auto-confirming and auto-verifying users** — bypassed Cognito's native verification flow, allowing unverified accounts; removed in favour of delegating verification to Cognito's built-in flow.
- **Cognito default email sender** — has a 50 emails/day hard cap, high spam classification rate, and is blocked by corporate email filters; replaced with Amazon SES.
- **Route 53 CDK automation for DNS** — not applicable because DNS is managed through an external registrar.
- **Using wildcard subdomain pattern in API Gateway HTTP API v2 `allowOrigins`** — API Gateway V2 does not permit wildcard characters in CORS `allowOrigins` values; deployment fails with `BadRequestException`. Single unified CORS list for both API Gateway and S3 — rejected because API Gateway v2 and S3 have different wildcard support requirements. Two separate lists (`corsAllowedOrigins` for API Gateway, `s3CorsAllowedOrigins` for S3) is the solution.
- **Lazy session re-indexing (re-index only on session view)** — produced implausibly low registry counts after schema version bumps; replaced with full re-index triggered by the Rebuild Index button.
- **FTS5 full-text search index for session entry search** — insufficient for JSON field-wise querying; SQLite structured columns with indexes used instead.
- **IntersectionObserver sentinel for pagination** — failed because with collapsed groups the page stays short so the sentinel remains in viewport but never triggers intersection changes; replaced with eager sequential pagination.
- **Plain anchor tags for `open in session` links** — triggered full page loads, exiting the SPA and preventing Next.js router cache from being populated for back/forward navigation; replaced with Next.js `Link` component.
- **Stale cache guard and bfcache recovery listeners** — compensated for an upstream routing issue (plain anchor tags); made redundant and removed after switching to consistent `Link` usage.
- **Removing CORS entirely from API Gateway for CLI-only tool** — considered; CORS is irrelevant to CLI clients since browsers are the only CORS-enforcing agents, but explicit domain list retained for future-proofing.
- **Cursor blob-text LIKE matching for plan discovery** — plan references are stored in binary protobuf blobs rather than JSON, making text-based matching fail; replaced with dual strategy (registry-based via `state.vscdb` `composer.planRegistry` + blob-scan, both always run).
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — rejected in favour of copying `store.db` files wholesale for maximum compatibility.
- **Per-agent tabs in the review screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **`@inquirer/prompts` as TUI framework** — cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation; replaced with ink.
- **Grouping subagent tool calls with surrounding progress/filler cards into topical groups** — does not help the user match subagent tasks with their results; replaced with enrichment approach (cross-references between subagent call and result cards).
- **Displaying elapsed time as part of the result section heading** (`Result (Xm Ys)`) — replaced with a standalone `Worked for XXs` label positioned between prompt and result sections.
- **Classifying TodoWrite entries under generic `tool-call` tag** — caused grouping with unrelated Read, Write, and Bash tool calls; replaced with dedicated `todo-write` entry tag.
- **Opening session viewer links in a new tab** — avoided the actual re-mount problem rather than fixing it; real-world re-fetch time is short enough that re-mounting is acceptable.
- **bfcache restoration detection via `pageshow` event listener** — did not resolve stuck loading state; root cause was navigation inconsistency (plain anchor tags), not bfcache restoration.
- **`import.meta.dirname` for SQLite database path resolution** — resolves to the compiled `.next` directory at Next.js runtime rather than the source file location; replaced with `process.cwd()` navigating one level up.
- **SSM Parameter Store for alarm notification email** — email is classified as non-sensitive plain configuration; SSM lookup complexity unjustified; stored in version-controlled `config.ts` instead.
- **Deprecated `pointInTimeRecovery` DynamoDB property** — replaced with `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }` to maintain compatibility with current `aws-cdk-lib`.
- **Unqualified secrets-protection message without `(best effort)` qualifier** — lacks honest communication about protection limits; replaced with qualified messaging.
- **Producing only a text-based file tree without actual file contents** — clarified as incomplete; actual file copies included subject to secret filtering.
- **Removing excluded directories entirely from the archive output** — rejected; directory entries are preserved while their contents are excluded.
- **Timing heuristic using delay between `tool_use` and `tool_result` timestamps to infer auto-approval** — execution time noise conflates user response time with actual tool execution time; rejected as unreliable.
- **Including raw `.git` directory in the archive** — git repositories with long history make `.git` very large; replaced with git bundle.
- **Dedicated collapsible plan summary card at the top of the session** — deprioritised in favour of inline markdown rendering within tool interaction blocks.
- **Radio buttons for todo item status icons** — todo items have more than two states and are not single-choice; replaced with distinct non-radio icons.
- **Hardcoding raw API Gateway URL as CLI default** — URL is fragile and changes if the AWS stack is recreated; replaced with custom domain `vibe-share.codespeak.dev`.
- **Using environment variable to supply server URL to CLI** — end users cannot be expected to know or set this value; replaced with zero-configuration default.
- **Unwrapping single-card topical groups** — single-card topical groups must not be created; cards remain standalone without a group wrapper.
- **Displaying duration on the left or centre of collapsed group headers** — rejected in favour of right-side placement consistent with per-card timestamp column.
- **Background tint alone for expanded groups** — not visually distinct enough; replaced with background tint plus border.
- **Displaying the model identifier on every card** — redundant when most cards share the same model; replaced with session-level most-common-model display with per-card exception labelling.
- **Lazy-loading patches via `useEffect` with `[sessionId]` dependency for hash highlight** — broke navigation to collapsed items; implementation interrupted.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen rather than a meaningful name.
- Gemini CLI sessions reports sessions found during discovery but none appear in the Review screen.
- Opening any Cursor session in the Review screen for the `khariton-style` project shows `No messages found in this session` despite the session containing messages.
- Up navigation in the main content list on the Review screen is broken.
- The grouping UI toolbar does not appear at the top of the `/registry/tool-call` page.
- Only 3 skill tool call nodes appear on the tool-call registry page when more are expected.
- Example links for `Cancel (Esc) with user comment` and `Cancel (Esc) without comment` in ExitPlanMode do not match their labels — misclassification of response types in example data is suspected.
- After fixes to same-page hash navigation via `PlanBadge`, navigation to a collapsed item is broken again — the targeted entry does not expand and scroll into view on same-page navigation between sessions.
- The assistant badge in plan edit cards does not render in green as expected despite `displayColorClass` changes intended to correct it.