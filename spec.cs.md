# Vibe Sharing (CodeSpeak) Specification

## Overview

CodeSpeak Vibe Share is a command-line tool and supporting backend infrastructure that lets developers share their vibe-coded projects — including source code, AI agent session transcripts, referenced plans, and debug files — with the CodeSpeak team for study. It packages filtered copies of project files (excluding secrets), full session histories from supported agents (Claude Code, Cursor, Gemini, Codex), and related artifacts into a portable archive, uploads it to a secure S3-backed backend, and notifies the team via Slack. A companion web UI allows authenticated CodeSpeak staff to browse and download submitted archives. A session viewer application provides deep inspection of AI agent session history grouped by project.

---

## Foundation

**Stack:** TypeScript, Node.js 22.x, React/Ink (terminal UI), Next.js (session viewer web app), AWS CDK (infrastructure), AWS Lambda (Node.js 22.x, bundled via esbuild/CommonJS), API Gateway HTTP API v2, S3, DynamoDB, SNS, SSM Parameter Store, CloudWatch, Amazon Cognito, Amazon SES.

**Architecture:**
- *Deployment topology:* Serverless backend on AWS (Lambda + API Gateway + S3 + DynamoDB), static web frontend on CloudFront, CLI distributed via npm/npx.
- *Communication pattern:* CLI → presign Lambda (generates S3 PUT URL) → direct S3 upload → confirm Lambda (validates and records); upload events published fire-and-forget to SNS; Slack notification Lambda subscribed to SNS topics.
- *Data model:* DynamoDB stores upload metadata (uploadId, status, timestamp, IP, email, name, repo URL); S3 stores zip archives indefinitely; SSM Parameter Store holds sensitive credentials; a separate InternalEmailsTable flags internal user emails.
- *Availability mode:* CLI degrades gracefully to local zip save when backend is unreachable.

**Cross-cutting constraints:**
- The CLI must never expose raw stack traces or silently exit; all failures surface as user-friendly messages.
- Secrets and credentials belonging to the tool operator must never be present on the user's machine.
- All Lambda functions use Node.js 22.x runtime to remain within AWS support lifecycle (deadline: April 30, 2026).
- IAM permissions follow least-privilege principles throughout.
- Telemetry payloads must be sanitised before transmission — no personally identifiable or sensitive content.
- Configuration values (default region, domain names, alarm addresses) are centralised in configuration files rather than scattered as inline literals.
- Archive size estimation accounts for all content included in the archive: session data and project files.

---

## Features

### CLI Tool (`codespeak-vibe-share`)

**Distribution and invocation**

The tool is distributed as an npm package named `@codespeak/vibe-share` (scoped for namespace uniqueness) with bin command `codespeak-vibe-share`, runnable as `npx @codespeak/vibe-share` with no prior installation or configuration required. The entry point script includes a Node.js shebang line. The published package restricts files to the compiled `dist/` directory via the `files` field. A `prepublishOnly` script runs TypeScript compilation before every publish. The package is published with `--access public`.

**Project detection**

On launch, the tool detects whether the current directory (or any parent) is under git version control. For git projects, it uses `git rev-parse --show-toplevel` to identify the project root. The non-git fallback must not silently use the current working directory as root when invoked from a subfolder — it must correctly detect the actual project root. Session lookup must produce correct results regardless of whether the user is in the project root or a subfolder, and regardless of whether a `.git` directory is present.

**File collection**

For git-managed projects, the tool collects:
- Output of `git status` as a text file
- Output of `git diff` (unstaged) as a text file
- Output of `git diff HEAD` (all uncommitted changes versus HEAD) as a text file
- A recursive file listing as a text file
- A git bundle (`--all` flag); if bundle creation fails (empty repo, shallow clone, corrupted refs), `bundlePath` is null and the archive continues without a bundle
- Untracked, non-gitignored files under `project/untracked/`

For empty git repos (no commits), all files are captured as untracked via `git ls-files --others --exclude-standard` and archived under `project/untracked/`.

For non-git directories, the tool walks the directory using exclusion patterns and does not invoke any git bundle code path.

In both modes, the tool excludes: files that may contain secrets (`.env` files, key files, etc.), dependency directories (`node_modules`, `venv`, and similar), and gitignored files. File and line-of-code counts also exclude these directories and gitignored files. Symlink handling must prevent external file leakage and infinite directory walk cycles. Binary file detection or per-file size limits prevent accidental inclusion of large binaries (disk images, media, ML model weights) in non-git mode.

The user is shown the complete file list and must give explicit confirmation before packaging proceeds. They may also select individual untracked files to include.

**Session discovery**

The tool searches for session files for supported agents: Claude Code (`~/.claude/projects/<encoded-path>/`), Cursor, Gemini, and Codex. Discovery searches across all git worktrees of the same repository, not only the current working directory. Branch information for each worktree is read directly from `.git/worktrees/<name>/HEAD` rather than executing git commands, ensuring discovery works on archived repos without git availability.

For Claude Code, the encoded project path is derived from the project root (not the current working directory). Composer sessions stored in `~/Library/Application Support/Cursor/User/workspaceStorage/` are included alongside chat-directory sessions, deduplicated by identifier. Orphaned Cursor chat directories (workspace deleted but chat directory remaining) are recovered by extracting workspace paths embedded in `store.db` blob data using a regex pattern matching the path followed by a newline or quote character; extracted paths are validated for directory existence before inclusion.

If no session is found for a known agent, the tool suggests candidate directories by searching for files referencing the project path. If no supported agent session is found at all, the tool offers the user a file system browser to locate sessions manually. When the user manually enters session directory paths for an unknown agent, all files from those directories are included as-is without agent-specific parsing.

The `Browse filesystem` option is removed from the no-sessions prompt; worktree-based heuristic discovery is the supported fallback path.

**Secret redaction**

Session JSONL transcripts are scanned and sensitive keys are masked before inclusion in the archive. Redaction covers API keys, private keys, bearer tokens, and connection strings. This is a v1 requirement. A `(best effort)` qualifier is included in all user-facing messaging about secret protection to set accurate expectations.

**Archive structure**

The archive filename uses the repository name extracted from the git remote URL when available (supporting SSH, HTTPS with/without `.git` suffix, and other URL formats, stripping `.git` suffix). It falls back to the project folder name. Format: `<reponame-or-foldername>-<timestamp>.zip`. The `vibe-share` prefix/infix must not appear in archive filenames.

Archive layout mirrors the actual `.claude` folder hierarchy under `sessions/.claude/`, preserving `.claude/projects/<encoded-path>/` for session files, `.claude/plans/` for plan files, and `.claude/debug/` for debug files. Cursor archives replicate the `.cursor` subtree structure. The archive includes `tool-results/` and `subagents/` directories from sessions. All worktrees included in the archive are structurally represented in the layout.

Zip entry paths for all files are computed uniformly using the archive root and relative path resolution — no special-case handling per file type.

For Cursor projects, the archive includes:
- Wholesale copies of `store.db` SQLite database files (not extracted JSON blobs)
- A filtered extract of `state.vscdb` containing `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData` UUID entries from `cursorDiskKV`
- `workspace.json` and a `discovery-manifest.json` with intermediate findings (hashes, slugs, composerIds, plan matches, original paths, algorithms)

**Plan and debug file collection**

Only plan files and debug files explicitly referenced in session transcripts are collected — orphaned or unreferenced files are excluded. Reference detection uses grep against session transcript content. Debug file path pattern for grep matching: `.claude/debug/<uuid>.txt`. Cursor plan discovery additionally queries `composer.planRegistry` in `state.vscdb` and matches by composerId, merging registry-based and blob-scan strategies so both always run. The composerId-to-agentId mapping is resolved via `composer.composerData` in `cursorDiskKV` or workspace-level `composer.composerData`.

**Upload flow**

Before upload, the tool checks backend availability via a health endpoint; if unreachable, it falls back to saving a local zip. The tool reads email and username from git config at startup and prompts only when git config values are absent. Repo URL is auto-detected from git remote and included without prompting; the repo URL prompt is skipped entirely when no git remotes exist.

Upload uses a presign-then-PUT flow: CLI calls the presign endpoint (submitting optional metadata), receives a presigned S3 PUT URL, uploads directly to S3, then calls the confirm endpoint. File size is capped at 5 GB. S3 uploads exceeding 5 GB must use multipart upload strategy or produce an explicit error.

The CLI routes requests to `https://vibe-share.codespeak.dev` as the default server URL. The target endpoint can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable. A `.envrc` file at the project root sets `AWS_PROFILE` via direnv, scoped to the project directory.

On upload failure, the CLI displays which step failed (e.g., "confirm step") along with suggestions to use `--output` for local save and `--verbose` for detailed diagnostics. With `--verbose`, the full error cause chain including HTTP status code and response body is shown. The post-upload success message does not include any download URL line.

**Privacy and consent**

A clear privacy notice is displayed before any files are packaged or uploaded, explaining what will be collected and how it will be used, with emphasis on privacy protection. The notice includes a `(best effort)` qualifier. Explicit user consent is required before uploading. The sharing consent prompt defaults to `Y` (enabled).

**Telemetry**

On failure, the CLI automatically sends error telemetry to the backend capturing: error type, failure step, OS version, Node version, and sanitised error message. A correlation/request ID is generated at CLI startup and flows through all steps and corresponding backend calls. The CLI writes a local diagnostic log file on every run with timestamped debug output. No opt-in consent is required before sending error telemetry.

**Modes of operation (plugin/script)**

The tool operates in three modes: scan (audits project state and reports counts of session transcripts, plan files, debug files), build (collects and packages all referenced files into a zip archive, outputs build report including session/plan/debug counts), and review (previews packaged zip contents). The `REQUIREMENTS.md` / plan file is copied to the `intent/` directory as part of the packaging process.

**Proxy support**

`HTTP_PROXY` and `HTTPS_PROXY` environment variables are respected for enterprise network environments.

**Session log extraction script**

A saved, self-contained, independently executable script reads all Claude session log files for the current project from `~/.claude`, extracts: user messages, AskUserQuestion tool prompts and user answers, ExitPlanMode requests with plan approval/rejection results, TODO creation and status change events, and Claude implementation-completion messages. It writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters, and writes one per-session file per session into `intent/sessions/`, each containing only that session's extracted items in chronological order.

**Test requirements**

After publishing, `npx codespeak-vibe-share --version` must install and execute correctly. `npm pack --dry-run` must be run before publishing to verify only `dist/` files are included.

---

### Terminal UI (Ink/React)

The CLI uses React/Ink as the TUI framework, supporting tabs, file tree navigation, text preview, and screen-to-screen navigation. All navigation uses arrow keys (left, right, up, down) and Enter; single-letter shortcuts are not used.

**Application entry point and project list screen**

The application always opens to the project list screen regardless of entry point or current directory. On startup, the tool scans agent directories to collect all known project/workspace paths. If the current working directory is located under one of the discovered projects, that project is marked with a `(current dir)` label, sorted to index 0, and pre-selected at the top of the list. `currentProjectPath` is set only on initial load and is not carried as payload on navigation actions.

The project list greets the user by first name sourced from git config if available. Projects are sorted by total number of sessions across all agents in descending order. The list is scrollable when entries exceed visible terminal height. Worktree entries for the same git repository are merged into a single project list entry with combined agent lists and aggregated session counts. Each project entry shows associated agents, session counts, and `Show stats` / `Share` action buttons. After at least one project has been shared, the heading reads "Share another project:". A `Share another project` option is always available.

Project discovery finds all projects under a parent directory, including subfolders that have their own `.git` roots — each appearing as a distinct entry. Projects whose paths contain hyphens that are ambiguous under lossy decode are still discoverable.

**Share Project screen**

Displays: project path, repo URL if present, agents used with session counts per agent (including sessions from all worktrees), worktree count, file count and lines of code broken down by programming language (detected from file extensions using a hand-maintained map, supplemented by tokei/cloc when available), total commit count across all branches, number of untracked files, and number of tracked files with uncommitted changes. Node_modules, venv, and similar directories, as well as gitignored files, are excluded from file and LOC counts.

Presents a share prompt with options: share, review before sharing (alternative), and back (returns to project list). A welcome header is shown when this is the first screen the user sees. Pressing Escape navigates to the project list. A legend shows Shift+Enter for primary action and Esc for back.

**Consent screen**

Displays CodeSpeak's data use terms (permission to study the project, no commercial software will be built from the code, retraction contact at support@codespeak.dev). Enter is the prominent confirm action; Esc is the visible but secondary action. Pressing Enter on the consent screen confirms consent.

**Review Before Sharing screen**

Has a single Sessions tab (replacing per-agent tabs). The Sessions tab label shows total session count as `Sessions (N)`. When `SESSION_PREVIEW_ENABLED` is false (default), the Sessions tab shows a static read-only list of agent names and session counts. When `SESSION_PREVIEW_ENABLED` is true (controlled via `VIBE_SHARING_SESSION_PREVIEW` environment variable), the Sessions tab renders an interactive agent list that drills into a full agent tab with session preview. The Sessions tab is only shown if the project has agents.

Additional tabs: Code and git.

Focus zones cycle via Tab key through three distinct modes: tabs, list, and action buttons. Only the active focus zone processes keyboard input at any given time. When focus is in the tabs zone, pressing down arrow moves focus to the content zone. When focus is in the content zone, reaching the top moves focus to the tabs zone; reaching the bottom moves focus to the actions zone. When focus is in the actions zone, pressing down moves focus to another zone. TabBar does not handle Tab internally. AgentTab, CodeTab, GitTab, and ScrollableList each accept an `active` prop that gates keyboard input handling.

Pressing Enter on a session opens a session preview. Pressing Esc while previewing returns to the Files tab, not to the Share Project screen. Pressing Shift+Enter triggers the primary action. Claude session first messages have `<ide_*>` tags stripped before display. Sessions with null or empty names display a fallback label.

The Code tab shows a navigable file tree. Files excluded from sharing are labelled "Not Shared" inline; Not Shared folders cannot be expanded. "Shared" files are git-tracked files plus user-selected untracked files. "Not Shared" files are gitignored files and files in excluded directories.

The git tab shows git branches and commits per branch.

A prominent Share CTA and back action appear on the screen. A legend at the bottom indicates Tab cycles focus zones and available keyboard shortcuts.

**Post-share screen**

Shows a Thank You box. "Share Another" is the default highlighted action. "Quit" is the visually de-emphasised secondary action. "To request deletion" message appears as a footnote outside and below the Thank You box.

**Progress indicators**

Progress bars are displayed during long-running operations.

**Gratitude animation**

A gratitude-themed pseudographic progression is rendered at the bottom-left corner of the screen during checkbox and select prompts only (not confirm prompts). Gratitude frames advance one frame per navigation keypress (arrow keys, space, numbers), cycling from frame 3 back to frame 0. The animation disappears on Enter confirmation, showing normal completion summary instead.

The progression consists of exactly 4 frames, all with identical height and display-column width:
- Frame 0: 💛 hearts diamond pattern with "THANK YOU!" message
- Frame 1: 🌟 star border with "YOU ARE AMAZING!" message
- Frame 2: 🎉🙏🎊 celebration theme with "SO MUCH GRATITUDE!" message
- Frame 3: 🏆🔥 trophy theme with "YOU'RE THE BEST!" message

Gratitude frame lines are prepended to the left of prompt output lines, with prompt content shifted right by the frame column width. The frame's last line is vertically aligned with the last line of prompt output. Display width calculation treats emoji as 2 terminal columns and strips zero-width joiners and variation selectors. All padding and normalisation use display width rather than string length.

**Visual design**

All screens have a modern, polished visual appearance using the terminal's full height for long scrollable lists. Tab components display cyan color, bold text, and a cursor indicator when their content zone is active/focused, and dimmed styling when inactive. The content list displays a visible highlight when the content zone is focused and no highlight when not focused. The project matching the current working directory is visually labelled with `(current dir)`. The Back button displays a hint indicating Escape triggers it. The primary action button displays a hint indicating Shift+Enter triggers it.

**Non-goals**
- Animated animal character (goose or duck) in the console UI
- Agent-specific parsing of manually entered session directory paths
- Git bundle or full history inclusion in the Code tab shared archive view
- Manual filesystem browsing and file picking for session selection

---

### Backend API (AWS Lambda + API Gateway)

**Endpoints**

- `GET /health` — returns `{ status: "ok" }`.
- `POST /api/v1/presign` — validates request, accepts optional reporter payload (email, name, repo URL), generates a presigned S3 PUT URL, writes a DynamoDB record (status: pending), publishes to upload events SNS topic, returns the presigned URL and uploadId.
- `POST /api/v1/confirm` — verifies S3 object exists via HeadObject (`s3:GetObject` permission required), marks DynamoDB record confirmed, generates a presigned S3 GET URL with 7-day expiry including a `Content-Disposition` header with the original filename, publishes to upload events SNS topic. S3 errors are logged, not silently swallowed. Both idempotent and normal code paths generate the presigned GET URL from the upload record's S3 key.
- `GET /api/v1/uploads` — protected by Cognito JWT authorizer; list-uploads Lambda scans DynamoDB for confirmed uploads and returns presigned download URLs with 1-hour expiry.
- Telemetry ingestion endpoint — receives CLI error payloads and stores or forwards error data.

**API Gateway**

HTTP API v2 with throttling. Rate limiting: 10 requests per minute per IP. CORS `allowOrigins` configured as an explicit list of specific domain strings without wildcard characters: `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev` (API Gateway v2 does not support wildcard characters in `allowOrigins`). Explicit `Content-Type` and `Content-Length` headers allowed.

**S3**

All uploaded files retained indefinitely with no lifecycle expiry or automatic deletion. Presigned PUT URLs enforce `Content-Type: application/zip` via PutObjectCommand ContentType parameter; S3 rejects mismatched Content-Type with 403. S3 bucket blocks all public access. S3 CORS allows origins from a separate `s3CorsAllowedOrigins` list (supports wildcard syntax such as `*.codespeak.dev`) for future browser-based presigned upload flows.

**DynamoDB**

Fields: `uploadId`, `status`, `timestamp`, `IP address`, `email`, `name`, `repo URL`. Point-in-time recovery enabled via `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`. Presign Lambda IAM: `dynamodb:PutItem` only. Confirm Lambda IAM: `dynamodb:GetItem` and `dynamodb:UpdateItem` only.

**Token-based access**

Token-based invite-only access supported via a token flag or environment variable backed by DynamoDB or Lambda environment variable lookup.

**Infrastructure management**

Built with AWS CDK. Lambda functions bundled via esbuild within CDK (CommonJS format). CDK stack env configured with explicit AWS account and region. Bootstrap requires either a directory with `cdk.json` present or an explicit `aws://ACCOUNT_ID/REGION` argument. AWS CLI credentials via SSO (`aws configure sso`) are accepted for CDK deployments. A `cdk-deploy` script in `scripts/` invokes CDK deploy with auto-approve included automatically.

**Least-privilege IAM**
- Presign Lambda: `dynamodb:PutItem`, SNS publish to upload events topic.
- Confirm Lambda: `dynamodb:GetItem`, `dynamodb:UpdateItem`, `s3:GetObject`, SNS publish to upload events topic.
- Slack notify Lambda: read-only access to SSM SecureString at `/vibe-share/slack-webhook-url` and read access to InternalEmailsTable.

---

### Alerting and Observability

**CloudWatch alarms**

Four alarms configured with both alarm and OK actions:
- Lambda errors exceeding 5 in 5 minutes
- API 4xx errors exceeding 50
- API 5xx errors exceeding 5
- (fourth alarm covers remaining Lambda/API metric)

Alarm and OK action notifications publish to the infrastructure alarms SNS topic. The alarms email address is defined in a central configuration file and delivered to `alarms@codespeak.dev`.

**Slack webhook Lambda (infrastructure alarms)**

Subscribed to the infrastructure alarms SNS topic. Retrieves the Slack webhook URL from SSM Parameter Store at `/vibe-share/slack-webhook-url` (SecureString) at runtime. Caches the webhook URL with a 5-minute TTL; a rotated webhook URL is picked up automatically within that window. On Slack delivery failure, the Lambda throws an error so SNS treats delivery as failed and retries (SNS configured for up to 2 additional retries). On receiving an error response from Slack, the Lambda invalidates its cached token immediately rather than waiting for the TTL. If the SSM parameter is absent, the Lambda logs a warning and continues gracefully rather than throwing a fatal error that could disrupt the SNS email notification path.

Message format: human-readable plain text as the top-level message; full structured data as pretty-printed JSON wrapped in triple-backtick code fences in a thread reply. CloudWatch alarm notifications follow the same structure.

**Upload events SNS topic**

A separate SNS topic, isolated from the infrastructure alarms topic. No email subscription — Slack-only delivery. The same Slack webhook Lambda is subscribed to this topic. Presign Lambda publishes when an upload is requested (filename, size, IP, user info). Confirm Lambda publishes on successful confirmation (filename, size, share URL) and on failure when the file is missing from S3. Both publish fire-and-forget so SNS calls do not add latency to API responses. A shared helper function handles SNS publish logic for both Lambdas. Both Lambdas receive the upload events SNS topic ARN via environment variables.

**Upload Slack notifications**

The initial Slack notification includes the user's name, email address, and repository URL. All subsequent updates from the same upload are posted as threaded replies under the initial top-level message. Each file upload event generates its own independent Slack thread. When processing is complete, a download link pointing to the admin web UI (triggering Cognito login then immediate download) is added to the top-level message. Internal uploads (email matches InternalEmailsTable) have the top-level message prefixed with the `:codespeak:` emoji. Internal user status is looked up at notification time with no caching. Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first deterministically claims thread creation and posts to Slack while the other polls until completion.

**CLI telemetry**

CLI sends error telemetry automatically on failure (no opt-in required) capturing: error type, failure step, OS version, Node version, sanitised error message. A correlation ID generated at CLI startup propagates through all steps and corresponding backend calls. CLI writes a local diagnostic log file on every run.

---

### Admin Web UI

**Access and authentication**

Served via CloudFront at the custom domain `admin.vibe-share.codespeak.dev`. ACM certificate covers `admin.vibe-share.codespeak.dev`, created in `us-east-1` (required by CloudFront regardless of stack deployment region), and attached to the CloudFront distribution as an alternate domain name. Amazon Cognito provides authentication. The Cognito User Pool has a hosted domain for OAuth. Callback and logout URLs are set to the CloudFront domain.

Self-registration is enabled for users with a `@codespeak.dev` email address. A pre-sign-up Lambda trigger rejects addresses not ending in `@codespeak.dev`, auto-confirms and auto-verifies only those addresses, and delegates all other verification to Cognito's built-in flow. Users outside `@codespeak.dev` cannot self-register. Users receive a temporary password via email and must set a permanent password on first login.

Email delivery for sign-up verification and password recovery uses Amazon SES as the email provider (configured in a supported region: `us-east-1`, `us-west-2`, or `eu-west-1`).

A user creation script accepts an email argument, resolves the Cognito User Pool ID automatically from CDK stack outputs, and creates users via AWS CLI `admin-create-user`.

**File browsing**

Authenticated users can browse and download uploaded files. The uploads list is fetched from `GET /api/v1/uploads` returning presigned download URLs with 1-hour expiry.

**Internal email management**

User emails can be flagged as "internal". Internal emails are filtered from the main table by default. A checkbox toggle shows or hides internal emails. A per-row button marks a user's email as internal directly from the table. A dedicated page allows managing the internal email list. Internal email data is persisted in a database (InternalEmailsTable). The `Show internal uploads` checkbox state is saved to and restored from `localStorage`.

**Display**

User email address and repository URL are displayed. GitHub URLs in any common format (HTTPS with/without `.git`, SSH `git@github.com:user/repo.git`, `git://` protocol, URLs with trailing paths) are normalised to a shortened `user/repo` display label rendered as a hyperlink to `https://github.com/user/repo`.

CDK stack outputs include: `ApiUrl`, `BucketName`, `CognitoClientId`, `CognitoDomain`, `CognitoUserPoolId`, `WebUiUrl`, `TableName`, `CustomDomainHostedZoneId`, `CustomDomainTarget`. `config.js` is updated with deployed `CognitoClientId` and `WebUiUrl` values after stack deployment.

**Visual design**
- Internal upload rows display a 🛠️ wrench emoji prepended to the filename.
- Internal upload rows have grey background `#f0f0f0` with hover state `#e8e8e8`.
- Main user table has a checkbox to toggle visibility of internal emails.
- Main user table has a per-row button to mark an email as internal.
- A dedicated page exists for managing the list of internal emails.

---

### Operations Scripts

**Status script (`status.sh`)**

Queries DynamoDB and displays all upload records in a fixed-width table. Columns in order: `NAME`, `EMAIL`, `FILENAME`, `SIZE`, `STATUS`, `CREATED`, `CONFIRMED`, `REPO_URL`, `UPLOAD_ID`. A header line reads `=== DynamoDB Uploads ===` followed by a total record count. `CONFIRMED` displays a dash when no confirmation timestamp is present. `SIZE` is shown in human-readable format (e.g., 2MB). Timestamps are in ISO 8601 format. Lambda log fetching is opt-in via `--logs` flag.

**Clear script (`clear-uploads`)**

Deletes all records from the DynamoDB table and removes all objects from the S3 bucket in a single script run. Displays the count of items to be deleted before prompting. Requires the user to type the exact phrase `delete all` before any deletion proceeds; any other input aborts.

**PATH configuration**

The `scripts/` directory is added to `PATH` via `.envrc` using direnv, making scripts directly executable without a path prefix.

---

### Custom Domain (`vibe-share.codespeak.dev`)

The CLI routes API requests to `https://vibe-share.codespeak.dev` as the default server URL. ACM SSL certificate provisioned for `vibe-share.codespeak.dev` with DNS validation. API Gateway custom domain mapping points `vibe-share.codespeak.dev` to the existing API Gateway regional endpoint. DNS records are configured manually at the registrar (not via Route 53 automation). CDK stack env includes explicit AWS account and region. The custom domain name is defined exactly once in the codebase. Default deployment region is sourced from a configuration file.

---

### Security Hardening

- CORS origins restricted to explicit domain lists in a central `config.ts`; two separate lists: `corsAllowedOrigins` (API Gateway, no wildcards) and `s3CorsAllowedOrigins` (S3, wildcard-capable).
- DynamoDB IAM scoped to exact required actions per Lambda.
- DynamoDB point-in-time recovery enabled with 35-day restore window.
- Slack webhook URL stored as SSM SecureString at `/vibe-share/slack-webhook-url`, never in source code or config files.
- Alarm email address stored in version-controlled config file (non-sensitive).
- Content-Type condition on presigned S3 PUT URLs enforces declared content type; S3 returns 403 on mismatch.
- S3 bucket blocks all public access.

**Deferred (user decision)**
- Unauthenticated endpoint remediation
- Abandoned upload and pending record cleanup
- Verbose error message remediation
- WAF protection
- CloudFront CDN and DDoS protection via Shield Standard

---

### Session Viewer (Next.js)

A Next.js application in the `session-viewer/` directory. Session discovery imports and uses the same logic as the CLI from the parent project's compiled `dist/` output.

**Project list view**

Sessions are grouped by project. Each project card shows the session count pill in the top-right area. No agent badge is rendered on the project card until multiple agent types are supported.

**Session list view (project page)**

Sessions are displayed as a single-column list sorted in descending order by the timestamp of the last message. Each session card shows:
- A visual badge if the session contains a plan (purple, adjacent to agent name badge); plan detection scans JSONL files for references to the plans directory path, running in parallel with title extraction.
- Session start datetime (always shown). End time shown only when it differs from start. When start and end share the same calendar date, the date is shown once with both times. When on different dates, each full datetime is shown. Year is included when the session is not in the current year.
- Duration between start and end expressed in days and hours, shown only when start and end differ.
- Times in 24-hour format with leading zeros (e.g., `09:30`). Date format uses abbreviated month name and day for current-year dates (e.g., `Mar 28`).
- Message and prompt counts in format `XX msgs (YY prompts)`. User prompt count is derived from entries of type `user` whose content blocks are not exclusively `tool_result` blocks.

Session preview: when the session contains an entry of type `ai-title` with an `aiTitle` field, that value is displayed; otherwise the preview falls back to the first lines of user messages, a count of user messages, and agent summary message content.

Metadata (titles, plans, prompt counts) is extracted from each JSONL file in a single consolidated pass with parallel processing across sessions.

**Session detail view**

Loads JSONL entries via a paginated API. Displays AI-generated title, plan indicator, agent name, session ID, message count, prompt count, start and end date/time, duration, and file size. Session discovery data and metadata are fetched in parallel. The `extractMetadata` function is exported for single-session use on the detail page. A shared `SessionStats` component is used by both the session card and the session detail page.

Each JSON object offers:
- A "show JSON" view: formatted, syntax-highlighted JSON; very long strings truncated with ellipsis; clicking a truncated string reveals its full unescaped value in a multiline view.
- A "show rendered" view: message type and rendered contents; available only for recognised message types.

**Card behaviour**

All card types except user messages are collapsed by default. Collapsed cards render minimal information in the card header only. Expanded cards render full content. User messages whose content is exclusively `tool_result` blocks are classified as a distinct `tool-result` subtype, treated as non-user messages for grouping, collapsed by default, and display an amber badge labelled "tool result" in the card header. Pure user message cards are expanded by default.

Consecutive non-user messages between user turns are collapsed behind an ellipsis indicator showing the count of hidden messages. Clicking the indicator expands all hidden messages inline.

Type badges render exactly once per message in the EntryCard header. `ai-title` cards display title text in the card header with no card body. `FileSnapshot` cards with no tracked files display that state in the card header with no card body. `FileSnapshot` entries with tracked files render an expandable file list in the card body.

When a significant proportion of messages are hidden due to ellipsis grouping or filtering, the system proactively loads additional messages to maintain adequate visible message count.

React hook call order in `SessionClient` is stable across all renders (all hooks called unconditionally before any early returns).

**UI details**

- ai-title card: title text in card header, no card body.
- FileSnapshot with no tracked files: "no files tracked" in card header, no card body.
- Session detail page: AI title as heading, then agent name badge, plan badge, and session ID in monospace, then stats row (messages and prompts count, date/time range with duration, file size).
- Same-day format: date followed by `start time → end time` and duration in parentheses.
- Multi-day format: full datetime for start `→` full datetime for end.
- Single-timestamp format (identical start and end): date and time only, no arrow or duration.

**Non-goals**
- Support for non-Claude-Code agent session formats in the initial build.
- Agent badge display on project cards until multiple agent types are supported.

---

### Claude Code Session Log Format (Research)

Claude session logs in `~/.claude` record the following permission-related signals:
- Permission prompt events when Claude requests to run a command or edit a file.
- Permission mode switch events when the user changes between plan, auto, edit-automatically, and bypass-permissions modes, recorded via `permissionMode` field changes.
- User responses to permission prompts: agreement, decline, and alternative instructions — distinguishable from `is_error` on `tool_result` entries.
- Successful tool execution is detectable; whether a permission prompt was shown can be approximated by combining `permissionMode` field with `permissions.allow` patterns from `settings.json`, but there is no explicit `autoApproved` field in the JSONL format.

**Known architectural limitation:** the JSONL session format does not contain an explicit field indicating whether a permission prompt was shown to the user; this is an architectural limitation of the Claude Code client.

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected in favour of AWS CDK because SST is not officially AWS-supported.
- **S3 lifecycle rule auto-deleting uploads after 90 days** — rejected; all uploaded data must be retained indefinitely.
- **AWS Chatbot integration for Slack notifications** — rejected because it involves manual OAuth setup in the AWS Console and removes formatting control; replaced with a custom Slack webhook Lambda.
- **Wildcard subdomain pattern `https://*.codespeak.dev` in API Gateway HTTP API v2 `allowOrigins`** — deployed and then rejected by AWS at deployment time; API Gateway v2 does not support wildcard characters in `allowOrigins` values; fixed by splitting CORS configuration into two separate lists.
- **Single unified CORS configuration list for both API Gateway and S3** — rejected because API Gateway v2 does not support wildcard syntax while S3 does.
- **Publishing upload notifications via the infrastructure alarms SNS topic** — replaced with a dedicated upload events SNS topic to isolate the upload event stream from alarm notifications.
- **Email subscriptions on the upload events SNS topic** — excluded in favour of Slack-only delivery for upload notifications.
- **Storing the Slack webhook URL in a configuration file** — rejected in favour of SSM Parameter Store to avoid exposing sensitive credentials in source code.
- **Slack webhook Lambda caching SSM value indefinitely** — replaced with a 5-minute TTL so rotated webhook URLs propagate without requiring a redeploy.
- **Slack webhook Lambda catching and logging Slack delivery failures without rethrowing** — replaced with rethrowing on failure so SNS treats delivery as failed and retries.
- **Deprecated DynamoDB `pointInTimeRecovery` property** — replaced with `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }` to maintain compatibility with future aws-cdk-lib major releases.
- **SSM PutParameter without overwrite flag** — AWS SSM returns `ParameterAlreadyExists` when the parameter already exists; overwrite must be enabled.
- **Storing alarm notification email address in SSM** — rejected because email is non-sensitive plain configuration; stored in a version-controlled config file instead.
- **Presigning a share URL in the confirm endpoint** — removed entirely; no consumer needs it and the deployed backend never returned it.
- **Share URL format `https://codespeak.dev/share/{uploadId}`** — confirmed non-functional; no backend exists for that route, S3 blocks all public access, and no web frontend serves that path.
- **Download Lambda at `/api/v1/download/{uploadId}`** — rejected in favour of returning the presigned URL directly from the confirm endpoint.
- **Web frontend at `codespeak.dev/share/{id}` via CloudFront and S3 static site** — rejected as requiring additional infrastructure.
- **Provisioning ACM certificate for `api.codespeak.dev`** — rejected; correct subdomain is `vibe-share.codespeak.dev`.
- **Using an environment variable to supply the server URL** — rejected because end users cannot be expected to know or set this value.
- **Hardcoding the raw API Gateway URL as the CLI default** — rejected because the URL is fragile and changes if the AWS stack is ever recreated.
- **Route 53 CDK automation for DNS** — not applicable; DNS is managed through an external registrar.
- **Placing session files under `sessions/claude-code/` with referenced files under `sessions/claude-code/referenced/`** — rejected in favour of replicating the actual `.claude` folder structure under `sessions/.claude/`.
- **IAM action `s3:HeadObject`** — not a valid IAM action; the correct permission for HeadObject API calls is `s3:GetObject`.
- **`@inquirer/prompts` as TUI framework** — rejected because it cannot support tabs, file tree navigation, text preview, and screen-to-screen navigation.
- **Per-agent tabs in the review screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **Agents section in share-project screen hidden behind `SESSION_PREVIEW_ENABLED` flag** — rejected; agents section is always visible regardless of flag state.
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — rejected in favour of copying `store.db` files wholesale for maximum compatibility across user environments.
- **Text-based LIKE matching of plan references within session chat blobs** — confirmed to find zero matches because plan references are stored in binary protobuf blobs; abandoned as sole strategy in favour of registry-based discovery via `state.vscdb composer.planRegistry` combined with blob-scanning as a dual strategy.
- **`initialCursor` prop on `ScrollableList` to pre-position the cursor on the current project** — replaced by sorting the current project to index 0, making the prop redundant.
- **`useMemo` for grouped entry segments placed after early return statements in `SessionClient`** — caused React Rules of Hooks violation; moved to execute before all early returns.
- **Displaying both an agent badge and a session count pill on each `ProjectCard`** — rejected because both elements function as session-type badges, creating visual duplication without differentiation value at a time when only one agent type is supported.
- **Separate JSONL scanning functions for titles, plans, and prompt counts** — replaced by single-pass consolidated extraction to reduce file I/O.
- **12-hour time format with AM/PM in session cards** — replaced by 24-hour format.
- **Displaying full start and end datetimes separately regardless of shared date** — replaced by showing the shared date once when on the same calendar day.
- **Full 32-archetype named type system for vibe coder personality test** — rejected in favour of approximately 8 key named archetypes to reduce upfront design complexity.
- **Timing heuristic using delay between `tool_use` and `tool_result` timestamps to infer auto-approval** — rejected because execution time noise conflates user response time with actual tool execution time.
- **`promptId` field as signal for auto-approval correlation** — rejected; did not correlate with auto-approval behaviour as assumed.
- **Broad DynamoDB IAM grants (`grantWriteData`, `grantReadWriteData`)** — replaced by exact action grants to satisfy least-privilege.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen instead of a meaningful name.
- Gemini CLI sessions directory reports sessions found but none are displayed in the Review screen.
- Up navigation in the main content list of the review screen is broken.
- Opening a Cursor session for the khariton-style project in Review shows "No messages found in this session" despite the session existing and containing messages.
- Session discovery logic may overlook sessions or handle them inconsistently; no confirmed root cause identified.
- The pre-sign-up Lambda originally auto-confirmed users and auto-verified email attributes without sending verification codes, bypassing Cognito's native verification flow; this was fixed, but the Cognito default email sender (`no-reply@verificationemail.com`) has a 50 emails/day hard cap, high spam classification rate, and is blocked by corporate email filters — requiring Amazon SES integration for reliable delivery.
- CloudWatch alarms were originally configured with alarm actions only and no OK actions, meaning recovery events produced no notification; fixed by adding `addOkAction` calls.
- The Slack webhook Lambda originally cached the SSM value indefinitely; fixed with a 5-minute TTL.
- The Slack webhook Lambda originally swallowed Slack delivery failures silently; fixed by rethrowing on failure.
- All upload notification messages were originally grouped into a single Slack thread instead of each upload creating its own independent thread; root cause confirmed as a race condition between presign and confirm SNS Lambda handlers where, for small files, the confirm handler calls `getThread` before the presign handler finishes writing to DynamoDB; fixed with atomic DynamoDB conditional writes.