# CodeSpeak Vibe-Share Specification

## Overview

CodeSpeak Vibe-Share is a suite of tools that lets developers share their vibe-coded projects — including source code, git history, and AI agent session transcripts — with the CodeSpeak team for study and analysis. The system consists of a CLI tool that packages project files and agent sessions into a structured archive and uploads it to a secure AWS backend, an administrative web UI for browsing and downloading uploads, a session viewer application for inspecting AI coding sessions in detail, and a backend infrastructure layer built on AWS serverless services. The project also includes exploratory work toward a developer personality profiling system based on measurable signals extracted from coding sessions.

---

## Foundation

**Stack:** TypeScript, Node.js, React, Next.js (session viewer), AWS CDK, AWS Lambda (Node.js 22.x), API Gateway HTTP API v2, S3, DynamoDB, SNS, SSM Parameter Store, CloudWatch, Amazon Cognito, Amazon SES, SQLite (session viewer cache), `ink` (terminal UI), `react-markdown` + `remark-gfm` (markdown rendering), `esbuild` (Lambda bundling).

**Architecture:**
- *Deployment topology:* Serverless AWS backend (Lambda + API Gateway + S3 + DynamoDB); CLI distributed via npm/npx; web UI served via CloudFront as a static site; session viewer runs as a local Next.js application.
- *Communication pattern:* CLI calls API Gateway HTTP endpoints for presign and confirm steps; Lambda functions publish to SNS topics for upload event and alarm notifications; Slack notifications delivered via incoming webhook stored in SSM Parameter Store; web UI authenticates via Cognito OAuth and calls API Gateway with JWT authorizer.
- *Data model:* DynamoDB stores upload metadata; S3 stores zip archives; SQLite stores session viewer cache (project discovery, session metadata, session entries with indexed columns).
- *Infrastructure management:* AWS CDK defines all infrastructure; deployed via CDK CLI; DNS managed manually at external registrar.

**Cross-cutting constraints:**
- All Lambda functions use Node.js 22.x runtime.
- Lambda functions are bundled via esbuild within CDK; CommonJS module format.
- IAM permissions follow least-privilege; each Lambda is granted only the specific DynamoDB actions it uses.
- Secrets and sensitive values are stored in AWS SSM Parameter Store as SecureString parameters; non-sensitive configuration values are stored in version-controlled config files.
- Configuration values (default region, alarm email, CORS origins, custom domain) are centralized in a shared config file rather than hardcoded inline.
- S3 storage retains all uploaded files indefinitely with no lifecycle expiry.
- The system must not expose operator credentials or secrets to end users.

---

## Features

### CLI Tool

The CLI is distributed as an npm package (`@codespeak/vibe-share`) invocable via `npx @codespeak/vibe-share` with no prior installation or configuration required. The binary command name for global installs is `codespeak-vibe-share`. The default API endpoint is `https://vibe-share.codespeak.dev`.

**Startup and project detection**

On launch, the tool detects whether the current directory is under git version control. It identifies the project root correctly when invoked from any subfolder, including projects without a `.git` directory — non-git fallback must not silently use the current working directory if it differs from the actual project root.

Email and username are pre-populated from git config at startup; the user is prompted only when those values are absent.

**Consent and privacy**

Before any files are packaged or uploaded, a privacy notice is prominently displayed explaining what data will be collected and how it will be used. Explicit user consent is required before proceeding. The sharing consent prompt defaults to `Y` (uppercase, indicating the active default).

The privacy notice includes a `(best effort)` qualifier on secrets-protection claims to set accurate expectations. Sensitive keys found in session data are masked/redacted before inclusion in the archive.

**Archive construction — git projects**

For git-managed directories, the archive includes:
- Output of `git status` as a text file.
- Two separate git diff text files: unstaged changes and all uncommitted changes versus HEAD.
- A recursive file listing.
- An `untracked/` directory containing untracked, non-gitignored files.
- A git bundle with all refs (`--all` flag); if bundle creation fails (empty repo, shallow clone, corrupted refs), `bundlePath` is set to null and archive creation continues without a bundle. Empty repositories capture all files as untracked under `project/untracked/`.

**Archive construction — non-git projects**

For non-git directories, the tool walks the directory using configurable exclude patterns. Common noise directories and files (`.venv`, `node_modules`, `.env.local`, etc.) are excluded by default; the user can adjust the exclusion list. Binary file detection or per-file size limits prevent accidental inclusion of large binaries.

**Session discovery**

The tool locates AI agent sessions associated with the project. Claude Code sessions are found under `~/.claude/projects/<encoded-path>/`, scanning recursively for all subagent session files. Sessions from all git worktrees associated with the same repository are discovered and collected together; worktree tracking stores both filesystem path and branch name (read from each worktree's `.git/worktrees/<name>/HEAD` file, not via git commands).

Other supported agents: Codex, Gemini. For unknown agents, the user can manually specify session directories; all files from those directories are included as-is without agent-specific parsing.

Session data is structured in the archive under `sessions/.claude/` replicating the actual `.claude` folder hierarchy, with project files under `.claude/projects/<encoded-path>/`, plan files under `.claude/plans/`, and debug files under `.claude/debug/`.

**Referenced file collection**

Session transcripts are scanned (including all subagent sessions) to detect references to plan files under `.claude/plans/` and debug files under `.claude/debug/<uuid>.txt`. Only referenced files are collected — orphaned files not referenced in any session transcript are excluded. Plan files are placed in `sessions/.claude/plans/`; debug files in `sessions/.claude/debug/`.

**Archive filename**

The archive filename is derived from the repository name extracted from the git remote URL (supporting SSH, HTTPS with/without `.git` suffix, and other formats), falling back to the project folder name when no remote is available. Format: `<name>-<timestamp>.zip`. No `vibe-share` infix in the filename. The archive filename fallback path logic must be deduplicated into a single variable.

**Archive size estimation**

Size estimation accounts for all content: session data and project files. For git repos, sums text output sizes, git bundle file size, and untracked file sizes. For non-git repos, sums all project file sizes. Total size estimate is initialized from the project size estimate rather than zero.

**Upload flow**

1. CLI checks backend availability via the health endpoint; falls back to saving a local zip if the backend is unreachable.
2. User is prompted for optional metadata: name, email (pre-populated from git config), repo URL (auto-detected from git remote when available; prompt skipped when no remotes exist).
3. Metadata is submitted as part of the presign request.
4. File is uploaded to S3 via presigned PUT URL.
5. Confirm endpoint is called to verify the upload.

On upload failure, the CLI displays which step failed (e.g., "confirm step") along with suggestions to use `--output` to save locally or `--verbose` for detailed diagnostics. With `--verbose`, the full error cause chain including HTTP status code and response body is shown. The post-upload success message does not include a download URL.

The API base URL can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable.

**Local zip fallback**

When the backend is unavailable or disabled, the tool produces a local zip file the user can handle manually.

**Telemetry**

On CLI failure, error telemetry is automatically sent to the backend capturing error type, failure step, OS version, Node version, and sanitized error message (no PII or sensitive content). A correlation/request ID is generated per run and flows through all CLI steps and corresponding backend calls. A local diagnostic log file is written on every run with timestamped debug output.

**Interrupt handling**

Ctrl+C and interrupt signals during archive creation or upload trigger cleanup of temp directories, partial zips, and partial S3 uploads.

**Session file handling**

Session JSONL files actively being written during tool execution are handled gracefully for partial reads or file-in-use conditions.

**Non-goals**
- Cursor session support in the initial version.
- Server-side read-only agent for file discovery in the initial version.
- GitHub repository sharing and push-to-org in the initial version.
- User-provided server URL configuration.
- Download URL display in post-upload flow.

---

### Backend Infrastructure

**API endpoints**

Three Lambda functions exposed via API Gateway HTTP API:
- `presign` — validates request, generates S3 presigned PUT URL, records upload metadata in DynamoDB, publishes upload-requested event to upload events SNS topic.
- `confirm` — verifies S3 object exists (requires `s3:GetObject` IAM permission), marks upload confirmed in DynamoDB, publishes upload-confirmed or upload-failed event to upload events SNS topic.
- `health` — returns `{ status: "ok" }`.

API Gateway enforces rate limiting at 10 requests per minute per IP.

**Presigned URL**

Upload file size capped at 5 GB. Presigned PUT URL includes a `ContentType` condition enforcing `application/zip`; S3 rejects uploads with a mismatched Content-Type with 403.

**DynamoDB**

Stores upload records with fields: `uploadId`, `status`, `timestamp`, `IP address`, `email`, `name`, `repoUrl`. Point-in-time recovery enabled using `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`. DynamoDB records transition out of pending status upon successful file confirmation.

**Token-based access**

Optional invite-only access supported via a token flag or environment variable backed by DynamoDB or Lambda environment variable lookup.

**CORS**

Two separate CORS origin lists in the shared config file:
- `corsAllowedOrigins` for API Gateway HTTP API v2 — explicit domain strings only (no wildcards), e.g., `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`.
- `s3CorsAllowedOrigins` for S3 — wildcard-capable, e.g., `codespeak.dev`, `*.codespeak.dev`.

API Gateway CORS also specifies explicit `Content-Type` and `Content-Length` allowed headers.

**Custom domain**

API is accessible at `https://vibe-share.codespeak.dev`. ACM certificate provisioned for this domain with DNS validation. API Gateway custom domain mapping configured to the regional endpoint. DNS records configured manually at the external registrar. The custom domain name is defined exactly once in the codebase.

**Security posture**

Confirmed non-goals: WAF protection, CloudFront CDN, unauthenticated endpoint remediation, abandoned upload cleanup, verbose error message remediation.

---

### Alerting and Observability

**CloudWatch alarms**

Four alarms configured with both alarm and OK actions publishing to the infrastructure alarms SNS topic:
- Lambda errors exceeding 5 in 5 minutes.
- API 4xx errors exceeding 50.
- API 5xx errors exceeding 10 (threshold implied by the two separate thresholds).
- (Additional Lambda-level alarms as configured.)

Both alarm and OK recovery notifications are sent so operators are notified when incidents begin and resolve.

**SNS topics**

Two separate SNS topics:
- *Infrastructure alarms topic* — receives CloudWatch alarm/OK notifications; delivers to alarms email subscription (`alarms@codespeak.dev`, defined in shared config) and to the Slack webhook Lambda.
- *Upload events topic* — receives presign and confirm Lambda publish calls (fire-and-forget, non-blocking); delivers only to the Slack webhook Lambda. No email subscription.

**Slack webhook Lambda**

Receives SNS messages and POSTs to the Slack incoming webhook URL retrieved from SSM Parameter Store at `/vibe-share/slack-webhook-url` (SecureString). Webhook URL is cached with a 5-minute TTL; cache is invalidated immediately on error response from Slack. On Slack delivery failure, the Lambda throws so SNS treats delivery as failed and retries (up to 2 additional attempts). Logs a warning and continues gracefully if the SSM parameter is absent rather than failing fatally. Caches across warm invocations to reduce SSM API calls.

The Slack notification format: human-readable top-level message, with full structured data as pretty-printed JSON wrapped in triple-backtick code fences in a thread reply. Each upload event generates its own independent Slack thread. CloudWatch alarm notifications follow the same structure.

Upload notifications include: user name, email, repo URL (top-level); filename, size, IP in the thread. Internal user uploads are prefixed with `:codespeak:` emoji in the top-level message. Internal user status is determined by querying `InternalEmailsTable` at notification time (no caching); the Slack notify Lambda receives the table name via environment variable.

Race condition between presign and confirm SNS handlers is resolved via atomic DynamoDB conditional writes: whichever handler arrives first deterministically claims thread creation and posts to Slack; the other polls until completion.

**SSM parameter setup**

The project README documents the requirement to create the SSM SecureString parameter `/vibe-share/slack-webhook-url` containing the Slack incoming webhook URL before deploying.

**Non-goals**
- System-wide AWS CLI profile configuration.
- Email notifications for upload events.

---

### AWS Setup and Deployment

CDK bootstrap must be run from within a directory containing a valid `cdk.json` or with an explicit `aws://ACCOUNT_ID/REGION` argument. AWS CLI credentials via SSO (`aws configure sso`) are accepted for CDK deployments. The default deployment region is sourced from the shared config file.

An `.envrc` file at the project root sets `AWS_PROFILE` to `'default'` and is automatically sourced by direnv on directory entry and unset on exit, scoping the profile to this project only.

A `cdk-deploy` script in `scripts/` invokes CDK deploy with the auto-approve flag automatically. The `scripts/` directory is added to PATH via `.envrc` using direnv, making scripts directly executable.

**Non-goals**
- Automatic deletion or expiry of S3 uploaded files.

---

### Administrative Web UI

A CloudFront-served static web application accessible at `https://admin.vibe-share.codespeak.dev`. Authentication is provided by Amazon Cognito with a hosted OAuth domain. Access is restricted to users with `@codespeak.dev` email addresses via a pre-sign-up Lambda trigger that rejects other domains, auto-confirms and auto-verifies `@codespeak.dev` addresses, and delegates verification to Cognito's built-in flow. Self-registration is enabled for `@codespeak.dev` users; users receive a temporary password via email and must set a permanent password on first login. Email delivery uses Amazon SES (configured in a supported region: us-east-1, us-west-2, or eu-west-1) rather than Cognito's default sender, which has a 50 emails/day cap and high spam classification rate.

A `list-uploads` Lambda is protected by a Cognito JWT authorizer on the `GET /api/v1/uploads` route. It scans DynamoDB for confirmed uploads and returns presigned download S3 GET URLs with 1-hour expiry.

A user creation script accepts an email argument, resolves the Cognito User Pool ID from CDK stack outputs, and invokes `admin-create-user` via AWS CLI.

**Upload record display**

The main table displays all upload records with columns (in order): NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. Size is displayed in human-readable format (e.g., 2 MB). Timestamps are in ISO 8601 format. CONFIRMED shows a dash (`-`) when absent.

**Internal email management**

User emails can be flagged as internal and are persisted in a database. Internal emails are hidden from the main table by default. A checkbox toggles their visibility; the checkbox state is saved to and restored from localStorage. A per-row button on the main table marks a user's email as internal. A dedicated page exists for managing the internal emails list.

Internal upload rows display a 🛠️ emoji prepended to the filename and use a grey background (`#f0f0f0`) with hover state `#e8e8e8`.

**GitHub URL normalization**

All recognized GitHub URL formats — HTTPS with/without `.git` suffix, SSH (`git@github.com:user/repo.git`), `git://` protocol, URLs with trailing subdirectory paths — are normalized to a shortened `user/repo` display label rendered as a clickable hyperlink to the full `https://github.com/user/repo` URL.

**ACM certificate**

The ACM certificate for `admin.vibe-share.codespeak.dev` must be created in `us-east-1` (CloudFront architectural requirement), with DNS validation, and its ARN imported into the CDK stack.

---

### Status and Maintenance Scripts

**`status.sh`**

Queries DynamoDB and displays all upload records as a formatted table with fixed-width columns: NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. A header line reads `=== DynamoDB Uploads ===` followed by a total record count. Lambda log fetching is opt-in via `--logs` flag.

**`clear-uploads`**

Displays the count of items to be deleted, then requires the user to type the exact phrase `delete all` before proceeding. Deletes all DynamoDB records and all S3 objects. Any input other than the exact phrase aborts the operation.

---

### Claude Code Plugin (vibe-share slash command)

The plugin is installed under `.claude-plugin/` and exposes a `/vibe-share` slash command. The plugin script is locatable and executable when invoked from a Claude Code slash command.

The plugin operates in three modes:
- **Scan** — audits existing project state; reports counts of session transcripts, plan files, and debug files found in the project.
- **Build** — collects session transcripts, referenced plan files (via grep-based detection of `.claude/plans/` references), and referenced debug files (via grep-based detection of `.claude/debug/<uuid>.txt` references); packages all into a zip archive with subdirectories for each type; outputs a build report with counts for each.
- **Review** — previews the contents of the packaged zip archive.

Excluded directories are retained as entries in the output rather than removed entirely. The `.claude-plugin/` directory has no special exclusion from archive scans, zip flags, or exclusion lists.

The script displays an upfront message with warm, reassuring tone communicating that secrets are handled with care, including a `(best effort)` qualifier.

---

### Session Viewer

A local Next.js application for browsing and inspecting AI coding sessions. Session discovery imports compiled logic from the parent CLI package's `dist/` rather than duplicating code.

**Project list**

Sessions are grouped by project. The project list is loaded from a SQLite cache populated on first load and served on subsequent loads (30-second TTL). First project list load must not incur multi-second delays; repeat loads within the TTL window are near-instant.

Each project card displays a session count pill in the top-right area. No agent badge is rendered on the project card until multiple agent types are supported.

**Session list**

Sessions for a project are displayed in a single-column list sorted by last message timestamp descending (most recently active first). Sessions are filtered by agent type at the discovery level; the project page displays only Claude Code agent sessions.

Each session card shows:
- AI-generated title (from `ai-title` entry's `aiTitle` field) or fallback to first user message lines, user message count, and agent summary content.
- Purple `plan` badge when the session contains references to `~/.claude/plans/` files; the badge is an interactive navigation link to the plan message.
- Message count and user prompt count in the format `XX msgs (YY prompts)` (user prompt count excludes entries where all content blocks are `tool_result` type).
- Start timestamp, end timestamp, and duration.
  - Same-day sessions: date displayed once with both times separated by arrow and duration (e.g., `Mar 28, 14:42 → 17:10 (2h 28m)`).
  - Multi-day same-year: month/day for both endpoints with arrow and duration.
  - Cross-year: full date including year for both endpoints.
  - Identical start/end: single timestamp, no arrow or duration.
  - All times in 24-hour format; year included only when the session year differs from the current year.
- A shared `SessionStats` component provides the stats row (message count, prompt count, date/time range, duration, file size) used by both session cards and the session detail page.

Session card container navigates to the session on click via `router.push`; plan badge uses a separate anchor element with `stopPropagation` to prevent triggering session navigation.

**Session discovery — accuracy**

Session count in tab labels must exactly match the session list count. Claude Code session discovery scans non-indexed JSONL files in addition to the sessions index. Project filtering reads the working directory only from user-type messages. Cursor session discovery includes Composer sessions extracted from workspace state in addition to chat directory sessions, with deduplication via seen identifiers. Session count computation during project discovery does not perform redundant file validation; real session count is computed once when the tab loads.

**Session detail page**

Loads JSONL entries via a paginated API backed by SQLite (target response: ~74ms). All entries load automatically in sequence without requiring user scroll interaction (eager pagination). Session metadata is retrieved via single-file read for the requested session only (not a project-wide scan).

Displays at the top: AI title as a heading, agent name badge, plan badge, session ID in monospace, then the stats row (messages and prompts count, date/time range with duration, file size).

Most common model for the session is displayed at the top in the format `Models: model-name xN (default)  other-model xM`, with all models sorted by usage count descending. Individual cards show the model only when it differs from the session's most common model.

**Three-layer display pipeline**

Card display is computed in three ordered layers:
1. **Per-card defaults** — each card is assigned `isPrimary` and `defaultExpanded` flags.
2. **Topical grouping** — consecutive related cards (tool-call cycles, progress runs) are merged into topical groups. A topical group is only formed when it contains two or more cards; a single-card sequence remains standalone. Filler entries join an active topical group rather than forming standalone groups. Thinking entries do not initiate or bridge topical groups with agent tool result cards.
3. **Collapsed-group formation** — all non-primary-interest cards between any two primary-interest cards are wrapped in exactly one collapsed group. A topical group acts as a single unit inside a collapsed group.

High-signal cards (user prompts, agent questions, plan interactions, completion reports) are primary interest and expanded by default. Low-signal cards (progress updates, queue operations) are collapsed by default. No card is ever permanently hidden; all collapsed and grouped content has an expand mechanism.

Groups containing only queue-operation entries auto-expand on initial render. When a collapsed group is expanded and contains exactly one topical group as its sole child, that topical group auto-expands simultaneously.

**Collapsed group header layout:** left side `▸ XXX cards` (e.g., `▸ 47 cards`); middle section shows tool-call breakdown as `N ToolName` (e.g., `3 Subagent`, `8 Bash`); right side shows duration using adaptive formatting (sub-second → milliseconds only, under one minute → seconds only, one minute or longer → minutes and seconds). The `other` group does not display a duration. Topical group summaries display tool name and count (e.g., `1 Read` or `3 Read, 2 Bash`). The term `Subagent` is used instead of `Agent` throughout.

Expanded groups display a background tint and border. Collapsed groups use `bg-blue-950/20` background with `border-blue-900/30` border. Topical groups use `bg-indigo-950/15` background with `border-indigo-900/30` border.

**Filter controls**

A filter UI control is present in the conversation view. Filter state is persisted to localStorage and loaded on initialization. Per-tag filter controls independently override card expansion state and visibility promotion; logical grouping is structural and not subject to filter override. Controls include Expand All and Re-apply Filter buttons. Collapsing an expanded filter tag pill updates the visible conversation entries.

Filter pill visual design:
- Left side (tag name): bright when the tag is set as primary interest, dim when collapsed into groups.
- Right side: chevron reflecting current expanded/collapsed default state.
- Amber ring indicator on pills with customized overrides.
- Active/on state: filled category-specific background with colored text. Off/disabled state: `bg-neutral-900` grey background with colored border matching the category color and `text-neutral-600` grey text (outlined appearance with muted interior).
- Color assignments: prompts `bg-blue-900 text-blue-300`; plans `bg-purple-900 text-purple-300`; tool calls `bg-[#3d2f0f] text-yellow-300`; progress/queue ops/file snapshots `bg-neutral-800 text-neutral-400`; AI title `bg-cyan-900 text-cyan-300`.

**Entry card types**

Each card has a type badge in the header rendered exactly once. Cards support collapse/expand toggle, raw JSON view, and rendered view (for recognized types). Message timestamps display date, hours, minutes, and seconds at the far right of the header row in both collapsed and expanded states. Rendered/JSON view toggle buttons are only visible when the entry is expanded.

- **User messages:** expanded by default; plain text (no markdown); blue background scheme (`bg-blue-950/50`, `border-blue-700/40`); blue role badge.
- **Tool-result user messages:** identified when all content blocks are `tool_result` type; collapsed by default; amber `tool result` badge; classified as non-user for ellipsis grouping purposes.
- **Assistant messages:** green background scheme (`bg-green-950/40`, `border-green-800/40`); green role badge; text blocks render as GitHub Flavored Markdown (headings, lists, code blocks, tables, bold, italic, inline code).
- **Thinking blocks:** tagged with a secondary label; collapsed state shows a content preview.
- **`ai-title` cards:** title text in card header; no card body.
- **`FileSnapshot` with no tracked files:** `no files tracked` in card header; no card body.
- **`FileSnapshot` with tracked files:** expandable file list in card body.
- **Tool call cards:** amber-colored tool name badge; header shows tool name with formatted detail text — file paths shortened from the beginning (leading ellipsis truncation), bash commands truncated at the trailing end to preserve the command start. Tool call node blocks are expanded by default; headers display identically in collapsed and expanded states.
- **Tool result cards:** amber-colored tool name badge; header shows tool name and file path looked up from tool-use-id map; file paths use leading ellipsis truncation when too long; expanded by default when the parent entry is opened; header retains all metadata in both collapsed and expanded states.
- **Subagent cards:** cyan-tinted container; type and description in title bar; body shows `Prompt` heading above prompt markdown (no description repeat), then a standalone `Worked for XXs` label as a separator, then result content rendered as markdown. Elapsed time is a standalone label between sections, not embedded in a heading.
- **Plan file interactions:** when a tool_use Write/Edit/Read block targets `~/.claude/plans/*.md`, renders the file's markdown content with a `Plan: <filename>` header and purple-tinted prose styling. Markdown tables render as formatted HTML tables.

**IDE context tags**

`<ide_*>` tags in user messages are parsed into segments. Each tag is rendered as a grey clickable badge in monospace with angle-bracket notation (e.g., `<ide_opened_file>`). Clicking toggles a scrollable expanded panel showing full tag content. Long paths are truncated from the left with `...` prefix; CWD prefix is replaced with `$CWD`.

**Plan navigation**

Sessions containing plan file references display a purple `plan` badge on the entry card. Clicking the badge on the session detail page uses a `PlanBadge` client component with a button element that assigns to `window.location.hash` directly to fire the native `hashchange` event. The targeted entry is extracted from the grouping system and rendered as a standalone card between surrounding collapsed groups, auto-expanded to show content. Scroll to the target element is deferred via nested `requestAnimationFrame` callbacks.

**SQLite cache schema**

Stores session metadata, session entries (with indexed `cwd`, `type`, and `timestamp` columns), and entry tags. Session entries API queries SQLite by `cwd` column for project-filtered results. Uncached sessions have cwd verified before being included. Non-Claude provider sessions are retrievable without re-running full discovery.

**Non-goals**
- Support for non-Claude-Code agent session formats in the initial session viewer build.
- Dedicated collapsible plan summary card at the session top.
- Agent badge on project cards until multiple agent types are supported.

---

### Cursor Session Bundling

The CLI supports locating, extracting, and bundling Cursor session data using a database-copying approach for maximum compatibility.

**Storage format**

Cursor stores session data in SQLite `store.db` files per workspace and a global `state.vscdb`. The CLI copies `store.db` files wholesale into the archive rather than extracting JSON blobs. The archive replicates the `.cursor` subtree structure.

**Plan discovery**

Plans created via the Cursor IDE UI are stored in `~/.cursor/plans/` and referenced in the global `state.vscdb` plan registry (`composer.planRegistry`). Discovery uses two strategies that always run in parallel:
1. **Blob-scan** — text matching within session blob data.
2. **Registry-based** — queries `composer.planRegistry` in `state.vscdb` to find plans whose `createdBy` composerId matches any composerId associated with discovered sessions. The composerId-to-agentId mapping is resolved via `composer.composerData` entries in `cursorDiskKV` or workspace-level `composer.composerData`.

**Filtered state extract**

`createStateExtract` creates a filtered `state.vscdb` containing `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData UUID` entries from `cursorDiskKV`. Uses `sqlite3 CLI` with `-readonly` flag.

**Workspace discovery**

`findWorkspaceStorageDir` scans `workspaceStorage/*/workspace.json` to match workspace by path. `getWorkspaceComposerIds` reads workspace `state.vscdb` to extract all composerIds for the workspace.

Orphaned Cursor chat directories (workspace deleted but chat directory remains) are recovered by extracting workspace paths embedded in `store.db` blob data using a regex pattern matching the path followed by a newline or quote character; extracted paths are validated for directory existence before being added to the project list.

Composer sessions stored in `~/Library/Application Support/Cursor/User/workspaceStorage/` are discovered by querying `composer.composerData` from `state.vscdb` files in that location. Duplicate sessions discovered via both chat and Composer paths are deduplicated.

**Discovery manifest**

`buildDiscoveryManifest` generates a `discovery-manifest.json` with intermediate findings including hashes, slugs, composerIds, plan matches, original paths, and algorithms; included in the archive.

**Non-goals**
- Human-readable JSONL extraction of Cursor database contents.

---

### Developer Personality Profiling (Vibe-Personality)

Exploratory system for characterizing developer personalities based on measurable signals from code, git history, and AI agent sessions. Only Claude Code sessions are supported as the agent data source. All Claude Code projects on the machine are included in analysis by default; specific projects can be excluded.

**Trait system**

Five traits are selected based on reliable detectability from available signals. Traits are combined into approximately 8 named archetypes (not the full 32-combination space). LLMs may be used as part of trait detection.

**Impatience metric**

Detects and quantifies signs of user frustration via three signal types:
- Sequence interruptions: user-prompt appearing after a tool-cycle-group.
- Explicit tool rejections: error-flagged events with rejection content.
- Orphan `tool_use` events: `tool_use` with no matching `tool_result`.

Produces three normalized rate metrics: impatience events per user message, impatience events per minute, and tool rejection rate as a ratio. Implementation uses `buildSegments()` grouping utility from existing `grouping.ts`.

**Permission event observability**

Session logs record permission prompt events, mode switch events (plan/auto/edit-automatically/bypass-permissions), and the responses (agree, decline, alternative instructions). Tool invocations where the active permission mode suppressed the prompt are detectable by inferring from `permissionMode` field combined with `permissions.allow` patterns from settings. There is no explicit `autoApproved` flag in the JSONL format — this is an architectural limitation of the Claude Code client.

**Tracking infrastructure**

Each raw candidate metric from `vibe-personality.md` is tracked in `intent/vibe-personality/TRACKING.md` with an emoji status indicator, inline definition/description, and a clickable cursor:// link to the current stage prompt. Per-metric plan files live in a `metrics/` subdirectory. Prompt templates exist at `prompts/plan.md`, `prompts/implement.md`, `prompts/test.md`, `prompts/done.md`, and `prompts/sync.md`. A `🔄 Sync` link at the top of `TRACKING.md` triggers a human-reviewed diff against `vibe-personality.md` to surface missing metrics. Instructions live in `intent/vibe-personality/CLAUDE.md`.

**Non-goals**
- Support for non-Claude coding agents (Cursor, Cline) in the first version.
- Full 32-archetype named type system in the initial implementation.
- Threshold classification for high impatience.
- Weighting scheme across the three impatience signal types.

---

### Session Log Extraction Script

A self-contained executable script that reads all Claude session log files for the current project from `~/.claude` and extracts: user messages, `AskUserQuestion` tool prompts, user answers, `ExitPlanMode` requests with plan approval/rejection results, TODO creation and status change events, and Claude implementation-completion messages.

Output: all extracted items written chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters; additionally, one per-session file per session written into `intent/sessions/`, each containing only that session's extracted items in chronological order separated by `==========` delimiters. Both combined and per-session output uses Markdown format.

---

### Gratitude Animation (Console UI)

The CLI's checkbox and select prompts include a gratitude-themed pseudographic animation rendered in the bottom-left corner of the terminal. The animation does not appear on confirm prompts.

The animation consists of exactly 4 frames, all with identical height and display-column width. Each frame advances one step per navigation or selection keypress (arrow keys, space, numbers), cycling continuously (wrapping from frame 3 back to frame 0). The animation disappears on Enter confirmation, replaced by the normal completion summary.

**Frame designs:**
- Frame 0: 💛 hearts diamond pattern with `THANK YOU!`
- Frame 1: 🌟 star border with `YOU ARE AMAZING!`
- Frame 2: 🎉🙏🎊 celebration theme with `SO MUCH GRATITUDE!`
- Frame 3: 🏆🔥 trophy theme with `YOU'RE THE BEST!`

Frame lines are prepended to the left of prompt output lines; the frame's last line aligns vertically with the last line of prompt output. Display width calculation treats emoji as 2 terminal columns and strips zero-width joiners and variation selectors. All padding and normalization use display width rather than string length.

**Non-goals**
- Animated animal character (goose or duck) in the console UI.

---

### npm Package Distribution

The package is published to the npm public registry as `@codespeak/vibe-share` (scoped format). Published with `--access public`. The `bin` field maps `codespeak-vibe-share` to the entry point script. The entry point includes a Node.js shebang (`#!/usr/bin/env node`). The `files` field in `package.json` restricts published content to the compiled `dist/` directory only. A `prepublishOnly` script runs TypeScript compilation before publishing. Semantic versioning is applied.

The decision to use a scoped package name must be made before first publish; moving from unscoped to scoped after publishing requires deprecating the original package with no clean reversal.

**Test Requirements**
- Before publishing: run `npm pack --dry-run` to verify only `dist/` files are included.
- After publishing: run `npx codespeak-vibe-share --version` to verify the package installs and executes correctly.
- Backend service testability: CLI can be tested against a deployed backend by setting `VIBE_SHARING_API_URL` to the target API Gateway URL at invocation time.
- Agent discovery logic that parses multiple agent formats must have unit tests, integration tests, and mocks rather than relying on manual verification.

---

## Design Decisions

- **SST v3 for infrastructure management** — rejected in favor of AWS CDK because SST is not officially AWS-supported.

- **Auth0 for authentication** — considered as external authentication provider; not selected in favor of AWS-native Cognito.

- **AWS Chatbot for Slack notifications** — involves manual OAuth setup in the AWS Console and adds an AWS-managed service dependency; rejected in favor of a Slack webhook Lambda to retain formatting control.

- **Shared CORS configuration list for both API Gateway and S3** — rejected because API Gateway HTTP API v2 does not support wildcard characters in `allowOrigins` values while S3 does, making a single list with wildcard syntax incompatible with API Gateway.

- **Publishing upload events to the existing infrastructure alarms SNS topic** — rejected to isolate the upload event stream from alarm notifications and allow independent filtering; a dedicated upload events SNS topic is used instead.

- **Download Lambda at `/api/v1/download/{uploadId}` returning a 302 redirect** — proposed as a share URL mechanism; rejected in favor of returning presigned S3 GET URLs directly from the confirm endpoint.

- **Web frontend at `codespeak.dev/share/{id}` via CloudFront and S3 static site** — proposed as a share URL mechanism; rejected as requiring additional infrastructure.

- **`@inquirer/prompts` as TUI framework** — cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation; rejected in favor of `ink`.

- **Lazy-loading session entries via IntersectionObserver sentinel** — failed because with collapsed groups keeping the page short, the sentinel remained in viewport on initial load and never triggered subsequent intersection changes; a race condition also prevented proper re-observation; replaced with eager sequential pagination.

- **Per-agent tabs in the review screen** — replaced with a single unified Sessions tab to reduce UI clutter; a `SESSION_PREVIEW_ENABLED` feature flag controls whether the tab is interactive or static.

- **Full 32-archetype system for developer personality profiling** — rejected in favor of starting with approximately 8 key archetypes to reduce upfront design complexity.

- **Timing heuristic for inferring auto-approval** — using delay between `tool_use` and `tool_result` timestamps to infer auto-approval was rejected because execution time noise conflates user response time with actual tool execution time, making inference unreliable.

- **`promptId` field as a signal for auto-approval correlation** — investigated and rejected because it did not correlate with auto-approval behavior.

- **FTS5 full-text search index for session entry cache** — rejected because FTS5 alone is insufficient for JSON field-wise querying; JSON field-wise indexing on structured columns is used instead.

- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — rejected in favor of copying `store.db` files wholesale for maximum compatibility across user environments.

- **Text-based LIKE matching of plan references within session chat blobs** — confirmed to fail because plan references in Cursor are stored in binary protobuf blobs rather than JSON, making text-based matching produce false negatives; replaced with registry-based discovery via `state.vscdb` combined with blob-scanning as a dual strategy.

- **Next.js `Link` component for plan badge navigation on the session detail page** — Link performs client-side navigation without remounting the session component, so the hash-reading effect never re-ran and highlighted entry state was not updated; replaced by a `PlanBadge` client component using a button element with direct `window.location.hash` assignment.

- **`useMemo` for grouped entry segments computation placed after early returns in `SessionClient`** — caused a React Rules of Hooks violation because the hook executed only on some render paths; fixed by relocating the call before all early returns.

- **Three separate JSONL scan passes (titles, plans, prompt counts)** — each read the same files independently; consolidated into a single-pass scan.

- **Session card implemented as a `Link` wrapper containing a child `Link` plan badge** — produced nested anchor tags in HTML, which browsers strip, breaking inner link navigation; replaced with a `div` plus `onClick` handler for the card container.

- **`s3:HeadObject` IAM action for HeadObject API calls** — not a valid IAM action; causes AccessDenied errors; the correct permission is `s3:GetObject`.

- **Grouping subagent tool calls with surrounding progress cards into topical groups** — does not help users match subagent invocations with their results; replaced with a cross-reference enrichment approach where each subagent card is enriched with its corresponding result data.

- **Displaying elapsed time as part of the result section heading** — `Result (Xm Ys)` format; rejected in favor of a standalone `Worked for XXs` label positioned as a separator between the prompt and result sections.

- **Cognito pre-sign-up Lambda auto-confirming and auto-verifying users** — bypassed Cognito's native verification flow, allowing unverified accounts; fixed by removing auto-confirmation and auto-verification, retaining only email domain validation.

- **Cognito default email sender** — hard cap of 50 emails/day, high spam classification rate, blocked by corporate email filters; replaced with Amazon SES.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen rather than a session title or first message.

- Gemini CLI sessions directory reports sessions found but none appear in the Review screen.

- Up navigation in the main content list on the review screen is broken.

- Opening a Cursor session in the Review screen for certain projects (e.g., `khariton-style`) shows `No messages found in this session` despite the session existing and containing messages.

- Session discovery logic in the `staged-rolling-quiche` work may overlook sessions or handle them inconsistently; no confirmed root cause.