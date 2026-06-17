# Vibe Sharing / CodeSpeak Session Packager Specification

## Overview

CodeSpeak Vibe Share is a command-line tool and supporting cloud backend that lets developers package their AI-assisted coding projects — including code, git history, and the complete session logs from AI agents such as Claude Code, Cursor, and Codex — into a portable archive and upload it to CodeSpeak for study. The system includes a serverless AWS backend for secure S3-based file upload, an authenticated web UI for staff to browse and download submissions, a session viewer application for detailed inspection of AI session transcripts, and a suite of infrastructure tooling for deployment, monitoring, and operational management. The goal is to make sharing frictionless enough that non-technical users can complete it without abandoning the process.

## Foundation

**Stack:** TypeScript, Node.js 22.x, React/ink (terminal UI), Next.js (session viewer web app), AWS CDK, AWS Lambda, API Gateway HTTP API v2, DynamoDB, S3, SNS, CloudWatch, Cognito, SSM Parameter Store, SQLite (session viewer cache), esbuild (Lambda bundling), react-markdown with remark-gfm.

**Architecture:**
- *Deployment topology:* Serverless AWS infrastructure (Lambda + API Gateway + DynamoDB + S3) managed via CDK CLI. Web UI hosted as a CloudFront-fronted static site. CLI distributed via npm/npx.
- *Communication pattern:* CLI → presigned S3 PUT URL flow via API Gateway → Lambda. Web UI → API Gateway → Lambda → DynamoDB + S3. Slack notifications via SNS → Lambda → Slack incoming webhook. Monitoring via CloudWatch alarms → SNS → email and Slack Lambda.
- *Data model:* DynamoDB stores upload metadata per upload ID; S3 stores zip archives; SQLite stores session viewer cache (metadata, entries, tags) with indexed cwd column for project-path filtering.
- *Availability mode:* Upload events are fire-and-forget SNS publishes that do not block API responses. Slack webhook URL is cached in Lambda with a 5-minute TTL.

**Cross-cutting constraints:**
- All Lambda functions run Node.js 22.x runtime.
- IAM permissions follow least-privilege: exact required actions only.
- Secrets and sensitive credentials are stored in AWS SSM Parameter Store as SecureString; non-sensitive configuration lives in version-controlled config files.
- No operator credentials or secrets may be present on the user's machine.
- The CLI must be robust against exceptions — failures surface as user-friendly messages, never raw stack traces or silent exits.
- The CLI must be usable by non-technical users; installation requires zero steps beyond `npx`.
- Secret redaction is applied to session JSONL transcripts before packaging, covering API keys, private keys, bearer tokens, and connection strings.
- Configuration values (region, domain names, alarm email) are centralised in a shared config file rather than hardcoded inline.

---

## Features

### CLI Tool (`codespeak-vibe-share`)

**Distribution and invocation**

The tool is distributed as an npm package `@codespeak/vibe-share` with the bin command `codespeak-vibe-share`. It is also invocable via `npx codespeak-vibe-share` with no prior installation. The entry point script carries a Node.js shebang line. The `files` field in package.json restricts published content to the compiled `dist/` directory. A `prepublishOnly` script runs TypeScript compilation before publish. Scoped packages are published with `--access public`.

**Project detection and file collection**

On startup the tool detects whether the current directory is under git version control. When git is present it collects tracked files via `git ls-files`, untracked non-gitignored files via `git ls-files --others --exclude-standard`, and produces: a git status text file, two separate git diff files (unstaged changes and all uncommitted changes versus HEAD), a recursive file listing, an `untracked/` directory containing untracked files, and a git bundle with all refs (`--all` flag). Git bundle creation failures (empty repository, shallow clone, corrupted refs) are caught and represented as null rather than throwing; the archive continues without a bundle and `hasBundle` / `projectFileCount` reflect the actual outcome. For empty repositories (no commits), all files are captured as untracked under `project/untracked/`. For non-git directories the tool walks the directory using configurable exclude patterns and excludes common noise directories (`.venv`, `node_modules`, `.env.local`) with user-adjustable exclusion lists.

Archive size estimation sums: for git repos — git text output sizes, bundle file size, and untracked file sizes; for non-git repos — all project file sizes. Total estimate initialises from the project size, not zero.

Archive filenames use the repository name extracted from the git remote URL (supporting SSH, HTTPS, and other formats, stripping `.git` suffix) with a timestamp suffix (e.g. `reponame-1741234567890.zip`), falling back to the project folder name when no remote is available. The `vibe-share` string does not appear in archive filenames. Filename construction logic is deduplicated into a single variable.

When no git remotes are configured, the repository URL prompt is skipped entirely.

**Session discovery**

The tool locates AI agent session directories for the current project. For Claude Code, it reads `~/.claude/projects/<encoded-path>/` including all subagent session files and tool-results/ directories. Session discovery searches across all git worktrees for the same repository, not only the current working directory. Worktree tracking stores both the filesystem path and the branch name (read directly from `.git/worktrees/<name>/HEAD` without executing git commands). Worktree discovery works on archived repos without requiring git command availability.

If Claude Code sessions are not found, the user is asked which agent they used. Supported agents: Claude Code, Codex, Gemini, Cursor. For Cursor, the tool copies `store.db` SQLite database files wholesale rather than extracting blobs, queries `composer.planRegistry` from `state.vscdb` to discover plans whose `createdBy` composerId matches discovered sessions, resolves the composerId-to-agentId mapping via `composer.composerData`, and copies relevant portions of `state.vscdb` (plan registry entries and composer data for matched sessions) into the archive. If no supported agent session is found, the session setup UI offers individual untracked file selection; the filesystem browse option is not present.

The CLI tool must correctly identify the project root when invoked from any subfolder, including projects without a `.git` directory; the non-git fallback must not silently use the current working directory as the project root when a subfolder is detected.

**Session discovery — Claude Code specifics**

Session discovery scans non-indexed JSONL files in addition to the sessions index. Project filtering reads the working directory from user-type messages only (consistent between count and list logic). Session counts on the Project Share screen include sessions from all worktrees. Global project discovery merges worktree entries for the same git repository into a single project list entry with combined agent lists and aggregated session counts.

**Archive layout**

The archive replicates the actual `.claude` folder hierarchy under `sessions/.claude/`, with project session files at `sessions/.claude/projects/<encoded-path>/`, plan files at `sessions/.claude/plans/`, and debug files at `sessions/.claude/debug/`. For Cursor, the archive replicates the `.cursor` subtree structure. Zip entry paths for all provider-level and per-session files are computed using the archive root and relative path resolution via the `AgentProvider.getArchiveRoot()` method; the Claude provider returns `~/.claude`. Path computation is uniform across file types with no special-case handling.

Excluded directories appear in the archive as entries with their contents excluded, rather than being removed entirely.

**Referenced file collection**

Plan files referenced in session transcripts (detected via grep against session content) are copied into the archive. Debug files referenced in session transcripts (matching `.claude/debug/<uuid>.txt` pattern, detected via grep) are copied into the archive. Only files explicitly referenced in session transcripts are collected — orphaned or unreferenced files are excluded. Both plan and debug collection use identical grep-based reference detection.

**Privacy and secret protection**

A prominent message appears near the start of the tool's output explaining that the tool protects secrets and takes privacy seriously, including a `(best effort)` qualifier. Sensitive keys found in session data are masked or redacted before packaging; raw secret values are never included in the archive. Symlink handling prevents external file leakage and infinite directory walk cycles. Binary file detection or per-file size limits prevent accidental inclusion of large binaries (disk images, media files, ML model weights) in non-git mode. Session JSONL files actively being written during execution are handled gracefully for partial reads.

**User consent and privacy notice**

Before any packaging or upload, a clear privacy notice is displayed explaining what data will be collected and how it will be used, emphasising privacy protection. Explicit user consent is required before uploading or sharing anything. The sharing consent prompt defaults to `Y` (true); the uppercase `Y` is shown to indicate it is the active default.

**Upload flow**

The CLI checks backend availability via a health endpoint before uploading, with fallback to local zip save if unreachable. The backend API base URL defaults to `https://vibe-share.codespeak.dev` and can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable. The upload flow: calls the presign endpoint to obtain an S3 PUT URL, uploads the zip, then calls the confirm endpoint. User metadata (email, name, repo URL) is collected before upload; email and username are pre-populated from git config when available, and prompts are shown only when git config values are absent. Repo URL is auto-detected from the git remote and included automatically without prompting. Metadata fields are optional and do not block uploads. The confirm endpoint response does not include and the CLI does not display a share/download URL. No download URL line appears in upload success output.

On upload failure, the CLI displays which step failed (e.g. "confirm step") along with suggestions to use `--output` to save locally and `--verbose` for diagnostics. With `--verbose`, the full error cause chain including HTTP status code and response body is shown.

A local zip output option is available when the backend is unavailable or the user prefers not to upload.

Ctrl+C and interrupt signals during archive creation or upload trigger cleanup of temp directories, partial zips, and partial S3 uploads.

**Cross-platform support:** macOS, Linux, and Windows, with no platform-specific installation procedures. HTTP_PROXY and HTTPS_PROXY environment variables are respected.

**Error telemetry**

On failure, the CLI automatically sends telemetry to the backend capturing error type, failure step, OS version, Node version, and sanitised error message (no PII or sensitive content). A correlation/request ID is generated and flows through all CLI steps and corresponding backend calls for end-to-end tracing. A local diagnostic log file is written on every run with timestamped debug output.

**Non-goals for CLI**

- Cursor session support via SQLite blob extraction (wholesale db copy is used instead)
- Server-side read-only agent for file discovery
- GitHub repository sharing and push-to-org feature
- User-provided server URL configuration (zero-config for end users)
- Download URL display in post-upload flow
- Share URL field in upload confirm response handling
- vibe-share branding in archive filenames
- Manual filesystem browsing and file picking for session selection

---

### AWS Backend

**Infrastructure (CDK)**

All infrastructure is defined and deployed via AWS CDK CLI. The stack targets `eu-north-1` with the default region sourced from a configuration file. CDK bootstrap requires either an explicit `aws://ACCOUNT_ID/REGION` argument or a directory containing `cdk.json`. AWS credentials are configured via SSO (`aws configure sso`) or static IAM keys; both are compatible with CDK operations. Lambda functions are bundled via esbuild within CDK; CommonJS module format is used via tsconfig. A `cdk-deploy` script in `scripts/` invokes CDK deploy with the auto-approve flag.

**Lambda functions**

Three Lambda functions handle the upload lifecycle:
- **Presign**: validates the request, records upload metadata in DynamoDB (status, timestamp, IP, email, name, repo URL, uploadId), generates a presigned S3 PUT URL with Content-Type enforcement (Content-Type application/zip; S3 returns 403 on mismatch), and publishes an upload-requested event to the upload events SNS topic (fire-and-forget, non-blocking).
- **Confirm**: verifies the S3 object exists using `s3:GetObject` permission (HeadObject operation; `s3:HeadObject` is not a valid IAM action), updates DynamoDB record status from pending to confirmed, and publishes an upload-confirmed or upload-failed event to the upload events SNS topic (fire-and-forget, non-blocking). S3 errors in the confirm Lambda are logged, not silently swallowed.
- **Health**: returns `{ status: "ok" }`.

A fourth Lambda function — **Slack notifier** — receives SNS messages from both the alarms topic and the upload events topic and posts to a configured Slack incoming webhook. A fifth Lambda — **Pre-sign-up** — validates self-registration email domains for Cognito.

IAM policies per Lambda: Presign has `dynamodb:PutItem` and SNS publish to upload events topic; Confirm has `dynamodb:GetItem`, `dynamodb:UpdateItem`, `s3:GetObject`, and SNS publish to upload events topic; Slack notifier has read-only access to the SSM SecureString at `/vibe-share/slack-webhook-url` and read access to InternalEmailsTable.

**Storage**

- S3 bucket retains all uploaded files indefinitely with no lifecycle expiry.
- DynamoDB table stores upload metadata with `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }` (35-day restore window). The deprecated `pointInTimeRecovery` property is not used.
- Upload file size is capped at 5GB; uploads exceeding this require multipart upload strategy or an explicit error.

**API Gateway**

HTTP API v2 with throttling. Rate limiting: 10 requests per minute per IP. Routes: `POST /api/v1/presign`, `POST /api/v1/confirm`, `GET /health`, `GET /api/v1/uploads` (Cognito JWT authorizer).

CORS `allowOrigins` for API Gateway HTTP API v2 is an explicit list of specific domain strings (no wildcards, as API Gateway v2 does not support them): `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`, `admin.vibe-share.codespeak.dev`. S3 CORS `allowedOrigins` may include wildcard patterns (`*.codespeak.dev`) since S3 supports wildcard syntax. Both lists are maintained separately in a central config file (`backend/lib/config.ts`).

**Custom domain**

The API is served at `https://vibe-share.codespeak.dev`. ACM certificate is provisioned for this domain with DNS validation. API Gateway custom domain mapping points to the existing API Gateway regional endpoint. DNS records are configured manually at the registrar (not via Route 53 automation). The custom domain name is defined exactly once in the codebase. CDK stack env is configured with explicit AWS account and region values.

**Monitoring and alerting**

CloudWatch alarms trigger on: Lambda errors > 5 in 5 minutes; API 4xx errors > 50; API 5xx errors > 5. All four alarms have both `addAlarmAction` and `addOkAction` calls so operators are notified on both incident start and recovery. Alarms publish to an SNS topic that delivers email to `alarms@codespeak.dev` (configured in the shared config file, not SSM) and to the Slack notifier Lambda.

A separate SNS upload events topic (isolated from the alarms topic) receives presign-requested, confirm-success, and confirm-failed events. The upload events topic has no email subscription (Slack-only). Both presign and confirm Lambdas are granted SNS publish to the upload events topic; the topic ARN is passed via environment variables.

**Slack notifications**

The Slack webhook URL is stored in AWS SSM Parameter Store as a SecureString at `/vibe-share/slack-webhook-url`. The Slack notifier Lambda caches the URL with a 5-minute TTL; the cache is invalidated immediately on an error response from Slack. On Slack delivery failure the Lambda throws rather than swallowing the error, enabling SNS retry behaviour. SNS retries up to 2 additional times on Lambda failure to handle transient Slack unavailability. If the SSM parameter is absent, the Lambda logs a warning and continues rather than throwing a fatal error (so email delivery is not disrupted). The SSM parameter supports overwrite on re-deployment so re-running deployment does not fail when the parameter already exists.

Upload notifications include: for presign events — filename, size, IP, user info; for confirm-success events — filename, size, and download link (authenticated via Cognito admin UI); for confirm-failed events — failure indication. Notifications from internal users are prefixed with the `:codespeak:` emoji. Internal user status is determined by querying InternalEmailsTable at notification time with no caching. Each upload generates its own independent Slack thread; upload notifications are not grouped into a shared thread. Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first claims thread creation while the other polls until completion.

Message format: human-readable top-level message; full structured data as pretty-printed JSON wrapped in triple-backtick code fences in a thread reply. CloudWatch alarm notifications follow the same structure.

**Telemetry endpoint**

Backend exposes a telemetry ingestion endpoint that receives CLI error payloads and stores or forwards error data for developer review.

**Operational scripts**

- `status.sh` in `scripts/`: queries DynamoDB and displays all upload records in a fixed-width table with columns NAME, EMAIL, FILENAME, SIZE (human-readable), STATUS, CREATED, CONFIRMED (dash when absent), REPO_URL, UPLOAD_ID, sorted and formatted with ISO 8601 timestamps. Lambda log fetching requires `--logs` flag. The `scripts/` directory is on PATH via `.envrc` with direnv.
- `clear-uploads` script: displays item count before prompting; requires typing the exact phrase `delete all` to confirm; deletes all DynamoDB records and all S3 objects.
- `.envrc` at project root sets `AWS_PROFILE` to `default` via direnv (scoped to the project directory).

**Non-goals for backend**

- Automatic deletion or expiry of S3 uploaded files
- Unauthenticated API endpoint remediation
- WAF protection
- CloudFront CDN and DDoS protection
- System-wide AWS CLI profile configuration
- Email notifications for upload events

---

### Web Admin UI

**Access and authentication**

Cognito User Pool with hosted domain for OAuth authentication, served via CloudFront at `https://admin.vibe-share.codespeak.dev`. ACM certificate for this domain is in `us-east-1` (CloudFront requirement) and is imported into the CDK stack by ARN. Cognito callback and logout URLs are set to the CloudFront domain.

Self-registration is enabled for `@codespeak.dev` email addresses only. The pre-sign-up Lambda validates the email domain, auto-confirms and auto-verifies `@codespeak.dev` addresses, and rejects all others. Email delivery uses Amazon SES (not Cognito default sender) to avoid the 50 emails/day cap, spam classification, and corporate filter blocking. SES is configured in a supported region (`us-east-1`, `us-west-2`, or `eu-west-1`). Email verification is required before an account is active. A user creation script (`scripts/create-user`) accepts an email argument, resolves the Cognito User Pool ID from CDK stack outputs, and creates users via AWS CLI.

**File browsing**

`GET /api/v1/uploads` protected by Cognito JWT authorizer. The `list-uploads` Lambda scans DynamoDB for confirmed uploads and returns presigned download URLs with 1-hour expiry. The web UI allows browsing and downloading uploaded files.

**Internal uploads management**

User emails can be flagged as internal and are stored in an InternalEmailsTable. Internal emails are hidden from the main table by default. A checkbox toggles visibility of internal emails; the preference is persisted in `localStorage` and restored on page initialisation. A per-row button marks a user's email as internal from the main table. A dedicated management page allows adding emails to the internal list.

Internal upload rows display a 🛠️ wrench emoji prepended to the filename and use a grey background (`#f0f0f0`) with hover state `#e8e8e8`.

**GitHub URL normalisation**

All recognised GitHub URL formats (HTTPS with/without `.git` suffix, SSH `git@github.com:user/repo.git`, `git://` protocol, URLs with trailing paths) are parsed to extract the `user/repo` segment and construct the canonical `https://github.com/user/repo` link. The display label shows the shortened `user/repo` format as a clickable hyperlink.

**UI**

The authenticated user's email address and repository URL are displayed. Simple design via CloudFront static site with no elaborate styling required.

---

### Session Log Extraction Scripts

A self-contained, independently executable script reads all Claude session log files from `~/.claude` for the current project and extracts: user messages, AskUserQuestion tool prompts and user answers, ExitPlanMode requests with plan approval/rejection results, TODO creation and status change events, and Claude's implementation-completion messages. It writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters, and additionally writes one per-session file into `intent/sessions/`, each containing only that session's extracted items. Output uses Markdown format with entries in chronological order.

---

### Console UI (terminal prompts)

The CLI uses ink (React for terminal) for interactive prompts. A gratitude-themed pseudographic animation appears in the bottom-left corner of the screen, rendered alongside checkbox and select prompts only (not confirm prompts). The animation consists of exactly 4 frames of identical height and display-column width, cycling on each navigation keypress (arrow keys, space, numbers) and disappearing on Enter:

- Frame 0: 💛 hearts diamond pattern, "THANK YOU!"
- Frame 1: 🌟 star border, "YOU ARE AMAZING!"
- Frame 2: 🎉🙏🎊 celebration theme, "SO MUCH GRATITUDE!"
- Frame 3: 🏆🔥 trophy theme, "YOU'RE THE BEST!"

Gratitude frame lines are prepended to the left of prompt output lines with the frame's last line aligned to the last line of prompt output. Display width calculation treats emoji as 2 terminal columns and strips zero-width joiners and variation selectors. Frame padding and normalisation use display width rather than string length for correct terminal alignment.

**Non-goals:** Animated animal character (goose or duck) in the console UI.

---

### Full CLI Application (ink-based TUI)

**Entry and project list screen**

The application always opens to the project list screen. On first load, the current working directory is identified against the discovered project list; the matching project is sorted to index 0 and labelled with `(current dir)`. The `GO_PROJECT_LIST` action clears navigation history so Escape on the share-project screen always navigates to the project list and does not carry `currentProjectPath` as payload.

The project list greets the user by first name sourced from git config. Projects are listed with their associated agents, total session count (descending), and per-project Share and Show Stats actions. Projects are sorted by total session count across all agents. A "Share another project" option appears as an option whose heading changes to `Share another project:` after one or more shares. All projects appear in the list regardless of naming or path conventions. Each subfolder with its own `.git` root appears as a distinct project entry. The list is scrollable when entries exceed visible terminal height.

Global project discovery merges worktree entries for the same git repository into a single project list entry.

**Project Share screen**

Displays project path, repo URL if present, agents used with session counts per agent (including all worktrees), number of worktrees, file count and lines of code by programming language (extension-to-language mapping; excludes `node_modules`, `venv`, and gitignored files), total commit count, untracked files count, and tracked files with uncommitted changes. A welcome header appears when this is the first screen. A legend shows Shift+Enter for primary action and Esc for back.

Navigation: Escape goes to the project list screen.

**Consent screen**

Displays CodeSpeak's data use terms (permission to study the project; no commercial software built from the code; retraction contact at `support@codespeak.dev`). Enter is the prominent confirm action; Esc is a visible but secondary dismiss action. Pressing Enter on the consent screen confirms consent.

**Post-share screen**

Shows a Thank You box with the "To request deletion" message as a footnote below the box. "Share Another" is the default highlighted action; "Quit" is the secondary visually de-emphasised action.

**Review Before Sharing screen**

Has a prominent Share CTA at the top. Tabs along the top: a single Sessions tab (showing agent names and session counts as a static read-only list when `SESSION_PREVIEW_ENABLED=false`, or an interactive agent drill-down when enabled; the Sessions tab is hidden if the project has no agents), a Code tab, and a git tab.

The `SESSION_PREVIEW_ENABLED` flag is controlled via `VIBE_SHARING_SESSION_PREVIEW` environment variable and defaults to false.

Code tab: navigable file tree. Files excluded from sharing are labelled "Not Shared" inline; Not Shared folders appear in the tree but cannot be opened. "Shared" files are git-tracked files plus user-selected untracked files. "Not Shared" files are gitignored files and excluded directories.

Git tab: shows git branches and commits per branch.

**Focus zone navigation**

The Review screen tracks a `focusZone` state cycling through tabs, content, and action buttons. Only the active focus zone processes keyboard input at any given time (via `isActive` prop gating on `useInput`). Tab key cycles focus between zones. When focus is in the tabs zone and the user presses down, focus moves to the content zone. When focus is in the content zone and the user reaches the top of the list, focus moves to the tabs zone; at the bottom it moves to the actions zone. The active content zone shows a visible highlight; inactive zones are dimmed. Tab styling shows cyan color, bold text, and cursor indicator only when the content zone is active; otherwise it shows dimmed styling.

`TabBar` does not handle the Tab key internally. `AgentTab`, `CodeTab`, and `GitTab` each accept an `active` prop that gates keyboard input handling. `ScrollableList`'s `active` prop is passed through from parent tab components.

Shift+Enter always triggers the primary action on the focused element. Escape binding is indicated on the Back button; Shift+Enter binding is indicated on the primary action button. ActionBar replaces letter-key shortcuts. A zone indicator and key hint legend appear at the bottom indicating Tab cycles focus zones.

Sessions with empty names (`firstPrompt` is empty string, converted to null at the provider level) display a fallback label. Claude session first messages have `<ide_*>` tags stripped before display. Worktree session files are located using a `findClaudeSessionFile` lookup.

**Project discovery**

Scans agent directories on startup. Recovers workspace paths from orphaned Cursor chat directories by extracting paths from embedded blob data in `store.db` using a regex pattern matching the path followed by a newline or quote character, validated for directory existence. Includes Cursor Composer sessions from `~/Library/Application Support/Cursor/User/workspaceStorage/` by querying `composer.composerData` from `state.vscdb` files. Session counts are computed once when the tab loads via `findSessions()` filtering, not eagerly during the initial directory scan.

**UI appearance**

All screens have a modern, polished visual appearance. The terminal's full height is used for long scrollable lists. Progress bars are displayed during long-running operations. Arrow keys navigate lists; Enter activates the focused element; Escape navigates back.

**Non-goals**

- Agent-specific parsing of manually entered session directory paths
- Git bundle or full history in the Code tab archive view
- Manual filesystem browsing and file picking for session selection (removed in favour of heuristic worktree discovery)

---

### Session Viewer (Next.js Application)

The session viewer is a Next.js application in the `session-viewer/` directory. It imports session discovery logic from the parent project's compiled `dist/` output. It supports dark and light color schemes switchable via a theme toggle available on every page.

#### Project List and Session List

Project discovery results, session metadata, and session entries are cached in a local SQLite database stored at the project repository root (one level above `session-viewer/`). The database path is resolved using `process.cwd()`. WAL and SHM sidecar files are co-located with the main database file. All three database files are excluded from version control.

The SQLite schema supports JSON field-wise indexing. Session entries have a `cwd` column with an index enabling fast project-path filtering. First project list load serves from cache; repeat loads within a 30-second TTL serve from cache near-instantly. Session list loads via indexed `cwd` column query.

Sessions are grouped by project. All internal navigation uses Next.js `Link` component for client-side routing; plain anchor tags are not used for same-origin links.

#### Session Card

Each session card shows:
- AI-generated title when the session contains an `ai-title` entry with `aiTitle` field; otherwise falls back to first lines of user messages, user message count, and agent summary content
- A purple plan badge when the session contains plan file references (detected by scanning JSONL for `~/.claude/plans/` path references in actual tool_use blocks of type Write, Read, or Edit — not textual mentions in tool_result content)
- Session start timestamp, end timestamp, and duration in hours and minutes
- When start and end are on the same calendar day, the date appears once with both times shown; times are 24-hour format (e.g., 15:42)
- When the session year differs from the current year, the year is included
- Single-timestamp sessions show date and time only with no arrow or duration
- Multi-day same-year sessions show month and day for both endpoints; cross-year sessions show the full date including year for both
- Message count and user prompt count combined as `XX msgs (YY prompts)`; user prompt count excludes entries where all content blocks are `tool_result` type
- Agent name badge and plan badge are separate visual elements; card container uses `onClick` + `router.push` for navigation; plan badge is the sole anchor element using a plain `<a>` tag, preventing nested anchor HTML

Sessions on the project page are displayed in a single-column list sorted by last message timestamp descending. Only Claude Code agent sessions are shown on the project page; other agent types are excluded. A shared `SessionStats` component is used by both session cards and the session detail page.

#### Session Detail Page

The detail page displays: AI title as a heading; agent name and plan badges; session ID in monospace; stats row (message count, prompt count, date/time range with duration, file size). Session discovery data and metadata are fetched in parallel. Metadata is retrieved via a single-file read for the requested session only (not a project-wide scan). The server component pre-loads all session entries and passes them as props; the component is force-dynamic for fresh data on every navigation.

Pagination loads additional entries via the API. All entries load automatically in sequence without requiring scroll interaction (eager sequential pagination, not IntersectionObserver-based).

#### Display Architecture (Three-Layer Pipeline)

Card display is computed in three ordered layers:

1. **Per-card defaults:** each entry is classified with `isPrimary` and `defaultExpanded` flags.
2. **Topical grouping:** consecutive related cards (tool-call cycles, progress runs, TodoWrite sequences) are merged into topical groups. Topical groups form only when they contain two or more cards; single-card sequences remain standalone. Filler entries join an active topical group rather than forming standalone groups. Thinking cards are not grouped with agent tool result cards.
3. **Collapsed-group formation:** all non-primary-interest items between any two primary-interest items collapse into exactly one collapsed group (at most one per gap regardless of quantity or variety of non-primary items).

High-signal blocks (user prompts, agent questions, plan interactions, completion reports) are visible and expanded by default. Low-signal and repetitive blocks are collapsed. Every block is reachable — nothing is permanently hidden; all nesting levels have an expand toggle.

Groups containing only queue-operation entries auto-expand on initial render. When a collapsed group is expanded and contains exactly one topical group as its sole child, that topical group expands simultaneously. Collapsed groups display total duration (earliest to latest timestamp) in adaptive time format: `450ms` for sub-second, `12s` for under one minute, `2m 13s` for one minute or longer. The "other" group does not display a duration. Expanded groups display a background tint (`bg-blue-950/20`, border `border-blue-900/30`) and a border; topical groups use `bg-indigo-950/15`, `border-indigo-900/30`.

Collapsed group header layout: left side `▸ XXX cards`; middle tool breakdown as `N ToolName` format (e.g. `3 Subagent`, `8 Bash`); right side duration. The term "Agent" is replaced with "Subagent" throughout all group summaries. Topical group summaries display tool name and count (e.g. `1 Read`, `3 Read, 2 Bash`). Pure-TodoWrite topical group headers display the rich TodoWrite summary format (see TodoWrite section).

#### Entry Cards

All cards share a common `EntryCard` header that renders the type badge exactly once. Cards are individually collapsible. Raw JSON representation is accessible from every card. Block header controls (tool name, file path, timestamp, badges, JSON/rendered toggle) are consistent across all card types.

User message cards use blue background (`bg-blue-950/50`, `border-blue-700/40`). Assistant message cards use green background (`bg-green-950/40`, `border-green-800/40`). User role badge is blue; assistant role badge is green.

Assistant message text content renders as GitHub Flavored Markdown (headings, lists, code blocks, tables, bold, italic, inline code). User message text content renders as plain text.

Message timestamps show date, hours, minutes, and seconds, positioned at the right end of the header row using `margin-left: auto`. Timestamps are visible in both collapsed and expanded states. Rendered/JSON toggle buttons appear only when the entry is expanded, positioned to the left of the timestamp.

The session-level display shows the most frequently used model with format `Models: claude-opus-4-20250514 x42 (default)  claude-sonnet-4-20250514 x3`. Individual cards omit the model label when it matches the session's most common model; cards with a different model display it explicitly. The most common model is marked `(default)`.

**Tool call cards:** Tool names render as amber badges. Bash call headers show the command string (trailing truncation). File operation headers show the file path (leading ellipsis truncation). Grep/glob headers show the relevant path (leading ellipsis truncation). Tool result headers reference the originating tool call via a tool-use-id lookup map to show tool name and contextual detail. Tool block headers display identically in collapsed and expanded states. Tool call node blocks expand by default when the parent entry opens; tool result blocks also expand by default. A shared helper function extracts and formats tool detail for reuse across tool use blocks, tool result blocks, and entry card display.

**Subagent cards:** Cyan-tinted container. Header displays subagent type and description. Card body shows: "Prompt" heading above prompt markdown content (no description repetition); standalone "Worked for XXs" label between prompt and result sections; result content as markdown.

**Thinking cards:** Display a secondary tag marker. Collapsed state shows a content preview.

**AskUserQuestion cards:** Rendered as radio buttons or checkboxes. The selected option is marked as selected. "Other" option is a radio button consistent with other options; if selected, the Other radio button appears selected with the user's comment displayed with clear attribution. Multiple selections in multiSelect interactions are all marked selected. Free-form answers not matching any option display as fallback output.

**ExitPlanMode cards:** Rendered in an expanded (unfolded) state by default. Four distinct answer types: "Approved", "Keep planning", "Cancel" (no comment provided), "Other" (free-form comment not tied to specific plan sections). When the user provided feedback on specific plan sections, the response option selector is hidden. Example navigation links are displayed within or alongside the block.

**ai-title cards:** Title text in card header; no card body.

**FileSnapshot cards with no tracked files:** Header indicates no files tracked; no card body. Cards with tracked files render an expandable file list in the body.

**Plan file interactions (Write/Read/Edit tool use/result targeting `~/.claude/plans/*.md`):** Display the plan file name as a header (e.g., `Plan: snug-sprouting-kahan`) above rendered markdown content. Purple badge marks entry cards referencing plan files. Purple-tinted prose styling via Tailwind typography classes. Markdown tables render as formatted HTML tables.

**TodoWrite cards:** Header shows `[completed/total]` progress bracket followed by up to two affected items as inline status icon plus truncated text; when more than two todos are affected, header shows a count-based summary (e.g., "3 completed, 1 added"). First call with non-pending items shows a status breakdown (e.g., "5 tasks: 4 pending, 1 in progress"). Card body shows the full todo list with status icons: `·` pending, `▶` in progress, `✓` completed, `✗` cancelled. Body uses green for added items and blue for status-changed items. TodoWrite entries have a dedicated `todo-write` entry tag and are grouped topically only with other TodoWrite entries. Pure-TodoWrite topical group headers use the same rich summary format as individual card headers including `[completed/total]` ratio and item texts with status icons (count-based fallback when more than two changes). Todo items are matched by content field for diff computation; diff tracks previous state across successive TodoWrite calls in session order.

**Diff view (Edit tool use):** Edit tool_use blocks with `old_string`/`new_string` render as unified diffs. Line-level comparison uses a longest common subsequence algorithm. Changed substrings within lines are identified using a character-level prefix/suffix algorithm. Removed lines are red with minus prefix; added lines are green with plus prefix. Changed substrings within lines are highlighted with a brighter/more intense version of the line's color.

#### IDE Context Tags

IDE tags (`<ide_*>` pattern) in user messages are rendered as grey clickable badge elements with monospace font displaying the tag name in angle bracket notation (e.g., `<ide_opened_file>`). Clicking toggles the expanded state to show full tag content in a scrollable panel. Long paths in tag content are truncated from the beginning with `...` prefix preserving the filename. Paths beginning with the current working directory are shortened to `$CWD`. `projectPath` is threaded from the server component through the component hierarchy; `cwd` is derived from `projectPath` with fallback to `entry.raw.cwd`.

Collapsed IDE tag badge previews show the first 60 characters of the first line with path truncation and CWD substitution applied.

#### Filter and Expand Controls

The conversation view includes filter controls allowing users to change which block types or signal levels are displayed. Filter state is persisted to `localStorage` and restored on initialisation. Tag pill controls initialise in a visual state matching the current persisted filter state.

Tag pill colors correspond to secondary badge/tag colors where such secondary badges exist:
- Prompts/questions: `bg-blue-900 text-blue-300`
- Plans: `bg-purple-900 text-purple-300`
- Tool calls: `bg-[#3d2f0f] text-yellow-300`
- AI title: `bg-cyan-900 text-cyan-300`
- Progress/queue ops/file snapshots: `bg-neutral-800 text-neutral-400`
- Off/disabled state: `bg-neutral-900` with colored border matching category color, `text-neutral-600` (outlined appearance, muted interior)

Tag pill left side (tag name) is bright when primary interest is set; dim when collapsed. Right-side chevron reflects expanded/collapsed default state. Amber ring indicator appears on pills with customised overrides.

Per-tag filter overrides control expansion and visibility; they do not dissolve or create topical groups (grouping is structural and not subject to filter override). The `overrides` object is threaded through `buildDisplayItems` without restructuring core grouping logic.

An Expand All button expands all collapsed blocks and groups. A Re-apply Filter button re-evaluates and reapplies the current filter to visible blocks. The reapply-key mechanism resets expanded state only in response to actual reapply-key changes, not on initial mount (guarded by a ref to track initial mount).

#### Hash Navigation

URL hash targets an entry: collapsed groups containing the target are expanded (minimal groups only), the target entry is highlighted with a force-expand, and the entry is scrolled into view. Hash is read synchronously in the `useState` initialiser for availability on first render. A `hashchange` event listener handles both initial load and same-page navigation. Plan badge navigation on the session page uses a `PlanBadge` client component with a button element that assigns directly to `window.location.hash` to fire the native hashchange event. Session cards on the project page use plain `<a>` tags since full page loads naturally fire hashchange. Scroll to the target element is deferred using nested `requestAnimationFrame` callbacks to wait for both React's commit phase and the browser's paint phase.

#### Message Type Registry

A dedicated registry page enumerates all known message types displayed in the UI. Each type exposes search criteria (filters, matchers, or identifiers) enabling the registry page to query the cache database for real examples automatically. Adding a new message type without exposing search criteria causes a compile-time enforcement failure. A Rebuild Index button triggers full re-indexing of all session JSONL files and populates `visual:` tags across the entire dataset; results are displayed in the UI after completion. The `getInstancesByTag` SQL query uses `COALESCE` to fall back to a sibling entry's `cwd` when the current entry's `cwd` is null, enabling entry types such as `last-prompt` and `ai-title` to resolve valid session links.

#### Tool-Call Registry Grouping

The `/registry/tool-call` page supports user-defined groups based on a JSON query language. Each group matches registry items by query criteria. Items not matching any group appear in an "Ungrouped" section. A grouping UI toolbar appears at the top of the registry page. Multiple distinct groups coexist simultaneously.

---

### Vibe Personality System

**Metric tracking**

All 49 raw candidate metrics from `vibe-personality.md` are tracked individually in `intent/vibe-personality/TRACKING.md`. Each metric row contains: status emoji, metric name, inline description, and a clickable `cursor://` link to the appropriate stage prompt. As metrics advance through states (plan → implement → test → done), links update to point to the next stage prompt. A clickable 🔄 Sync link at the top of `TRACKING.md` opens Claude Code with instructions to diff `vibe-personality.md` against `TRACKING.md` and surface missing metrics for human review before adding.

Per-metric plan files live in `intent/vibe-personality/metrics/`. Prompt templates live at `prompts/plan.md`, `prompts/implement.md`, `prompts/test.md`, `prompts/done.md`, and `prompts/sync.md`. General workflow instructions live in `intent/vibe-personality/CLAUDE.md`.

Tracking granularity is at the raw candidate metric level — not the 5 V.I.B.E.S. traits and not the sub-signals from `vibe-personality-plan.md`.

**Impatience metric**

Detects three signal types: sequence interruptions (user-prompt appearing after tool-cycle-group), explicit tool rejections (error-flagged events with rejection content), and orphan `tool_use` events (tool_use with no matching tool_result). Calculates three normalised rate metrics: impatience events per user message, impatience events per minute, and tool rejection rate as a ratio. Uses the existing `buildSegments()` grouping utility. Implementation lives in `src/personality/impatience.ts`. Specification stored in `metrics/impatience.md`.

**Permissions observability**

Findings documented in `intent/vibe-personality/permissions.md`. The report covers: permission-related signals in JSONL session logs, approximating auto-approval via `permissionMode` field combined with `permissions.allow` patterns, definitive detection of user rejection via `is_error` tool_result, mode switches via `permissionMode` changes, and the architectural limitation that no explicit flag distinguishes user-clicked approval from auto-approval.

**Personality test**

Accepts a configurable set of projects; defaults to all Claude Code projects on the machine with ability to exclude specific projects. Defines 5 personality traits reliably detectable from code, git history, and agent sessions. Initial archetype system defines approximately 8 named archetypes rather than the full 32-combination set. Only Claude Code agent sessions are supported as the data source. Plan file saved to `intent/vibe-personality/`.

**Non-goals**

- V.I.B.E.S. trait-level or sub-signal-level tracking granularity
- Support for non-Claude coding agents (Cursor, Cline) in the first version
- Full 32-archetype named type system in the initial implementation
- Threshold classification for impatience (rates only, no classification)
- Weighting scheme across impatience signal types
- Modification of the Claude Code client to add an `autoApproved` field

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected in favour of AWS CDK because SST is not officially AWS-supported.
- **Auth0 for authentication** — considered but not selected in favour of AWS-native Cognito.
- **Cloudflare Access with email OTP** — required DNS migration to Cloudflare; not selected.
- **Shared password via CloudFront and Lambda@Edge** — does not support per-user access control; not selected.
- **AWS Chatbot integration for Slack notifications** — involves manual OAuth setup in the AWS Console and adds an AWS-managed service dependency without formatting control; rejected in favour of a custom Slack webhook Lambda.
- **Download Lambda at `/api/v1/download/{uploadId}` returning a 302 redirect** — proposed but rejected in favour of returning the presigned URL directly from the confirm endpoint.
- **Web frontend at `codespeak.dev/share/{id}` via CloudFront and S3 static site** — proposed but rejected as requiring additional infrastructure.
- **S3 lifecycle rule auto-deleting uploads after 90 days** — proposed as a default; rejected because all uploaded data must be retained indefinitely.
- **Cognito default email sender (`no-reply@verificationemail.com`)** — rejected due to 50 emails/day hard cap, high spam classification, and corporate email filter blocking; replaced with Amazon SES.
- **Admin-only user creation** — replaced by self-service sign-up restricted to `@codespeak.dev` domain.
- **Pre-sign-up Lambda auto-confirming and auto-verifying all `@codespeak.dev` users** — bypassed Cognito's native verification flow, allowing unverified accounts to exist; replaced by retaining only email domain validation in the Lambda and delegating verification to Cognito's built-in flow.
- **`npx` invocation without a scoped package name** — unscoped name `codespeak-vibe-share` was proposed; decision point flagged that moving to a scoped name after first publish would require deprecating the original, making early adoption of `@codespeak/vibe-share` preferable.
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — rejected in favour of copying `store.db` files wholesale for broader compatibility.
- **Text-based LIKE matching of plan references in Cursor session blobs** — confirmed to find zero matches because plan references are stored in binary protobuf blobs rather than JSON; abandoned as sole strategy in favour of registry-based discovery via `state.vscdb` `composer.planRegistry` combined with blob-scanning as a dual strategy.
- **`@inquirer/prompts` as TUI framework** — cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation; rejected in favour of ink.
- **Grouping algorithm that placed thinking cards and agent tool result cards into the same topical group** — semantically incorrect; thinking entries must not bridge or initiate tool-call topical groups.
- **Topical groups wrapping single-card sequences in a group container** — rejected as producing unnecessary wrapper structure; single-card sequences remain standalone.
- **Duration displayed in the center summary text of the collapsed group header** — rejected in favour of placing duration on the right side where timestamps appear.
- **Background tint alone (without border) for expanded groups** — not visually distinct enough; replaced by background tint plus border.
- **FTS5 full-text search index for session entry search** — insufficient for JSON field-wise querying; rejected in favour of structured indexed columns.
- **IntersectionObserver sentinel for lazy loading** — unreliable: with collapsed groups keeping the page short, the sentinel remained in viewport on initial load and never triggered again due to observer recreation and a race condition; replaced with eager sequential pagination.
- **Opening session links in a new tab to avoid registry page re-mounting on back-navigation** — avoids the actual problem rather than fixing it; rejected in favour of server-side initial data load.
- **bfcache recovery detection via `pageshow` event listener** — did not resolve the stuck loading state; rejected as ineffective; root cause was navigation inconsistency from plain anchor tags, resolved by using Next.js `Link` component consistently.
- **Plain anchor tags for same-origin internal navigation links** — triggered full page loads and exited the SPA, preventing Next.js router cache from being populated; replaced with Next.js `Link` component for all same-origin links.
- **Stale cache guard and bfcache recovery code in SessionClient** — were compensating for an upstream routing issue (plain anchor tags) now resolved; removed.
- **`import.meta.dirname` for SQLite database path resolution** — Next.js compiles source files to `.next/`, making `import.meta.dirname` resolve to the compiled location at runtime; rejected in favour of `process.cwd()`.
- **SQLite cache stored at `~/.claude/.session-viewer-cache.db`** — rejected in favour of project-directory storage to keep project data co-located.
- **Per-agent tabs in the review screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **Amber-tinted user message cards** — not visually distinct enough from assistant message cards; replaced by blue/green scheme.
- **Deriving role badge color from `entryTag` classification** — caused the assistant badge to render in purple for plan edit cards, misrepresenting the role's semantic color; separated so role badge color derives from `displayType` semantics and plan badge is a distinct element.
- **Rendering diffs without intra-line substring highlighting** — only shows which lines changed without indicating what within those lines changed; replaced by a line-level LCS diff paired with a character-level prefix/suffix highlight algorithm.
- **Grouping TodoWrite entries under the generic `tool-call` tag** — caused TodoWrite entries to merge into topical groups with Read, Write, and Bash tool calls; replaced by a dedicated `todo-write` entry tag with its own topical grouping rules.
- **Producing only a text-based file tree of the project directory structure without actual file contents** — confirmed as incomplete; actual filtered file copies are required.
- **Removing excluded directories entirely from the vibe-share archive** — rejected in favour of preserving directory entries while excluding their contents.
- **`codespeak-vibe-share-${Date.now()}.zip` as the archive filename pattern** — the `vibe-share` segment is not useful; replaced by a dynamic project-based name plus timestamp.

---

## Known Issues

- Some Claude sessions display only a UUID in the Review screen rather than a meaningful name.
- Gemini CLI sessions directory reports 2 sessions found but none appear in the Review screen.
- Example links for "Cancel (Esc) with user comment" and "Cancel (Esc) without comment" in ExitPlanMode blocks appear mislabelled — the examples do not match their described response types.
- Opening any Cursor session in the Review screen for the `khariton-style` project shows "No messages found in this session" despite the session existing and containing messages.
- Up navigation in the main content list on the Review screen is broken.
- `/sentry-triage` user messages may not exist in the data despite the pattern appearing in tool call nodes — investigation of whether such user message content is present in the data is in progress.
- The assistant badge in plan edit cards does not render in green after the `displayColorClass` fix — `displayColorClass` may not correctly map the assistant display type to green.
- Navigating from a registry entry to a session and then pressing back/forward may leave the session detail page stuck in a loading state when `highlightEntry` state is stale after client-side navigation within the same session; hash highlight regression root cause not yet confirmed after the most recent fix attempt.