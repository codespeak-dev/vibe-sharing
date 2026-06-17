# CodeSpeak Vibe-Sharing Specification

## Overview

CodeSpeak Vibe-Sharing is a suite of tools that lets developers package and share their AI-assisted coding projects — including code state, agent session history, referenced plans, and debug files — so the CodeSpeak team can study real vibe-coding workflows without imposing manual effort on contributors. The suite comprises: a CLI tool that scans a project directory, collects Claude Code (and other AI agent) session files, filters out secrets, and uploads a structured zip archive to a secure AWS backend; a serverless AWS backend that handles authenticated uploads, stores metadata, and delivers Slack and email notifications; an admin web UI for browsing and downloading uploaded archives; and a local session-viewer Next.js application for browsing, inspecting, and analysing AI agent session history in depth.

## Foundation

**Stack:** TypeScript/Node.js for the CLI tool and backend Lambda functions; React/ink for the CLI terminal UI; Next.js (App Router) with React for both the session-viewer and admin web UI; AWS CDK for infrastructure-as-code; SQLite (via the `sqlite3` CLI and a Node.js SQLite driver) for session-viewer caching; react-markdown with remark-gfm for markdown rendering.

**Architecture:**
- *Deployment topology:* Serverless AWS (Lambda, API Gateway HTTP API, DynamoDB, S3, SNS, SSM Parameter Store, CloudWatch, Cognito) for the backend and admin UI; Next.js dev server for the local session-viewer; npm/npx for CLI distribution.
- *Communication pattern:* CLI issues presign and confirm requests to API Gateway; Lambda functions publish upload events and alarm notifications to SNS topics; a Slack webhook Lambda subscribes to SNS and delivers messages to Slack via incoming webhook stored in SSM; admin UI authenticates via Cognito JWT and calls a protected API Gateway route.
- *Data model:* DynamoDB for upload metadata; S3 for zip file storage; SQLite for local session-viewer cache of discovered projects, sessions, and session entries.
- *Availability mode:* CLI falls back to local zip creation when the backend is unreachable.

**Cross-cutting constraints:**
- The CLI must be usable by non-technical users; failures must never present as raw stack traces or silent exits — all exceptions must surface as user-friendly messages.
- No credentials or secrets belonging to the tool operator may be stored on or downloaded to the user's machine.
- Secret redaction (API keys, private keys, bearer tokens, connection strings) must be applied to session JSONL transcripts before archiving; this is a v1 requirement.
- All Lambda functions must use the Node.js 22.x runtime.
- IAM permissions must follow least-privilege principles, granting only permissions that are actively used.
- Configuration values (default region, CORS origins, alarm email address) must be centralised in configuration files rather than scattered as inline literals.
- The SQLite session-viewer cache database and its WAL/SHM sidecar files are stored at the project repository root and excluded from version control.

---

## Features

### CLI Tool — Project Detection and File Collection

The CLI tool (command name `codespeak-vibe-share`, distributed via `npx @codespeak/vibe-share`) runs from a project directory and automatically determines what to package.

**Git projects:**
- Detects whether the project directory is under git version control using `git rev-parse --show-toplevel`.
- Produces: a text file with `git status` output, two separate text files for unstaged changes (`git diff`) and all uncommitted changes versus HEAD (`git diff HEAD`), a recursive file listing, a `project/untracked/` directory containing untracked non-gitignored files, and a git bundle (`--all` flag).
- When git bundle creation fails (empty repository, shallow clone, corrupted refs), `createGitBundle()` returns `null` and the archive is created without a bundle; for empty repositories, `git ls-files --others --exclude-standard` captures all files as untracked under `project/untracked/`.
- Bundle path is typed as `string | null` throughout git-state, archiver, and CLI modules; `hasBundle` and `projectFileCount` calculations reflect whether a bundle was actually created.

**Non-git projects:**
- Walks the directory using exclude patterns via `NonGitState` without invoking the git bundle code path.
- Automatically excludes common non-essential directories and files (`.venv`, `node_modules`, `.env.local`) with user-adjustable exclusion list.

**Archive size estimation:**
- For git repositories: sums text output sizes (git status, both diffs, file listing), git bundle file size, and untracked file sizes.
- For non-git repositories: enumerates and sums all project file sizes.
- Total size estimate is initialised with the project size estimate, not zero.

**Project root detection:**
- The tool must correctly identify the project root when invoked from any subfolder, including projects without a `.git` directory.
- When git-based root detection fails and the current working directory is a subfolder, the tool must not silently use the wrong encoded path for session lookup.

**Archive filename:**
- Format: `<reponame>-<timestamp>.zip` (e.g., `reponame-1741234567890.zip`).
- Repository name is extracted from the git remote URL, supporting SSH (`git@github.com:user/repo.git`), HTTPS with and without `.git` suffix, and other formats; `.git` suffix is stripped.
- Falls back to the project folder name when no remote URL is available.
- Archive filename construction logic must be deduplicated into a single variable; no `vibe-share` prefix or infix in the filename.
- Remote URL detection occurs immediately after project detection so the repo name is available when the archive filename is generated.

**Secret protection:**
- Sensitive keys found in session data are masked/redacted before inclusion in the archive; raw secret values are never packaged.
- The script displays a message near the beginning explaining that the tool takes privacy seriously and cares about protecting secrets, including a `(best effort)` qualifier.

### CLI Tool — Session Discovery

The CLI locates AI agent sessions associated with the current project.

**Claude Code:**
- Searches `~/.claude/projects/<encoded-path>/` recursively, including all subagent sessions (`subagents/` directories) and `tool-results/` directories.
- Scans all session files (including subagent sessions) for references to plan files under `.claude/plans/` and debug files matching `.claude/debug/<uuid>.txt`; copies only referenced files (not orphaned ones).
- Includes debug sessions from `~/.claude/debug/` when referenced.
- The archive's `.claude/` directory replicates the actual `.claude` folder hierarchy: session project files under `.claude/projects/<encoded-path>/`, plan files under `.claude/plans/`, debug files under `.claude/debug/`.
- Session discovery scans non-indexed JSONL files in addition to the sessions index; project filtering reads the working directory only from user-type messages.
- `AgentProvider` interface includes an optional `getArchiveRoot()` method returning the root directory path for archive operations; the Claude provider implements this returning `~/.claude`.
- Zip entry paths for all provider-level and per-session files are computed using the archive root and relative path resolution, placing them under `sessions/.claude/` while preserving the original `.claude` directory hierarchy.

**Worktree support:**
- Session discovery searches across all worktrees associated with the same repository, not just the current working directory; sessions from all worktrees are collected and presented together.
- Session folder attribution stores both the filesystem path and branch name for each worktree; branch information is read directly from each worktree's HEAD file at `.git/worktrees/<name>/HEAD`.
- Worktree discovery works on archived repos without requiring git command availability.
- Global project discovery merges worktree entries for the same git repository into a single project list entry with combined agent lists and aggregated session counts.

**Cursor sessions:**
- Locates subagent session data and bundles it using the same mechanism as other agent session data.
- Copies Cursor `store.db` SQLite database files wholesale into the project archive.
- Queries `composer.planRegistry` in the global `state.vscdb` `ItemTable` to discover plan files whose `createdBy` composerId matches any composerId associated with discovered sessions; resolves the composerId-to-agentId mapping via `composer.composerData` entries in `cursorDiskKV` or workspace-level composer data.
- Creates a filtered `state.vscdb` extract containing `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData` UUID entries from `cursorDiskKV`; this filtered extract is included in the archive alongside `store.db` files.
- `findWorkspaceStorageDir` scans `workspaceStorage/*/workspace.json` to match workspace by path; `getWorkspaceComposerIds` reads workspace `state.vscdb` to extract all composerIds.
- `discoverPlansFromRegistry` queries the global plan registry and matches by composerId; merged with blob-scanning so both discovery strategies always run.
- `buildDiscoveryManifest` generates a `discovery-manifest.json` with intermediate findings (hashes, slugs, composerIds, plan matches, original paths, algorithms); included in the archive.
- Project discovery recovers workspace paths from orphaned Cursor chat directories by extracting paths embedded in `store.db` blob data using a regex matching the path followed by a newline or quote character, validated with a directory existence check.
- Project discovery includes Composer sessions stored in `workspaceStorage` by querying `composer.composerData` from `state.vscdb` files in `~/Library/Application Support/Cursor/User/workspaceStorage/`; Composer sessions already discovered via chat are deduplicated using seen identifiers.
- `state.vscdb` extraction uses `sqlite3` CLI with `-readonly` flag.

**Other agents:**
- If no Claude Code sessions are found, asks the user which agent was used and locates that agent's sessions.
- Supports session file discovery for Codex and Gemini (file-system-based agents).
- When session directory layout is unknown, searches for files referencing the project path to suggest candidate directories rather than requiring the user to navigate blindly.
- When a user manually enters session directory paths for an unknown agent, all files from those directories are included as-is without agent-specific parsing.
- The `Browse filesystem` option is removed from the no-sessions prompt; worktree-based heuristic discovery is the supported discovery path.

### CLI Tool — User Interaction Flow

**Privacy and consent:**
- Displays a prominent privacy notice explaining what data will be collected and how it will be used before any files are packaged or uploaded.
- Requires explicit user consent (defaulting to `Y`) before uploading or sharing anything.
- Consent prompt displays uppercase `Y` to indicate it is the active default.

**Pre-upload prompts:**
- Reads email and username from git config at startup; prompts only when git config values are absent.
- Auto-detects git remote URL to pre-populate the repo URL field; skips the repo URL prompt entirely when no git remotes are configured.
- Metadata fields (email, name, repo URL) are optional and do not block uploads.
- Repo URLs are automatically included when detected without prompting.

**Upload error handling:**
- When upload fails, displays which step failed (e.g., "confirm step") along with suggestions to use `--output` to save locally and `--verbose` for detailed diagnostics.
- When `--verbose` is provided on failure, displays the full error cause chain including HTTP status code and response body.
- Verbose details are opt-in; happy-path output remains clean.

**Backend availability:**
- Checks backend availability via a health endpoint before proceeding.
- Falls back to local zip creation when the backend is unreachable or disabled.
- Produces a local zip file as an alternative that the user can handle manually.
- Backend API base URL is configurable via the `VIBE_SHARING_API_URL` environment variable.

**Post-upload:**
- Upload success message does not include any download URL line; share URL display is removed entirely from the post-upload flow.

**Error telemetry:**
- CLI automatically sends error telemetry to the backend on failure, capturing error type, failure step, OS version, Node version, and sanitised error message (no PII or sensitive content).
- CLI generates a correlation/request ID that flows through each step of the upload journey, enabling end-to-end tracing across CLI and backend logs.
- CLI writes a local diagnostic log file on every run with timestamped debug output that users can share when reporting issues.

### CLI Tool — Terminal UI (ink)

The CLI uses ink (React for terminal) as the TUI framework.

**Project list screen:**
- Opens to the project list screen on launch, regardless of entry point.
- If the current working directory is under a listed project, that project is marked with `(current dir)` and sorted to index 0.
- Greets the user by first name sourced from git config.
- Lists all discovered projects with associated agents and per-project actions.
- Supports scrolling when entries exceed visible terminal height.
- Projects are sortable by total session count descending.
- Shows `Share another project:` as the heading after one or more projects have been shared.
- Includes a `Share another project` option.
- `GO_PROJECT_LIST` action clears navigation history so Escape on the share-project screen always navigates to the project list; does not carry `currentProjectPath` as a payload.

**Project share screen:**
- Displays project path, repo URL if present, agents used with session counts per agent (including sessions from all worktrees), worktree count, file count and lines of code broken down by language (using file extension mapping), total commit count across all branches, and counts of untracked and tracked-but-uncommitted files.
- Excludes `node_modules`, `venv`, and similar dependency/environment folders and gitignored files from file and LOC counts.
- Offers Share, Review Before Sharing (with back to project list), and back actions.
- Displays a welcome header when it is the first screen shown.
- Shows a legend with Shift+Enter for primary action and Esc for back.
- Pressing Escape navigates to the All Projects screen.

**Consent screen:**
- Displays CodeSpeak's data use terms (permission to study the project, no commercial software will be built from the code, retraction contact at `support@codespeak.dev`).
- Enter is the prominent confirm action; Esc is the secondary dismissive action.

**Review Before Sharing screen:**
- Has a single Sessions tab (replacing per-agent tabs) showing agent names and session counts.
- When `SESSION_PREVIEW_ENABLED` (`VIBE_SHARING_SESSION_PREVIEW` env var, default false) is disabled, the Sessions tab displays a static read-only list of agent names and session counts in the same visual format as the share-project screen.
- When enabled, the Sessions tab renders an interactive agent list that drills into a full agent tab with session preview.
- Sessions tab is only shown if the project has agents.
- Has a Code tab (navigable file tree; not-shared files explicitly labelled; not-shared folders not expandable; Enter previews file text content) and a Git tab (branches and commits per branch).
- Has a prominent Share CTA and a back action.
- Displays a legend explaining Tab key navigation and available keyboard shortcuts at the bottom.
- `TabBar` must not handle Tab internally — Tab is handled at the parent Review screen level.
- `AgentTab`, `CodeTab`, and `GitTab` each accept an `active` prop gating their keyboard input handling; only the active focus zone processes keyboard input.
- Focus zone cycles through three modes (tabs, list, action buttons) via Tab; down arrow from tabs zone moves focus to content zone; up from top of content list moves focus to tabs zone; down from bottom of content list moves focus to actions zone.
- Content list displays a visible highlight when the content zone is focused; no highlight when inactive.
- Tab component displays cyan color, bold text, and cursor indicator only when its content zone is active; dimmed styling when inactive.

**Post-share screen:**
- `Share Another` is the default highlighted action; `Quit` is the secondary action.
- `To request deletion` message appears as a footnote outside the Thank You box.

**Navigation:**
- Arrow keys (up, down, left, right) and Enter for navigation and selection throughout; no single-letter keyboard shortcuts.
- Shift+Enter triggers the primary action on the currently focused element.
- Back button displays a hint indicating Escape triggers it; primary action button displays a hint indicating Shift+Enter.
- Pressing Enter on a session opens that session without triggering Share or Back buttons.
- Pressing Esc while previewing a file returns the user to the Files tab of the Preview screen.
- `ScrollableList` `active` prop is passed through from parent tab components.

**Gratitude animation:**
- Gratitude-themed pseudographic frames rendered at the bottom-left corner during checkbox and select prompts; not shown on confirm prompts.
- Exactly 4 frames, all identical height and display-column width, cycling continuously (wrapping from frame 3 to frame 0) on each navigation keypress (arrow keys, space, numbers); idle otherwise.
- Frame 0: 💛 hearts diamond pattern with `THANK YOU!`; Frame 1: 🌟 star border with `YOU ARE AMAZING!`; Frame 2: 🎉🙏🎊 celebration theme with `SO MUCH GRATITUDE!`; Frame 3: 🏆🔥 trophy theme with `YOU'RE THE BEST!`.
- Frame lines are prepended to the left of prompt output lines; prompt content is shifted right by the frame column width; frame's last line is vertically aligned with the last line of prompt output.
- Display width treats emoji as 2 terminal columns and strips zero-width joiners and variation selectors; all padding and normalisation use display width, not string length.
- Animation disappears on Enter confirmation; normal completion summary shown instead.

**General:**
- All screens fit within the visible terminal area without requiring scrolling.
- Sessions with empty names display a fallback label; sessions with null names show a fallback label.
- Empty session `firstPrompt` strings are converted to null at the provider level.
- `<ide_*>` tags are stripped from Claude session first messages before display.
- The `.todo` file is excluded from all commits in the current session even when it has unstaged changes.

### Backend — AWS Infrastructure

**API Gateway:**
- HTTP API (v2) with throttling; rate limiting at 10 requests per minute per IP.
- Routes: presign, confirm, health, and GET `/api/v1/uploads` (protected by Cognito JWT authorizer).
- CORS `allowOrigins` must be an explicit list of specific domain strings without wildcards: `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev` (API Gateway v2 does not support wildcard characters in `allowOrigins`).

**Lambda functions (4 total, all Node.js 22.x, bundled via esbuild within CDK, CommonJS module format):**
- *Presign:* validates request, generates S3 presigned PUT URL (with `ContentType: application/zip` enforced — S3 returns 403 on mismatch), stores upload metadata in DynamoDB, publishes upload-requested event to upload events SNS topic. IAM: `dynamodb:PutItem` only.
- *Confirm:* verifies S3 object exists via `HeadObject` (requires `s3:GetObject` IAM permission), marks upload confirmed in DynamoDB, publishes upload-confirmed or upload-failed event to upload events SNS topic. IAM: `dynamodb:GetItem` and `dynamodb:UpdateItem` only.
- *Health:* returns status ok.
- *List-uploads:* scans DynamoDB for confirmed uploads, returns presigned GET download URLs with 1-hour expiry.

**S3 bucket:**
- Retains all uploaded files indefinitely with no automatic deletion or lifecycle expiry.
- Upload file size capped at 5 GB.
- CORS allowed origins use wildcard-capable list (e.g., `*.codespeak.dev`) since S3 supports wildcard syntax; maintained as a separate list (`s3CorsAllowedOrigins`) from the API Gateway list.

**DynamoDB:**
- Stores upload metadata: `uploadId`, `status`, `timestamp`, IP address, email, name, repo URL.
- Point-in-time recovery enabled using `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }` (not the deprecated `pointInTimeRecovery` property).

**SSM Parameter Store:**
- Slack webhook URL stored as a SecureString at `/vibe-share/slack-webhook-url`.
- SSM `PutParameter` operations must enable the overwrite flag to avoid `ParameterAlreadyExists` errors on re-deployment.

**Telemetry endpoint:**
- Receives CLI error payloads and stores or forwards error data for developer review.

**Infrastructure management:**
- Built using AWS CDK; deployable via CDK CLI commands.
- CDK stack `env` configured with explicit AWS account and region values.
- An `.envrc` file at the project root sets `AWS_PROFILE` to `'default'` and is automatically sourced by direnv when entering the project directory.
- A `cdk-deploy` script in `scripts/` invokes CDK deploy with the auto-approve flag automatically.
- `backend/README.md` covers setup, configuration, and usage including the requirement to create the SSM SecureString parameter `/vibe-share/slack-webhook-url` before deploying the Slack notification Lambda.

### Backend — Alerting and Notifications

**CloudWatch alarms:** configured for Lambda errors (>5 in 5 minutes), API 4xx responses (>50), API 5xx responses (>5). Each alarm has both alarm and OK actions publishing to the infrastructure alarms SNS topic so the team is notified both when an incident begins and when it resolves.

**Infrastructure alarms SNS topic:** delivers email to `alarms@codespeak.dev` (defined in central config file) and invokes the Slack webhook Lambda.

**Upload events SNS topic:** separate from the alarms topic; no email subscription. Presign and confirm Lambdas publish fire-and-forget notifications (non-blocking) via a shared helper function. Both Lambdas have IAM permission to publish to this topic; the topic ARN is passed via environment variable.
- Presign Lambda publishes: filename, size, IP, user info when upload is requested.
- Confirm Lambda publishes: filename, size, share URL on confirmed upload; failure indicator when file is missing from S3.

**Slack webhook Lambda:**
- Subscribed to both the infrastructure alarms SNS topic and the upload events SNS topic.
- Retrieves webhook URL from SSM SecureString at `/vibe-share/slack-webhook-url`; caches it with a 5-minute TTL so a rotated URL is picked up within that window without a redeploy.
- Throws on Slack delivery failure so SNS treats delivery as failed and can retry (up to 2 additional times for transient failures); does not silently absorb errors.
- Logs a warning and continues gracefully if the SSM parameter is absent, to avoid disrupting the SNS email notification path.
- Invalidates the cached token immediately upon receiving an error response during a Slack API call.
- Message format: human-readable top-level message (plain text) with structured data as pretty-printed JSON wrapped in triple-backtick code fences posted as a threaded reply.
- Each file upload event generates its own independent Slack thread; upload notifications are not grouped into a shared thread.
- Internal uploads (from emails in `InternalEmailsTable`) are prefixed with the `:codespeak:` emoji in the top-level message.
- Upload event thread: initial message includes user name, email, and repository URL; follow-up detail updates are threaded replies; download link added to top-level message on completion.
- The download link points to the admin web UI URL, which prompts Cognito login if unauthenticated and immediately starts the download.
- Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first deterministically claims thread creation and posts to Slack while the other polls until completion.
- `slack-notify` Lambda has read access to `InternalEmailsTable` and receives its table name via environment variable.

### Backend — Custom Domain

- Custom domain `vibe-share.codespeak.dev` maps to the API Gateway endpoint.
- ACM SSL certificate provisioned for `vibe-share.codespeak.dev` with DNS validation.
- CDK outputs expose the custom domain target and hosted zone ID.
- DNS records configured manually at the registrar (no Route 53 automation).
- CLI default server URL is `https://vibe-share.codespeak.dev`.
- Custom domain name defined exactly once in the codebase.
- Default deployment region sourced from a configuration file.

### Admin Web UI

**Authentication:** Amazon Cognito with a hosted domain for OAuth. Callback and logout URLs set to the CloudFront domain. Self-signup enabled for `@codespeak.dev` email addresses only; a pre-sign-up Lambda trigger rejects other domains, auto-confirms, and auto-verifies emails ending in `@codespeak.dev`. Users receive a temporary password via email and must set a permanent password on first login. Email delivery uses Amazon SES (configured in `us-east-1`, `us-west-2`, or `eu-west-1`) rather than Cognito's default sender to avoid the 50 emails/day cap and spam classification.

**Deployment:** CloudFront distribution serving a static web UI; ACM certificate in `us-east-1` (required by CloudFront regardless of stack's primary region) covering `admin.vibe-share.codespeak.dev`; CDK imports the certificate ARN and attaches it as an alternate domain name.

**File browsing:** protected GET `/api/v1/uploads` route returns confirmed uploads with presigned S3 GET URLs (1-hour expiry). User email address and repository URL displayed in the UI. GitHub repository URLs in all common formats (HTTPS with/without `.git` suffix, SSH `git@github.com:...`, `git://` protocol, URLs with trailing path segments) are normalised to a shortened `user/repo` display format rendered as a clickable hyperlink to `https://github.com/user/repo`.

**Internal email management:**
- User emails can be flagged as internal; internal emails are filtered from the main table by default.
- A checkbox toggle shows or hides internal emails; its state is saved to and restored from `localStorage`.
- A per-row button marks a user's email as internal directly from the main table.
- A dedicated page lists and allows adding emails to the internal list.
- Internal upload rows display a 🛠️ wrench emoji prepended to the filename; styled with a grey background (`#f0f0f0`, hover `#e8e8e8`).

**User management:** admin script in `scripts/` creates users via AWS CLI with `admin-create-user`; accepts email, username, and temporary/permanent password arguments; resolves the Cognito User Pool ID from CDK stack outputs.

### Operational Scripts

**`status.sh`:** queries DynamoDB, retrieves all upload records, and displays them in a fixed-width table. Columns in order: NAME, EMAIL, FILENAME, SIZE (human-readable, e.g. `2MB`), STATUS, CREATED (ISO 8601), CONFIRMED (ISO 8601 or `-` when absent), REPO_URL, UPLOAD_ID. Header line `=== DynamoDB Uploads ===` followed by total record count. Lambda log fetching is opt-in via `--logs` flag. The `scripts/` directory is on PATH via `.envrc` so scripts are executable without path prefix.

**`clear-uploads`:** displays count of items to be deleted, requires the user to type the exact phrase `delete all` as confirmation before proceeding, then deletes all DynamoDB records and all S3 objects in a single run.

### Session Log Extraction

A saved script extracts user activity and Claude completion messages from past session logs:
- Reads all Claude session log files from `~/.claude` for the current project.
- Extracts: user messages, `AskUserQuestion` tool prompts and user answers, `ExitPlanMode` requests with plan approval/rejection results, TODO creation and status change events, and Claude's implementation-completion messages.
- Writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters.
- Additionally writes one per-session file per session into `intent/sessions/`, each containing only that session's extracted items separated by `==========` delimiters and sorted chronologically.
- The script is self-contained and executable independently so extraction can be repeated without manual intervention.

### Session Viewer — Architecture

The session-viewer is a Next.js application that imports session discovery logic from the parent project's compiled `dist/` output rather than duplicating code. Session entries are cached in a SQLite database at the project repository root.

**SQLite cache schema:** supports structured JSON field-wise indexing with a `cwd` column indexed for fast project-path filtering. Stores session metadata, session entries (with `cwd`, `type`, `timestamp` columns), and entry tags (tool uses, plan refs). `state.vscdb` extraction uses `-readonly` flag.

**Performance targets:** first project list load ~0.13s; first session list load ~0.16s; session entries API ~74ms; 30-second TTL on project discovery cache. All entries load eagerly in sequence without requiring user scroll interaction (eager pagination), viable because collapsed groups keep the DOM compact.

**Server-side data loading:** session detail server component pre-loads entries via `extractMetadata` and `findSessionFile` before rendering the client component; server component is force-dynamic to ensure fresh data on every navigation. `SessionClient` receives all session entries as props from the server component. JSON round-tripping across the RSC boundary must preserve all entry data; `Array.isArray` guards must not silently discard valid data by defaulting to empty arrays.

**Navigation:** all same-origin internal links use Next.js `Link` component for client-side routing, keeping the router cache consistently populated so back/forward navigation restores pages from cache correctly.

**Filter state** is persisted to `localStorage` and loaded on initialisation.

### Session Viewer — Project and Session Discovery

**Project list:** discovers all projects by scanning agent directories; displays projects grouped with the agents each has sessions from. Projects whose paths contain hyphens that are ambiguous under lossy decode are still discoverable. Each subfolder with its own `.git` root appears as a distinct project entry.

**Claude Code discovery:** scans non-indexed JSONL files in addition to the sessions index; project filtering reads working directory only from user-type messages; session count computation does not perform redundant file validation during initial scan.

**Cursor discovery:** searches chat directories, recovers orphaned workspaces from blob-embedded paths (regex-validated), and queries `composer.composerData` from `state.vscdb` in `workspaceStorage`; deduplicates sessions via seen identifiers.

**Session filtering:** `discoverAllSessions` accepts optional filtering by agent type; project page displays only Claude Code sessions to reduce data volume and improve load time.

### Session Viewer — Three-Layer Display Pipeline

Card display is computed in three ordered layers. Each layer depends only on the previous layer's output.

**Layer 1 — Per-card defaults:** each entry is classified with an `isPrimary` flag and a `defaultExpanded` flag. High-signal cards (user prompts, agent questions, AskUserQuestion/ExitPlanMode answers, plans, completion reports) are primary and expanded by default. Low-signal cards are non-primary and collapsed by default.

**Layer 2 — Topical grouping:** consecutive related cards are merged into topical groups. Topical groups cluster cards that together represent a single logical action, with the primary case being a tool call paired with its result. Filler entries join an active topical group. Progress-only card sequences form their own topical groups. Topical groups of size one are unwrapped — the card stands alone without a group wrapper. Thinking cards must not be grouped with agent tool result cards. `TodoWrite` entries are classified with a dedicated `todo-write` entry tag and grouped topically only with other `TodoWrite` entries.

**Layer 3 — Collapsed group formation:** between any two primary-interest cards there is at most one collapsed group regardless of how many non-primary-interest cards fall between them. A topical group acts as a single unit inside a collapsed group. Groups containing only queue-operation entries auto-expand on initial render.

**Accessibility guarantee:** every block in a session is reachable — no card is permanently hidden or irrecoverably inaccessible. All nesting levels are expandable.

**Filter overrides:** per-tag filter controls independently override card expansion state and visibility promotion while preserving the underlying structural grouping. Logical grouping is structural and not subject to per-tag filter override. The `overrides` object is threaded through the pipeline functions (`classify`, `isPrimaryItem`, `buildLayer2`, `buildLayer3`, `buildDisplayItems`) as `DisplayOverrides`. Filter pills initialise reflecting the current persisted `FilterState`.

**Collapsed group headers:** left side shows `▸ XXX cards` (e.g. `▸ 47 cards`); middle shows tool-call breakdown in `N ToolName` format (e.g. `3 Subagent`, `8 Bash`); right side shows duration. The term `Agent` is replaced with `Subagent` in all collapsed group summaries. Topical group summaries display tool name and count (e.g. `1 Read` or `3 Read, 2 Bash`). The `other` group does not display a duration.

**Duration:** uses the span between earliest and latest timestamps among a group's entries. Adaptive formatting: sub-second → milliseconds only (e.g. `450ms`); under one minute → seconds only (e.g. `12s`); one minute or longer → minutes and seconds (e.g. `2m 13s`).

**Reapply-key mechanism:** resets expanded state only in response to actual reapply-key changes; initial mount is tracked via ref to skip the effect on first render so `autoExpand` correctly determines initial expanded state.

**Model display:** most frequently used model displayed at the session level (e.g. `Models: claude-opus-4 x42 (default)  claude-sonnet-4 x3`); individual cards show the model only when it differs from the session-level most common model.

### Session Viewer — Entry Card Rendering

**General card structure:**
- Type badge renders exactly once per message in the EntryCard header across all message types.
- All card types except user messages and pure user messages (non-tool-result) are collapsed by default.
- Collapsed cards render minimal header information only; expanded cards render full content including body.
- Raw JSON representation accessible from every block.
- Header metadata (file names, tool names, paths) is preserved in both collapsed and expanded states of tool blocks.
- Message timestamps display date, hours, minutes, and seconds; positioned at the right-most end of the header row using flex with margin-left auto; visible in both collapsed and expanded states. Rendered/JSON view toggle buttons are visible only when expanded.

**Tool call cards:**
- Tool names render as amber-coloured badges in entry card headers for both assistant entries and tool-result entries.
- File paths, patterns, and globs extracted from tool inputs shown as monospace detail text after badges; leading-ellipsis truncation when too long.
- Bash tool call headers include the command string badge with trailing truncation.
- Tool result headers show tool name and file path (looked up from tool-use-id map); leading-ellipsis truncation for paths.
- Tool call and result node blocks expand by default when the parent entry is opened; headers display identically in collapsed and expanded states.
- Non-plan Edit tool_use blocks route to the existing edit block renderer; plan Edit tool_use blocks route to the unified diff view renderer.

**Unified diff view (Edit tool_use):**
- Line-level comparison using a longest common subsequence algorithm identifies added, removed, and unchanged lines.
- Within changed lines, the exact changed substring is identified using a character-level common-prefix/suffix algorithm.
- Removed lines: red, prefixed with `-`; added lines: green, prefixed with `+`; changed substring highlighted with a brighter/more intense version of the line's colour.

**User messages:**
- Blue background colour scheme (`bg-blue-950/50` background, `border-blue-700/40` border); blue user role badge.
- Content rendered as plain text (no markdown formatting).
- User messages whose content consists exclusively of `tool_result` blocks are identified as the `tool-result` subtype; classified as non-user messages for ellipsis grouping; display amber badge labelled `tool result`; collapsed by default.

**Assistant messages:**
- Green background colour scheme (`bg-green-950/40` background, `border-green-800/40` border); green assistant role badge.
- Text blocks render as GitHub Flavored Markdown (headings, lists, code blocks, tables, bold, italic, inline code) using react-markdown and remark-gfm.

**IDE context tags:**
- User messages containing `<ide_*>` pattern tags display a visible grey badge indicator for each tag; badge shows the tag name in angle bracket notation (e.g. `<ide_opened_file>`); monospace font.
- Clicking a badge toggles its expanded state to show full tag content in a scrollable panel.
- Long paths in tag previews truncated from the left with `...` prefix; CWD prefix replaced with `$CWD`. Collapsed badges show first 60 characters of first line with path truncation and CWD substitution.
- `projectPath` threaded from server component through `SessionClient`, `CollapsedGroup`, and `EntryCard`; `cwd` derived from `projectPath` with fallback and passed down through the renderer hierarchy.

**Thinking blocks:**
- Tagged with a secondary label; collapsed state shows a content preview.

**Plan file interactions:**
- `Write` and `Edit` tool_use blocks targeting `~/.claude/plans/*.md` render the file's markdown content as formatted markdown with a plan file name header (e.g. `Plan: snug-sprouting-kahan`).
- `Read` tool_result blocks targeting plan files render as formatted markdown.
- Purple badge added to entry cards referencing plan files; plan badge navigates to the plan entry via a `PlanBadge` client component using a button element that assigns directly to `window.location.hash` to fire the native hashchange event.
- Detection uses actual tool_use blocks of type Write/Read/Edit targeting `.claude/plans/*.md`; textual mentions in tool_result content are excluded.
- `firstPlanLineIndex` points to the actual plan file operation tool_use block, not to earlier tool_result text discussing plans.

**FileSnapshot cards:** no tracked files → card header indicates this with no body rendered; tracked files → expandable file list in card body.

**`ai-title` cards:** title text in card header; no card body.

**AskUserQuestion blocks:** rendered as a set of options with radio buttons; selected option visually marked; `Other` rendered as a radio button, marked selected when chosen; free-form comment displayed alongside Other with user attribution. For multiSelect, all selected options are marked. Answers not matching any predefined option displayed as free-form fallback.

**ExitPlanMode blocks:** expanded by default. Four distinct answer types: `Approved`, `Keep planning`, `Cancel` (no comment), `Other` (free-form comment not tied to plan sections). When the user provides feedback by commenting on specific plan sections, the response option selector is hidden. Rendered with plan badge; example navigation links provided.

**TodoWrite cards:**
- Status icons: `·` pending, `▶` in progress, `✓` completed, `✗` cancelled.
- Card header shows `[completed/total]` ratio followed by up to two change parts (status icon + item text truncated with ellipsis); when more than two todos are affected, falls back to count-based summary.
- First TodoWrite call summary includes a status breakdown when non-pending items are present.
- Diff computation tracks previous todo state across successive TodoWrite calls; items matched by content field.
- Todo write diff summaries threaded through full component chain.
- Diff display: green for added items, blue for status-changed items.

**Subagent cards:**
- Cyan-tinted container styling.
- Type and description in title bar; `Prompt` heading above prompt markdown content in card body (no description repetition); standalone `Worked for XXs` label between prompt section and result section; result content rendered as markdown.
- Each subagent card enriched with corresponding result data from a later tool-result card.
- Each subagent tool-result card includes a link back to its corresponding tool-call card.
- Subagent tool calls grouped together only when tool call and result are separated exclusively by progress and filler entries, not by thinking entries.

**Consecutive non-user messages** between user turns are collapsed behind an ellipsis indicator showing the count of hidden messages; clicking expands inline.

**Plan markdown:** rendered with purple-tinted prose styling; markdown tables rendered as formatted HTML tables via remark-gfm.

**Entry card keys** incorporate the `reapplyKey` value so filter changes generate new keys forcing fresh component instances with clean default state.

### Session Viewer — Session List and Cards

**Session card:**
- Purple `plan` badge when session has plans; badge is an anchor navigating to the plan message (uses `stopPropagation` to prevent card navigation).
- Card container uses `div` with `onClick` + `router.push` for navigation; plan badge is the sole anchor inside the card (no nested anchors).
- Timestamp display: 24-hour format; same-day sessions: shared date once with start and end times separated by arrow and duration; multi-day same-year: month/day for both endpoints; cross-year: full date including year; identical start/end: single timestamp with no arrow or duration.
- Message and prompt counts: combined `XX msgs (YY prompts)` format; user prompt count excludes tool-result-only entries.
- `SessionStats` shared component used by both session card and session detail page.

**Session sorting:** by last message timestamp, most recently active first.

**Session detail page:**
- Displays AI-generated title, plan indicator, agent name, session ID, message count, prompt count, start/end timestamps, duration, and file size.
- Metadata retrieved via single-file read for the requested session only (not a project-wide scan).
- Session discovery and metadata fetched in parallel.
- `extractMetadata` exported for single-session use.
- Page is force-dynamic.

**Session plan detection:** scans JSONL files for `~/.claude/plans/` path references; runs in parallel with AI title extraction; consolidated single-pass scanning extracts titles, plans, and prompt counts in one read per file.

### Session Viewer — Hash Navigation

When navigating to a URL hash targeting a specific entry:
- Hash is parsed after client-side mount via `useState` initialiser (synchronous on first render) and a `hashchange` event listener for same-page navigation.
- `highlightEntry` state is available before grouped segments are computed so the targeted entry can be extracted from collapsed groups on first render.
- The targeted entry is extracted from the grouping system and rendered as a standalone card between surrounding collapsed groups; the card is force-expanded.
- `CollapsedGroupView` and `TopicalGroupView` check if they contain the target entry and auto-expand if matched; `EntryCard` receives `forceExpanded=true` when matched.
- Only the minimum number of groups necessary to reveal the target card are expanded.
- Scroll to the target element is deferred using nested `requestAnimationFrame` callbacks to wait for both React's commit phase and the browser's paint phase.
- `PlanBadge` on session detail page uses a button element assigning directly to `window.location.hash` to fire the native hashchange event reliably on same-page navigation.
- `SessionClient` threads `highlightEntry` through `DisplayItemView` to child components via prop-drilling rather than context.

### Session Viewer — Message Type Registry

A dedicated registry page enumerates all known UI message types with real examples from the cache database.

Each message type exposes search criteria (filters, matchers, or identifiers) usable by the registry page to retrieve examples automatically. Adding a new message type without exposing search criteria causes a compile-time enforcement failure.

- SQL query for `getInstancesByTag` uses `COALESCE` to fall back to a sibling entry's `cwd` when the current entry's `cwd` is null, so entry types such as `last-prompt` and `ai-title` can resolve valid session links.
- Rebuild Index button triggers a full re-index of all session JSONL files and populates `visual:` tags across the entire dataset; results are displayed in the UI after completion.
- Cache ingest logic is centralised in the cache database module, not duplicated across routes.
- Registry pages use server-side initial data load (~14ms DB query); client-side fetching is reserved for pagination load-more operations only.
- List rendering must assign unique keys to each child element.

### Session Viewer — Diff Display

Diff display renders in unified diff format with per-line syntax and intra-line character-level highlighting that pinpoints the exact changed substrings within each modified line, similar to professional code editor diff views.

### Session Viewer — Dark/Light Theme

The session-viewer supports dark and light colour schemes. A theme toggle control accessible on every page switches between them with immediate effect.

### npm Package Publishing

- Package name: `@codespeak/vibe-share` (scoped for namespace uniqueness).
- `bin` field maps `codespeak-vibe-share` to the entry point script; entry point includes `#!/usr/bin/env node` shebang.
- Published to the npm public registry with `--access public` flag.
- `files` field restricts published content to the compiled `dist/` directory.
- `prepublishOnly` script runs TypeScript compilation before publishing.
- Current published version: `0.2.1`; semantic versioning applied (minor increment for significant feature volume).
- Decision to use scoped naming must be made before first publish; migrating from unscoped after publishing is a one-way decision.

### Vibe Personality Test (Planned)

A personality test that characterises developer personality based on signals from code, git history, and Claude Code agent sessions.

- Defines 5 personality traits that are amusing, at least some of which are potentially useful, and all reliably detectable from code analysis, git history, and agent session logs.
- Combines traits into approximately 8 named archetypes.
- Accepts a configurable set of projects with all Claude Code projects on the machine included by default; specific projects can be excluded.
- Only Claude Code agent sessions are supported as the data source.
- LLMs may be used as part of the trait detection mechanism.
- Plan file saved to `intent/vibe-personality/`.

**Metrics tracking system (`intent/vibe-personality/TRACKING.md`):**
- Tracks all 49 raw candidate metrics from `vibe-personality.md` (not the 5 V.I.B.E.S. traits or sub-signals).
- Each metric marked with an emoji status (not started, planning, implementing, testing, done).
- Each metric has its own plan file under `metrics/` subdirectory; central tracking file references the filename.
- Each row contains a visible definition/description and a clickable `cursor://` link to the appropriate stage prompt.
- Prompt templates at `prompts/plan.md`, `prompts/implement.md`, `prompts/test.md`, `prompts/done.md`, `prompts/sync.md`.
- A clickable 🔄 Sync link at the top triggers a human-reviewed diff of `vibe-personality.md` against `TRACKING.md` to surface missing metrics.
- `CLAUDE.md` inside the `vibe-personality` directory documents general instructions for planning, implementing, and testing metrics, including the sync workflow.

**Impatience metric (specified, not yet implemented):**
- Detects three signal types: sequence interruptions (user prompt appearing after a tool-cycle-group), explicit tool rejections (error-flagged events with rejection content), and orphan `tool_use` events (no matching `tool_result`).
- Calculates three normalised rate metrics: impatience events per user message, impatience events per minute, and tool rejection rate as a ratio.
- Uses existing `buildSegments()` grouping utility from `grouping.ts`.
- Implementation target: `src/personality/impatience.ts`; spec stored at `metrics/impatience.md`.

---

## Design Decisions

- **SST v3 for infrastructure** — rejected because SST is not officially AWS-supported; AWS CDK chosen instead.
- **S3 lifecycle rules auto-deleting uploads after 90 days** — rejected because all uploaded data must be retained indefinitely.
- **AWS Chatbot for Slack notifications** — involves manual OAuth setup in the AWS Console; rejected to retain formatting control and avoid AWS-managed service dependency.
- **Slack webhook URL in a configuration file** — rejected to avoid exposing sensitive credentials in source code; SSM SecureString used instead.
- **Alarm email stored in SSM** — rejected because email is non-sensitive plain configuration; a checked-in config file with audit trail and code-review visibility is sufficient.
- **Wildcard `https://*.codespeak.dev` in API Gateway HTTP API v2 `allowOrigins`** — deployed but rejected at the AWS level; API Gateway v2 does not permit wildcard characters in `allowOrigins` values; fixed by splitting into two lists: `corsAllowedOrigins` (explicit domains for API Gateway) and `s3CorsAllowedOrigins` (wildcard-capable for S3).
- **CORS removal (`corsPreflight: undefined`) for CLI-only tool** — considered cleanest option; not implemented; CORS retained for future web frontend compatibility.
- **`aws configure` static IAM credentials** — valid but user chose SSO-based login (`aws configure sso`) instead; both approaches are compatible with CDK.
- **Running `npx cdk bootstrap` from a directory without `cdk.json`** — fails because CDK cannot resolve the target AWS environment without an explicit `aws://ACCOUNT_ID/REGION` argument.
- **`s3:HeadObject` IAM action for confirm Lambda** — `s3:HeadObject` is not a valid IAM action; S3 HeadObject API calls require `s3:GetObject` permission.
- **Share URL `https://codespeak.dev/share/{uploadId}`** — non-functional; no backend exists for that route, the S3 bucket blocks all public access, and no web frontend serves that path; replaced by presigned S3 GET URL approach, then subsequently removed entirely since the deployed backend never returned a `shareUrl` field.
- **Download Lambda at `/api/v1/download/{uploadId}` redirecting to presigned URL** — proposed but not implemented; presigned URL returned directly from the confirm endpoint chosen instead, then share URL handling removed entirely.
- **Keeping unscoped package name `codespeak-vibe-share`** — flagged as a decision point; moving to a scoped name after first publish requires deprecating the original unscoped package; scoped `@codespeak/vibe-share` adopted before first publish.
- **Cognito default email sender** — has a 50 emails/day hard cap, high spam classification rate, and is blocked by corporate email filters; replaced with Amazon SES.
- **Pre-sign-up Lambda auto-confirming and auto-verifying users** — bypassed Cognito's native verification flow, allowing unverified accounts; removed auto-confirmation and auto-verification logic, retaining only email domain validation.
- **Auth0 / Cloudflare Access / shared CloudFront password for admin UI** — Auth0 deferred indefinitely; Cloudflare Access required DNS migration; shared password has no per-user access control; Amazon Cognito chosen.
- **Using project folder name as archive filename prefix instead of repository name** — rejected because repository name should take precedence when available.
- **Placing session JSONL files under `sessions/claude-code/` with referenced files under `sessions/claude-code/referenced/`** — rejected in favour of replicating the actual `.claude` folder structure directly under `sessions/.claude/`.
- **Browse filesystem option in session discovery** — a stub that only logged a message and took no action; replaced with worktree-based heuristic discovery.
- **Tracking personality metrics at V.I.B.E.S. trait level or sub-signal level** — both rejected in favour of raw candidate metrics from `vibe-personality.md`.
- **Automated syncing of TRACKING.md without human review** — rejected in favour of a clickable link that triggers a human-reviewed diff workflow.
- **Full 32-archetype named type system for personality test** — rejected in favour of approximately 8 key named archetypes.
- **Timing heuristic using delay between `tool_use` and `tool_result` timestamps to infer auto-approval** — rejected because execution time noise conflates user response time with actual tool execution time, making inference unreliable.
- **`promptId` field as a signal for auto-approval correlation** — investigated and rejected; did not correlate with auto-approval behaviour as assumed.
- **FTS5 full-text search index for session entry search** — rejected as insufficient for JSON field-wise querying.
- **Agent badge on every `ProjectCard` in session-viewer** — invariant metadata for the initial Claude-Code-only build; adds no differentiation value alongside the session count pill; deferred until multiple agent types are supported.
- **Per-agent tabs on the Review Before Sharing screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **@inquirer/prompts as TUI framework** — cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation; replaced by ink.
- **Opening session links in new browser tabs** — avoided the registry page re-mount problem rather than fixing it; real-world re-fetch time is short enough to make the workaround unnecessary.
- **bfcache recovery via `visibilitychange` and `pageshow` listeners with `persisted` flag** — did not resolve stuck loading states because the root cause was navigation inconsistency (plain anchor tags vs. Next.js Link), not bfcache restoration.
- **`fetchingRef` double-fetch guard in `SessionClient`** — redundant because the `useCallback + useEffect` combination already prevents duplicate fetches.
- **Stale cache guard component and bfcache test script** — compensated for an upstream routing issue resolved by consistent Next.js Link usage; deleted as unnecessary.
- **Pairing each parallel tool call with its matching result into separate per-pair topical groups** — rejected in favour of treating the entire parallel batch as a single undivided sequence.
- **Grouping subagent tool calls with surrounding progress and filler cards topically** — did not help users match subagent invocations with their results; replaced with an enrichment approach adding cross-references between tool-call and tool-result cards.
- **Displaying elapsed time in the result section heading as `Result (Xm Ys)`** — rejected; replaced by a standalone `Worked for XXs` label positioned between the prompt section and result section.
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — not chosen; copying `store.db` files wholesale adopted for maximum compatibility across user environments.
- **Text-based LIKE matching of plan references within session chat blobs** — confirmed to find zero matches because plan references are stored in binary protobuf blobs; abandoned in favour of registry-based discovery via `state.vscdb` `composer.planRegistry` combined with blob-scanning as a dual strategy.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen instead of a session title.
- Gemini CLI sessions directory reports sessions found but none appear in the Review screen.
- The up-arrow navigation in the main content list on the review screen is broken.
- Opening a Cursor session in Review for projects such as the khariton-style project shows `No messages found in this session` even though the session contains messages.
- Session discovery logic may overlook Cursor sessions or handle them inconsistently; no confirmed root cause identified.
- 90.6% of chat hashes in Cursor's chats storage do not match current `workspaceStorage` entries; possible causes include stale records from deleted workspaces, a migration path that did not update references, or independently evolved parallel ID schemes; root cause unconfirmed.
- Example navigation links labeled `Cancel (Esc) with user comment` and `Cancel (Esc) without comment` in ExitPlanMode interactions do not match their described cases; misclassification of response types in example data suspected but root cause unconfirmed.
- The `assistant` badge on plan edit cards in the session viewer is not rendering in green as expected despite a fix that changed badge color derivation to use `displayColorClass` rather than `entryTag`.
- The grouping UI toolbar does not appear at the top of the `/registry/tool-call` registry page; root cause unconfirmed.
- Only 3 skill tool call nodes appear on the tool-call registry page when more are expected; root cause unconfirmed.
- Collapsing an expanded filter pill does not update the displayed conversation entries to reflect the new filter state; root cause unconfirmed.
- Navigation to a hash-targeted entry inside a collapsed group is broken after the most recent fix attempt involving a `useEffect` with `[sessionId]` dependency; root cause unconfirmed.
- The non-git fallback in `detectProjectFiles()` sets the project root to `process.cwd()` instead of detecting the actual project root, causing session lookup failures when the CLI is invoked from a subfolder of a non-git project.