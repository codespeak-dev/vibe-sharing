# Vibe-Sharing / CodeSpeak CLI Specification

## Overview

CodeSpeak Vibe-Share is a command-line tool that lets developers easily package and share vibe-coded projects together with the complete AI agent session histories used to build them. It discovers sessions from Claude Code, Cursor, Codex, Gemini, and other agents; filters out secrets and dependency noise; bundles project files, git state, and session transcripts into a portable archive; and uploads the result to a serverless AWS backend. A companion web application allows authenticated team members to browse and download uploaded archives. A session viewer application provides deep inspection of AI agent session content grouped by project. The system is designed for zero-configuration use by non-technical users running `npx codespeak-vibe-share`, while giving operators full observability through Slack notifications, CloudWatch alarms, and DynamoDB upload records.

---

## Foundation

**Stack:** TypeScript, Node.js 22.x, React/ink (terminal UI), Next.js (session viewer web app), AWS CDK (infrastructure), AWS Lambda (Node.js 22.x, esbuild bundled, CommonJS), API Gateway HTTP API v2, DynamoDB, S3, SNS, CloudWatch, Amazon Cognito, Amazon SES, AWS SSM Parameter Store.

**Architecture:**
- *Deployment topology:* Serverless AWS backend (Lambda + API Gateway) deployed via CDK; CLI distributed via npm/npx; web admin UI served via CloudFront static hosting; session viewer runs as a Next.js application.
- *Communication pattern:* CLI calls API Gateway presign endpoint to obtain an S3 presigned PUT URL, uploads directly to S3, then calls the confirm endpoint; upload events are published fire-and-forget to SNS topics; CloudWatch alarms publish to a separate SNS topic.
- *Data model:* DynamoDB table stores upload metadata (uploadId, status, timestamp, IP, email, name, repoUrl, S3 key); InternalEmailsTable stores flagged internal email addresses; S3 stores zip archives indefinitely.
- *Authentication:* Cognito User Pool with hosted domain protects the admin web UI and the `/api/v1/uploads` route via JWT authorizer; CLI uploads are unauthenticated.

**Cross-cutting constraints:**
- All Lambda functions must use the Node.js 22.x runtime.
- IAM permissions follow least-privilege: Presign Lambda holds only `dynamodb:PutItem`; Confirm Lambda holds `dynamodb:GetItem`, `dynamodb:UpdateItem`, and `s3:GetObject`; Slack Lambda holds read-only access to the SSM SecureString parameter.
- Secrets and credentials belonging to the tool operator must never be stored on or downloaded to the user's machine.
- The CLI must be robust against exceptions — failures must never present as raw stack traces or silent exits.
- The CLI must be cross-platform (macOS, Linux, Windows) with no platform-specific installation procedures.
- Telemetry payloads must be sanitized before transmission — no personally identifiable or sensitive content.
- Configuration values (region, domain names, alarm email, CORS origins) are centralised in a shared config file rather than hardcoded inline.

---

## Features

### CLI Tool

#### Distribution and Entry Point

The package is published to the npm public registry under the scoped name `@codespeak/vibe-share`. The `bin` field maps the command name `codespeak-vibe-share` to the entry point script, which carries a Node.js shebang line. The package is set to public visibility and published with `--access public`. Published files are restricted to the compiled `dist/` directory via the `files` field. A `prepublishOnly` script runs TypeScript compilation before publishing. Users invoke the tool via `npx codespeak-vibe-share` with no prior installation or configuration required.

The default API endpoint is `https://vibe-share.codespeak.dev`. The endpoint can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable.

#### Startup and Identity

At startup the CLI reads email and username from git config. Prompts for these fields are shown only when git config values are absent or unset. The CLI auto-detects the git remote URL to pre-populate the repo URL field; when no git remote is configured, the repo URL prompt is skipped entirely.

#### Privacy and Consent

A prominent privacy notice appears before any file packaging or upload begins, explaining what data will be collected, how it will be used, and emphasising privacy protection. Explicit user consent is required before uploading or sharing anything. The sharing consent prompt defaults to `Y` (true); the uppercase `Y` is displayed to indicate it is the active default. The notice includes a `(best effort)` qualifier on secrets-protection messaging to set accurate expectations.

#### Project Detection and File Collection

The tool detects whether the current directory is under git version control. It correctly identifies the project root when invoked from any subfolder, including projects without a `.git` directory; the non-git fallback must not silently use the wrong encoded path for session lookup.

**Git projects:**
- Produces a `file-listing.txt` listing all files and directories recursively.
- Produces a `git-status.txt` containing the output of `git status`.
- Produces two separate diff files: one for unstaged changes (`git diff`) and one for all uncommitted changes versus HEAD (`git diff HEAD`).
- Produces an `untracked/` directory containing untracked files that are not gitignored.
- Produces a git bundle using `--all` refs. Bundle creation failures (empty repository, shallow clone, corrupted refs) are caught and represented as `null`; archive creation continues without a bundle. For empty repositories, all files are captured as untracked and archived under `project/untracked/`.
- Uses `git ls-files` and `git ls-files --others --exclude-standard` to capture tracked and untracked files while respecting `.gitignore`.

**Non-git projects:**
- Walks the directory using configurable exclude patterns.
- Automatically excludes `.venv`, `node_modules`, `.env.local`, and similar dependency/virtual-environment directories.
- Allows the user to customise the exclusion list before packaging.

**Secret filtering:** Excludes `.env` files, key files, and other sensitive content. Masks or redacts sensitive keys found in session data before including sessions in the archive.

**Archive size estimation** sums all content types: for git repos, text output sizes plus bundle file size plus untracked file sizes; for non-git repos, all project file sizes.

#### Session Discovery

The tool locates AI agent sessions associated with the project. Session discovery runs across all git worktrees associated with the same repository, not just the current working directory. Branch information for each worktree is read directly from each worktree's `HEAD` file in `.git/worktrees/<name>/HEAD`.

**Claude Code:** Locates sessions at `~/.claude/projects/<encoded-path>/`, collecting the full directory including all subagent sessions and `tool-results/` subdirectories. Scans both indexed sessions and non-indexed JSONL files. Reads working directory only from user-type messages for project filtering. Sessions with empty `firstPrompt` strings are converted to `null`. Session count computation occurs once when the tab loads via `findSessions()` filtering, not eagerly during directory scanning.

**Cursor:** Locates sessions by scanning `workspaceStorage/*/workspace.json` files to match workspace by path (`findWorkspaceStorageDir`). Extracts all `composerIds` for the workspace from `state.vscdb` (`getWorkspaceComposerIds`). Includes Composer sessions from `workspaceStorage` state in addition to chat directory sessions; deduplicates using seen identifiers. Recovers workspace paths from orphaned chat directories by extracting paths embedded in `store.db` blob data using a regex pattern matching the path followed by a newline or quote character, validated with a directory existence check. Copies `store.db` SQLite database files wholesale into the archive.

**Plan discovery:** Scans all session files (including subagent sessions) for references to plan files under `.claude/plans/` and debug files matching the pattern `.claude/debug/<uuid>.txt` using grep against session transcript content. Registry-based discovery via `composer.planRegistry` in `state.vscdb` runs in parallel with blob-scanning; both strategies always execute and results are merged. The `composerId`-to-`agentId` mapping is resolved by querying `composer.composerData` entries in `cursorDiskKV` or workspace-level `composer.composerData`. Only debug files and plan files explicitly referenced in session transcripts or discoverable via the registry are collected — orphaned or unreferenced files are excluded.

**Gemini and Codex:** Locates file-system-stored sessions for these agents. If no supported agent session is found, the tool offers an option to locate sessions manually. When a user manually enters session directory paths for an unknown agent, all files from those directories are included as-is without agent-specific parsing.

If no agent sessions are found via heuristic discovery, the tool offers worktree-based heuristic discovery as the supported path; no filesystem browse option is shown.

#### Archive Structure

The archive filename uses the repository name extracted from the git remote URL when available (supporting SSH, HTTPS with/without `.git` suffix, and git:// URLs, stripping the `.git` suffix); it falls back to the project folder name. Format: `<reponame>-<timestamp>.zip`. The `vibe-share` string does not appear in archive filenames.

Archive layout:
- `project/` — project files (filtered for secrets and dependencies)
- `project/untracked/` — untracked files
- `sessions/.claude/` — replicates the local `.claude` directory hierarchy with path fidelity; session project files stored under `.claude/projects/<encoded-path>/`; plan files under `.claude/plans/`; debug files under `.claude/debug/`
- `.cursor/` subtree — Cursor session files replicating source structure, including wholesale-copied `store.db` files and a filtered `state.vscdb` extract containing `composer.planRegistry` from global state, `composer.composerData` from workspace state, and matched `composerData` UUID entries from `cursorDiskKV`
- `discovery-manifest.json` — intermediate findings including hashes, slugs, composerIds, plan matches, original paths, and algorithms
- `workspace.json` — workspace metadata

Excluded directories are retained as entries in the archive with their contents excluded, not removed entirely.

#### Upload Flow

Before uploading, the CLI checks backend availability via the health endpoint and falls back to producing a local zip file if the backend is unreachable or disabled. The `--output` flag saves the archive locally as an explicit alternative.

Upload steps:
1. Generate presigned S3 PUT URL by calling the presign endpoint with optional metadata (email, name, repo URL).
2. Upload the zip file directly to S3 with `Content-Type: application/zip`.
3. Call the confirm endpoint to verify the S3 object exists and mark the upload confirmed.

The post-upload success message does not display a download URL. The confirm endpoint response does not include a `shareUrl` field; no share URL is generated, presigned, or displayed in CLI output.

On upload failure, the CLI displays which step failed (e.g., "confirm step") along with suggestions to use `--output` for local save and `--verbose` for detailed diagnostics. With `--verbose`, the full error cause chain including HTTP status code and response body is shown.

#### Error Telemetry and Diagnostics

The CLI generates a correlation ID that flows through each step of the upload journey, enabling end-to-end tracing. The CLI writes a local diagnostic log file on every run with timestamped debug output. On failure, the CLI automatically sends sanitized error telemetry to the backend capturing error type, failure step, OS version, Node version, and sanitized error message. Telemetry is sent without requiring explicit user opt-in.

#### Modes (Plugin/Script Interface)

The system operates in three modes:
- **Scan mode:** audits existing project state and reports counts of session transcripts, plan files, and debug files.
- **Build mode:** collects sessions, referenced plans, and referenced debug files; packages them into a zip archive with subdirectories `claude-plans/` and `claude-debug/`; outputs a build report including session count, plan count, and debug count.
- **Review mode:** previews the contents of the packaged zip archive.

#### Terminal UI (ink-based)

The CLI uses ink (React for terminal) as its TUI framework to support tabs, file tree navigation, text preview, and screen-to-screen navigation. Navigation uses arrow keys and Enter throughout; single-letter keyboard shortcuts are not used. Tab cycles focus between three distinct zones: tabs, content list, and action buttons. Only the active focus zone processes keyboard input at any time. Shift+Enter triggers the primary action on the focused element. Escape navigates back; the Back button displays a hint indicating this. The primary action button displays a hint for Shift+Enter.

**Project List screen:** displays all discovered projects, greeting the user by first name from git config when available. Projects are sorted by total session count descending. Each entry shows agent names and per-project actions. The project matching the current working directory is labelled `(current dir)`, sorted to index 0, and pre-selected. When one or more projects have already been shared, the heading reads "Share another project:". The list is scrollable when entries exceed terminal height. The screen includes a "Share another project" option. Global project discovery merges worktree entries for the same git repository into a single entry with combined agent lists and aggregated session counts.

**Share Project screen:** displays project path, repo URL, agents with session counts, file count and LOC by programming language (using extension-to-language mapping, excluding `node_modules`, `venv`, and gitignored files), total commit count, untracked file count, tracked files with uncommitted changes, and worktree count. Session counts include sessions from all worktrees. Displays a welcome header when it is the first screen the user sees. Shows a legend with Shift+Enter for primary action and Esc for back. Pressing Escape navigates to the All Projects screen.

**Consent screen:** displays CodeSpeak's data use terms (permission to study the project; no commercial software built from the code; retraction contact at `support@codespeak.dev`). Enter confirms consent (visually prominent). Escape is the secondary dismissive action (visually de-emphasized). The "To request deletion" message renders as a footnote outside the Thank You box.

**Review Before Sharing screen:** has a single Sessions tab (showing agent names and session counts; when `SESSION_PREVIEW_ENABLED` is true, allows drilling into full agent tab with interactive session preview). Code tab shows a navigable file tree where excluded files are labelled "Not Shared" and cannot be opened. Git tab shows branches and commits. A prominent Share CTA appears at the top. Focus zone state cycles through tabs, content, and action buttons; tab component displays cyan color, bold text, and cursor indicator only when its content zone is active; dimmed styling when inactive. Project path is displayed at the top of the screen at all times, above the tab bar, in bold. A legend at the bottom indicates Tab key navigation and available shortcuts.

**Post-share screen:** Thank You box with "Share Another" as the default highlighted action and "Quit" as the secondary de-emphasized action.

Progress bars are displayed during long-running operations. When a significant proportion of messages are hidden, the system proactively loads additional messages to maintain adequate visible content.

**Feature flag:** `SESSION_PREVIEW_ENABLED` is controlled via the `VIBE_SHARING_SESSION_PREVIEW` environment variable and defaults to `false`. When disabled, the Sessions tab displays a static read-only list of agent names and session counts. The Sessions tab is shown only if the project has agents. The agents section in the Share Project screen is always visible regardless of the flag.

#### Gratitude Animation

The terminal UI displays a progression of gratitude-themed pseudographic frames in the bottom-left corner of the screen during checkbox and select prompts. Frames cycle on each navigation keypress (arrow keys, space, numbers) and disappear on Enter. The progression consists of exactly 4 frames with identical height and display-column width:
- Frame 0: 💛 hearts diamond pattern with "THANK YOU!" message
- Frame 1: 🌟 star border with "YOU ARE AMAZING!" message
- Frame 2: 🎉🙏🎊 celebration theme with "SO MUCH GRATITUDE!" message
- Frame 3: 🏆🔥 trophy theme with "YOU'RE THE BEST!" message

Frame padding and normalization use display width rather than string length. Emoji count as 2 terminal columns; zero-width joiners and variation selectors are stripped before width calculation.

---

### Backend (AWS)

#### Lambda Functions

Four Lambda functions, all Node.js 22.x, bundled via esbuild within CDK (CommonJS output):

**Presign Lambda:** validates the request, generates an S3 presigned PUT URL capped at 5 GB, writes an upload record to DynamoDB with `PutItem`, publishes a fire-and-forget notification to the upload events SNS topic (filename, size, IP, user info), and returns the presigned URL.

**Confirm Lambda:** verifies the S3 object exists via `HeadObject` (requires `s3:GetObject` IAM permission), updates the DynamoDB record status via `GetItem` + `UpdateItem` using atomic conditional writes, publishes a notification to the upload events SNS topic (success: filename, size, upload ID; failure: filename, missing from S3), and returns the upload ID. Does not return a `shareUrl` field. S3 errors during HeadObject checks are logged, not silently swallowed.

**Health Lambda:** returns `{ status: "ok" }`.

**Slack Notify Lambda:** subscribes to both the infrastructure alarms SNS topic and the upload events SNS topic. Retrieves the Slack webhook URL from SSM Parameter Store at `/vibe-share/slack-webhook-url` at runtime. Caches the webhook URL with a 5-minute TTL; invalidates the cache immediately upon receiving an error response from Slack. Throws on Slack delivery failure so SNS can retry (up to 2 additional retries). Logs a warning and continues gracefully if the SSM parameter is absent, so email alerting is not disrupted. Queries `InternalEmailsTable` at notification time to determine whether an upload is from an internal user; the result is passed through the notification call chain. Top-level Slack messages are human-readable plain text; thread replies contain full structured data as pretty-printed JSON wrapped in triple-backtick code fences. For upload notifications, the initial message includes the user's name, email, and repository URL; detail updates are posted as threaded replies; upload completion adds a download link (pointing to the admin web UI authenticated download flow) to the top-level message. Each upload generates its own independent Slack thread. Internal upload top-level messages are prefixed with the `:codespeak:` emoji. CloudWatch alarm notifications follow the same structure (human-readable top-level, formatted JSON in thread). Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes to deterministically resolve which handler creates the thread.

**List-uploads Lambda:** scans DynamoDB for confirmed uploads and returns presigned download URLs with 1-hour expiry.

**Pre-sign-up Lambda (Cognito trigger):** rejects email addresses not ending in `@codespeak.dev`. Auto-confirms and auto-verifies email addresses ending in `@codespeak.dev` for the self-registration flow. Does not bypass Cognito's native email verification.

#### API Gateway

HTTP API v2 with throttling. Rate limiting at 10 requests per minute per IP. Routes:
- `POST /api/v1/presign`
- `POST /api/v1/confirm`
- `GET /api/v1/health`
- `GET /api/v1/uploads` (protected by Cognito JWT authorizer)
- Telemetry ingestion endpoint

CORS `allowOrigins` is configured as an explicit list of specific domain strings (no wildcards): `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`. Custom domain: `vibe-share.codespeak.dev`.

#### S3

Single bucket storing zip archives indefinitely with no lifecycle expiry. Presigned PUT URLs enforce `Content-Type: application/zip`; S3 returns 403 on mismatch. CORS configuration uses `s3CorsAllowedOrigins` from the central config (supports wildcard syntax, e.g. `*.codespeak.dev`). All public access is blocked.

#### DynamoDB

Single `Uploads` table with fields: `uploadId`, `status`, `timestamp`, `IP`, `email`, `name`, `repoUrl`, S3 key. Point-in-time recovery enabled via `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`. `InternalEmailsTable` stores flagged internal email addresses.

#### SNS

Two separate topics:
- **Infrastructure alarms topic:** receives CloudWatch alarm notifications; delivers to `alarms@codespeak.dev` email subscription and to the Slack Notify Lambda simultaneously.
- **Upload events topic:** receives presign and confirm Lambda notifications; delivers to the Slack Notify Lambda only (no email subscription).

#### CloudWatch Alarms

Four alarms, each with both `addAlarmAction` and `addOkAction` pointing to the infrastructure alarms SNS topic:
- Lambda errors exceeding 5 in 5 minutes
- API 4xx errors exceeding 50
- API 5xx errors exceeding 5
- (plus one additional alarm as configured)

#### SSM Parameter Store

- `/vibe-share/slack-webhook-url` — SecureString; Slack webhook URL; supports overwrite on re-deployment.
- SSM `PutParameter` calls use the overwrite flag to avoid `ParameterAlreadyExists` errors on redeployment.

Alarm notification email address is stored in the version-controlled config file (not SSM) as it is classified as non-sensitive.

#### Custom Domain and TLS

ACM certificate provisioned for `vibe-share.codespeak.dev` with DNS validation. DNS records are configured manually at the external registrar. CDK stack `env` is configured with explicit AWS account and region values. ACM certificate for the admin web UI CloudFront distribution must be created in `us-east-1` regardless of the primary stack deployment region (`eu-north-1`), due to CloudFront's architectural requirement.

#### CDK Infrastructure

Infrastructure is defined in TypeScript using AWS CDK. CDK Bootstrap must be run from within a directory containing a valid `cdk.json` or with an explicit `aws://ACCOUNT_ID/REGION` argument. SSO-based credentials (`aws configure sso`) are supported. A `cdk-deploy` script in `scripts/` invokes CDK deploy with auto-approve automatically. An `.envrc` file at the project root sets `AWS_PROFILE` to `default` and is sourced automatically by direnv on directory entry and unset on exit. The `scripts/` directory is added to `PATH` via `.envrc`.

#### Security Posture

Confirmed out-of-scope for remediation: unauthenticated endpoints, abandoned upload and pending record cleanup, generic error message remediation, WAF protection, CloudFront CDN and Shield Standard DDoS protection.

---

### Admin Web UI

A serverless web interface served via CloudFront at `https://admin.vibe-share.codespeak.dev`. Allows authenticated users to browse and download uploaded files. Authentication via Amazon Cognito User Pool with hosted domain and OAuth login flow.

#### Authentication

Cognito User Pool allows self-registration restricted to `@codespeak.dev` email addresses via the pre-sign-up Lambda trigger. Users outside `@codespeak.dev` cannot self-register. New users receive a temporary password via email and must set a permanent password on first login. Email verification is required before an account is active; verification and password recovery emails are delivered via Amazon SES (configured in `us-east-1`, `us-west-2`, or `eu-west-1`) to avoid Cognito's default sender 50 emails/day cap and spam classification issues.

A user creation script in `scripts/` accepts an email argument, resolves the Cognito User Pool ID from CDK stack outputs, and uses AWS CLI `admin-create-user` to create users with a username and temporary or permanent password.

#### File Browsing

Authenticated users can browse and download uploaded files. The list-uploads Lambda scans DynamoDB for confirmed uploads and returns presigned download URLs with 1-hour expiry.

#### Internal Uploads Management

User emails can be flagged as internal, stored in `InternalEmailsTable`. Internal emails are filtered out from the main user table by default. A checkbox toggles visibility of internal emails. A per-row button marks a user's email as internal from the main table. A dedicated management page allows adding emails to the internal list. Internal upload rows display a 🛠️ wrench emoji prepended to the filename and are styled with background `#f0f0f0` (hover `#e8e8e8`). The `Show internal uploads` checkbox state is persisted to and restored from `localStorage`.

#### GitHub URL Normalisation

All recognised GitHub URL formats — HTTPS with/without `.git` suffix, SSH (`git@github.com:user/repo.git`), `git://` protocol, URLs with trailing path segments — are normalised to a shortened `user/repo` display label rendered as a hyperlink to `https://github.com/user/repo`.

---

### Session Viewer (Next.js)

A Next.js application in the `session-viewer` directory that imports session discovery logic from the parent project's compiled `dist/` output rather than duplicating it.

#### Project and Session List

Sessions are grouped by project. Each `ProjectCard` shows only the session count pill in the top-right area; no agent badge is rendered until multiple agent types are supported. Sessions within a project are displayed in a single-column list sorted by last message timestamp, most recently active first.

Each `SessionCard` displays:
- AI-generated title from the `ai-title` entry's `aiTitle` field, or falls back to first lines of user messages, user message count, and agent summary content.
- Purple plan badge when the session contains `~/.claude/plans/` path references.
- Start timestamp, end timestamp, and duration in hours and minutes.
- Same-day sessions: date shown once with both start and end times. Multi-day same-year: month/day pairs for both endpoints. Cross-year: full date including year on both endpoints. Identical start/end: single timestamp with no arrow or duration. All times in 24-hour format. Year included only when the session date differs from the current year.
- Message and user prompt counts in format `XX msgs (YY prompts)`. User prompt count excludes entries where all content blocks are `tool_result` type.

Consolidated single-pass JSONL scanning extracts session titles, plans, and prompt counts in one read per file, with plan detection and AI title extraction running in parallel.

#### Session Detail Page

Loads JSONL entries via a paginated API. Displays as a sequence of `EntryCard` components, each with the type badge rendered exactly once in the card header. Supported card behaviours:
- `ai-title`: displays title in card header, no body.
- `FileSnapshot` with no tracked files: displays "no files tracked" in header, no body.
- All non-user-message cards are collapsed by default showing minimal header information; user message cards are expanded by default.
- Tool-result messages (user messages whose content consists exclusively of `tool_result` content blocks) are collapsed by default and display an amber "tool result" badge.
- Consecutive non-user messages between user turns are hidden behind a clickable ellipsis showing the count of hidden messages.
- When a significant proportion of messages are hidden, additional messages are proactively loaded to maintain adequate visible content.

Each entry offers a "show JSON" view (formatted, syntax-highlighted, long strings truncated with ellipsis; clicking a truncated string reveals full unescaped multiline value) and a "show rendered" view for recognised message types. Claude session messages strip `<ide_*>` tags from display.

The session detail page header displays: AI-generated title, agent name badge, plan badge, session ID (monospace), and a stats row (message and prompt count, date/time range with duration, file size). The stats row is implemented as a shared `SessionStats` component also used by `SessionCard`. Session discovery data and metadata are fetched in parallel on the detail page.

---

### Operational Scripts

- `status.sh` — queries DynamoDB and prints all upload records in a fixed-width table with columns: NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. SIZE in human-readable format (e.g., 2MB). CONFIRMED shows `-` when absent. Timestamps in ISO 8601. Lambda logs fetched only when `--logs` flag is passed.
- `clear-uploads.sh` — displays count of items to be deleted, requires the user to type `delete all` exactly, then deletes all DynamoDB records and all S3 objects.
- `cdk-deploy` (in `scripts/`) — invokes CDK deploy with auto-approve flag.
- Session log extraction script — reads all Claude session log files for the current project from `~/.claude`; extracts user messages, `AskUserQuestion` tool prompts and answers, `ExitPlanMode` requests with plan approval/rejection results, TODO creation and status change events, and Claude implementation-completion messages; writes all items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters; additionally writes one per-session file into `intent/sessions/`.

The `scripts/` directory is on `PATH` via `.envrc`.

---

### Claude Code Plugin (Slash Command Interface)

A Claude Code plugin providing a `/vibe-share` slash command that invokes the shell script in scan mode. Plugin installed under `.claude-plugin/`. The plugin installation path resolution must correctly find the script before attempting to execute it. The `.claude-plugin/` directory has no special exclusions in find commands, zip exclusion flags, or standalone script exclusion lists.

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected because SST is not officially AWS-supported; AWS CDK chosen instead.
- **AWS Chatbot for Slack notifications** — involves manual OAuth setup in the AWS Console; rejected in favour of a custom Slack webhook Lambda to retain formatting control and avoid AWS-managed service dependency.
- **Storing the Slack webhook URL in a configuration file** — rejected in favour of SSM Parameter Store to avoid exposing sensitive credentials in source code.
- **Indefinite SSM webhook URL cache with no TTL** — replaced with a 5-minute TTL so that a rotated webhook URL propagates automatically without a Lambda redeploy or cold start.
- **Slack delivery failures caught-and-logged without rethrowing** — replaced with rethrowing on failure so SNS treats the delivery as failed and can retry.
- **S3 lifecycle rule auto-deleting uploads after 90 days** — rejected; all uploaded data must be retained indefinitely.
- **Single CORS configuration list for both API Gateway v2 and S3** — rejected because API Gateway v2 does not support wildcard characters in `allowOrigins` while S3 does; split into two separate lists (`corsAllowedOrigins` for API Gateway, `s3CorsAllowedOrigins` for S3).
- **Wildcard subdomain pattern `https://*.codespeak.dev` in API Gateway HTTP API v2 `allowOrigins`** — deployed and rejected by AWS at deployment time; API Gateway v2 does not permit wildcard characters in `allowOrigins`.
- **`aws configure` static IAM credentials as the example setup** — user chose SSO-based login (`aws configure sso`) instead; both are valid.
- **Running `npx cdk bootstrap` from the backend directory without an explicit environment argument** — fails because the directory lacks `cdk.json`; CDK cannot resolve the target AWS environment without it.
- **Setting `AWS_PROFILE` as a system-wide environment variable in `~/.zshrc`** — rejected because it applies globally across all projects rather than being scoped to this project.
- **Adding a `profile` field to `cdk.json`** — rejected because it scopes the profile to CDK commands only, not to raw AWS CLI commands.
- **`s3:HeadObject` IAM action for S3 HeadObject operations** — not a valid IAM action; replaced with `s3:GetObject`.
- **Broad DynamoDB IAM grants (`grantWriteData`, `grantReadWriteData`)** — exceeded least-privilege; replaced with exact action grants.
- **Deprecated `pointInTimeRecovery` DynamoDB property** — replaced with `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`.
- **Storing alarm notification email in SSM Parameter Store** — classified as non-sensitive plain configuration; stored in checked-in config file instead.
- **`codespeak-vibe-share-${Date.now()}.zip` archive filename pattern** — rejected because the `vibe-share` segment adds no value to archive names.
- **Placing session JSONL files under `sessions/claude-code/` with plans and debug files under `sessions/claude-code/referenced/`** — rejected in favour of replicating the actual `.claude` folder structure directly under `sessions/.claude/`.
- **Producing only a text-based file tree without actual file contents** — rejected; actual filtered file copies are required.
- **Removing excluded directories entirely from the archive** — rejected; directory entries are preserved even when their contents are excluded.
- **Collecting all debug files from the filesystem regardless of session transcript references** — rejected in favour of grep-based reference detection to avoid including orphaned or unrelated debug logs.
- **Text-based LIKE matching of plan references within session chat blobs in Cursor store.db** — confirmed to find zero matches because plan references may be stored in binary protobuf blobs; abandoned as sole strategy in favour of registry-based discovery via `composer.planRegistry` combined with blob-scanning as a dual strategy.
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — not chosen; wholesale copying of `store.db` files is the selected approach for maximum compatibility.
- **Timing heuristic using delay between `tool_use` and `tool_result` timestamps to infer auto-approval** — rejected because execution time noise conflates user response time with actual tool execution time, making inference unreliable.
- **`promptId` field as a signal for auto-approval correlation** — investigated and rejected; did not correlate with auto-approval behaviour as assumed.
- **Hardcoding the raw API Gateway URL as the CLI default** — rejected because the URL is fragile and changes if the AWS stack is recreated; custom domain used instead.
- **Completing DNS validation for the `api.codespeak.dev` certificate** — rejected; the pending certificate targeted the wrong domain and should be cancelled rather than validated.
- **Auth0 for authentication** — considered and deferred; Cognito chosen for the web UI.
- **Cloudflare Access with email OTP** — required DNS migration to Cloudflare; not selected.
- **Shared password via CloudFront and Lambda@Edge** — does not support per-user access control; not selected.
- **Download Lambda at `/api/v1/download/{uploadId}` returning a 302 redirect to a presigned URL** — proposed and rejected in favour of returning the presigned URL directly from the confirm endpoint (later removed entirely).
- **`shareUrl` presigned GET URL returned from confirm endpoint** — implemented with 7-day expiry, then removed entirely because the backend confirm endpoint never returned `shareUrl` in the deployed version, making the client-side field permanently undefined.
- **Requiring explicit user opt-in consent before sending error telemetry** — rejected; telemetry sent without consent requirement.
- **Using an environment variable to supply the server URL** — rejected because end users cannot be expected to know or set this value.
- **Per-agent tabs in the Review screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **Goose ASCII art animation frames** — rejected for being unrecognisable as a goose; entire animated animal character concept subsequently rejected in favour of gratitude-themed pseudographic progression.
- **Pure pseudographic ASCII art gratitude frames without emoji** — replaced by emoji-based frames.
- **`@inquirer/prompts` as TUI framework** — rejected because it cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation.
- **`initialCursor` prop on `ScrollableList` to pre-position the cursor** — replaced by sorting the current project to index 0, making the prop redundant.
- **Patch version bump to 0.1.1** — scope of accumulated features judged to warrant a minor bump to 0.2.0 instead.
- **Full 32-archetype named type system for the vibe coder personality test** — rejected in favour of starting with approximately 8 key archetypes.
- **Displaying both an agent badge and a session count pill on each `ProjectCard`** — rejected; the two elements function as session-type badges, creating visual clutter without differentiation value; agent badge deferred until multiple agent types are supported.
- **Three separate JSONL scan functions for titles, plans, and prompt counts** — consolidated into a single-pass scan.
- **12-hour time format with AM/PM in session viewer** — rejected in favour of 24-hour format.
- **`useMemo` for grouped entry segments placed after early return statements in `SessionClient`** — violated React Rules of Hooks; relocated to before all early returns.
- **Browse filesystem option in the no-sessions prompt** — was a non-functional stub; removed in favour of worktree-based heuristic discovery.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen instead of a meaningful label.
- Gemini CLI sessions report 2 sessions found but none appear in the Review screen.
- Opening a Cursor session in Review for the `khariton-style` project shows "No messages found in this session" despite the session existing and containing messages.
- Up navigation in the main content list on the Review screen is broken.
- Some projects that have hyphens in their path are ambiguous under the lossy `decodeProjectPath` conversion (hyphens to slashes), causing them to fail project list discovery.
- The pre-sign-up Lambda previously auto-confirmed users and auto-verified email attributes, bypassing Cognito's native verification flow; this has been fixed, but unverified accounts created before the fix may exist.
- 90.6% of Cursor chat hashes in chats storage do not match current `workspaceStorage` entries; these appear to be stale records from deleted workspaces, a migration path that did not update references, or parallel ID schemes that evolved independently without consolidation.
- The Slack webhook Lambda caches the SSM webhook URL with no per-environment config variation; config.ts is static, requiring file edits to change values between staging and production environments.
- An unused variable `userPoolDomain` exists in the CDK stack; it is unrelated to any known functional issue.