# CodeSpeak Vibe-Share Specification

## Overview

CodeSpeak Vibe-Share is a command-line tool and supporting cloud backend that lets developers share their vibe-coded projects — including AI agent session history, plan files, debug sessions, and filtered project files — as self-contained archives, without requiring technical effort or manual configuration. The system handles discovery of sessions from Claude Code, Cursor, Codex, Gemini, and other agents; redacts secrets; packages everything into a structured zip; and uploads it to a secure AWS backend. A companion web admin UI allows authenticated team members to browse and download uploaded archives. A session-viewer application provides deep inspection of individual AI agent sessions. The personality analysis subsystem extracts behavioral metrics from session history to characterize developer working style.

---

## Foundation

**Stack:** TypeScript, Node.js 22.x, React (via ink for CLI TUI), Next.js (session-viewer), AWS CDK (infrastructure), AWS Lambda (Node.js 22.x runtime, bundled via esbuild), API Gateway HTTP API v2, DynamoDB, S3, SNS, CloudWatch, SSM Parameter Store, Amazon Cognito, Amazon SES, SQLite (session-viewer cache), react-markdown with remark-gfm.

**Architecture:**
- *Deployment topology:* Serverless AWS backend (Lambda + API Gateway + DynamoDB + S3 + SNS); CLI distributed via npm/npx; session-viewer as a Next.js application.
- *Communication pattern:* CLI uploads via presigned S3 PUT URLs obtained from a presign Lambda; confirms upload via a confirm Lambda; health-checks backend before proceeding; telemetry posted to a backend telemetry endpoint on failure.
- *Data model:* DynamoDB stores upload metadata (uploadId, status, timestamp, IP, email, name, repo URL). S3 stores zip archives. SQLite stores cached session discovery results and entry metadata for the session-viewer.
- *Authentication:* Cognito User Pool with self-registration restricted to @codespeak.dev email domain; hosted OAuth flow; JWT authorizer on protected API routes.

**Cross-cutting constraints:**
- All Lambda functions use Node.js 22.x runtime.
- Secrets and credentials owned by the tool operator must never be present on the user's machine.
- IAM roles follow least-privilege principles — only permissions that are actively used are granted.
- S3 uploaded files are retained indefinitely with no automatic deletion or lifecycle expiry.
- DynamoDB point-in-time recovery is enabled with a 35-day restore window.
- The tool must be usable by non-technical users who will abandon at the first point of friction.
- Failures must never surface as raw stack traces or silent exits — all exceptions must be caught and presented as user-friendly messages.
- Telemetry payloads must be sanitized before transmission — no personally identifiable or sensitive content.

---

## Features

### CLI Tool — Core Upload Flow

The CLI command is `codespeak-vibe-share`, distributed as `npx @codespeak/vibe-share`. The package name uses the scoped format `@codespeak/vibe-share` with `--access public`. The `bin` field maps `codespeak-vibe-share` to the compiled entry point, which must include a `#!/usr/bin/env node` shebang. The `files` field in `package.json` restricts published content to the `dist/` directory. A `prepublishOnly` script runs TypeScript compilation before publishing.

**Startup and identity:**
- On startup, the CLI reads the user's email and username from git config. It prompts for these values only when they are absent or unset.
- The CLI generates a correlation/request ID that flows through each step of the upload journey for end-to-end tracing.
- The CLI writes a local diagnostic log file on every run with timestamped debug output that users can share when reporting issues.
- The sharing consent prompt defaults to `Y` (uppercase, indicating the active default). Pressing Enter without input accepts sharing.

**Repo URL detection:**
- The CLI auto-detects the git remote URL to pre-populate the repo URL field. When no git remotes are configured, the repo URL prompt is skipped entirely.
- Repo URLs are automatically included in uploads when detected, without prompting the user.

**Backend connectivity:**
- The CLI routes API requests to `https://vibe-share.codespeak.dev` as the default server URL. This value must be defined exactly once in the codebase with no duplication.
- The default server URL can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable.
- Before uploading, the CLI checks backend availability via a health endpoint and falls back to producing a local zip file if the backend is unreachable or disabled.

**Upload flow:**
- The CLI prompts for optional metadata: email, name, and repo URL. These fields do not block uploads if omitted.
- On upload failure, the CLI displays which step failed (e.g., "confirm step") along with a suggestion to use `--output` to save locally and `--verbose` for detailed diagnostics.
- When `--verbose` is provided, the CLI displays the full error cause chain including HTTP status code and response body.

**Error telemetry:**
- On CLI failure, the CLI automatically sends error telemetry to the backend capturing error type, failure step, OS version, Node version, and sanitized error message, without requiring explicit user consent.

**Post-upload output:**
- The upload success message does not display a download URL. All share URL handling has been removed from the post-upload flow.

**Non-goals:**
- User-provided server URL configuration
- Download URL display in post-upload flow
- Share URL field in upload confirm response

---

### CLI Tool — Project and File Detection

**Git projects:**
- The CLI detects whether the current directory is under git version control using `git rev-parse --show-toplevel`.
- For git projects, the archive includes: output of `git status`, two separate git diff files (unstaged changes and all uncommitted changes vs HEAD), a recursive file listing, an `untracked/` directory containing untracked non-gitignored files, and a git bundle created with `--all` flag.
- Git bundle creation failures are caught and represented as `null` rather than throwing. When bundle creation fails (shallow clone, corrupted refs, empty repository), tracked file paths appear in `file-listing.txt` and untracked files are included if selected.
- For empty git repositories (no commits), all files are captured as untracked using `git ls-files --others --exclude-standard` and archived under `project/untracked/`.
- The `hasBundle` and `projectFileCount` calculations accurately reflect whether a bundle was actually created.

**Non-git projects:**
- For non-git directories, the directory is walked using exclude patterns via `NonGitState` without invoking the git bundle code path. Common non-essential directories (`.venv`, `node_modules`, `.env.local`, and similar) are excluded by default. The user can customize the exclusion list.

**Project root detection:**
- The CLI must correctly identify the project root when invoked from any subfolder, including projects without a `.git` directory.
- When git-based root detection fails and the current working directory is a subfolder, the tool must not silently use the wrong encoded path for session lookup.

**File filtering:**
- Gitignored files are excluded from the archive and from file/LOC counts.
- Files containing secrets (`.env` files, key files, connection strings, bearer tokens, API keys, private keys) are excluded.
- Dependency directories (`node_modules`, `venv`, and similar) are excluded from file and LOC counts.
- Symlink handling must prevent external file leakage and infinite directory walk cycles.
- Binary file detection or per-file size limits must prevent accidental inclusion of large binaries (disk images, media files, ML model weights) in non-git mode.

**Archive size estimation:**
- For git repositories: size estimation sums text output sizes (git status, diffs, file listing), git bundle file size, and untracked file sizes.
- For non-git repositories: size estimation sums all project file sizes.
- Total size estimate is initialized with the project size estimate rather than zero.

**Archive naming:**
- Archive filename uses the repository name extracted from the git remote URL when available, supporting SSH URLs (`git@github.com:user/repo.git`), HTTPS URLs (`https://github.com/user/repo.git`), and other formats, stripping any `.git` suffix and using only the repository name segment.
- Falls back to the project folder name when no repository name is available.
- Format: `<reponame>-<timestamp>.zip` (e.g., `reponame-1741234567890.zip`). The archive filename must not include any `vibe-share` prefix or infix segment.
- Archive filename construction logic is deduplicated into a single variable.
- Remote URL detection occurs immediately after project detection so the repo name is available when the archive filename is generated.

---

### CLI Tool — Agent Session Discovery

**Claude Code sessions:**
- Session files are located in `~/.claude/projects/<encoded-path>/`, including the full directory with all subagent session files and `tool-results/` subdirectories.
- Session discovery scans non-indexed JSONL files in addition to the sessions index.
- Project filtering reads the working directory only from user-type messages.
- Session JSONL files actively being written during execution are handled gracefully for partial reads or file-in-use conditions.

**Cursor sessions:**
- `findWorkspaceStorageDir` scans `workspaceStorage/*/workspace.json` to match workspace by path.
- `getWorkspaceComposerIds` reads workspace `state.vscdb` to extract all composerIds.
- Orphaned Cursor chat directories (where the workspace was deleted but the chat directory remains) are recovered by extracting paths embedded in blob data in `store.db` using a regex pattern matching the path followed by a newline or quote character, validated with a directory existence check.
- Composer sessions stored in `~/Library/Application Support/Cursor/User/workspaceStorage/` are discovered by querying `composer.composerData` from `state.vscdb` files.
- Composer sessions already discovered via chat directories are deduplicated using seen identifiers.

**Multi-agent support:**
- If Claude Code sessions are not found, the CLI asks which AI agent the user used and locates that agent's sessions.
- Supported agents for file-system-based session discovery include Codex and Gemini.
- Gemini protobuf extraction is scoped as best-effort file-level only; grepping binary protobuf files for path strings is unreliable without a proto schema.
- When session directory layout is unknown, the CLI suggests candidate directories by searching for files referencing the project path rather than requiring the user to know the answer.
- If no supported agent session is found, the CLI offers a file system browser to locate sessions manually.
- When the user manually enters session directories for an unknown agent, all files from those directories are included as-is without agent-specific parsing.

**Worktree support:**
- Session discovery searches across all worktrees associated with the same repository.
- Session folder attribution stores both the filesystem path and branch name for each worktree; branch information is read directly from each worktree's HEAD file in `.git/worktrees/<name>/HEAD`.
- Worktree discovery works on archived repos without requiring git command availability.

**Archive session layout:**
- The archive contains a `sessions/.claude/` directory that replicates the structure of the local `.claude` folder.
- Project session files are stored under `sessions/.claude/projects/<encoded-path>/` matching the exact local structure.
- Plan files are stored under `sessions/.claude/plans/`.
- Debug session files are stored under `sessions/.claude/debug/`.
- `getArchiveRoot` returns `~/.claude`; zip entry paths are computed using the archive root and relative path resolution, placing files under `sessions/.claude/` while preserving the original `.claude` hierarchy.
- Path computation for zip entries is uniform across all file types without special-case handling for plans or debug files.

---

### CLI Tool — Plan and Debug File Collection

**Plan file collection:**
- Only plan files explicitly referenced in session transcripts are collected — orphaned or unreferenced files are excluded.
- Reference detection uses grep against session transcript content to identify mentioned `~/.claude/plans/*.md` file paths.
- Discovered plan files are collected into a `claude-plans/` directory within the zip output.

**Debug file collection:**
- Only debug files explicitly referenced in session transcripts are collected.
- Reference detection uses grep against session transcript content to identify `.claude/debug/<uuid>.txt` file paths.
- Discovered debug files are collected into a `claude-debug/` directory within the zip output.
- Both plan and debug collection mechanisms are treated equivalently and symmetrically.

---

### CLI Tool — Secret Redaction

Secret redaction is applied to session JSONL transcripts. Coverage includes API keys, private keys, bearer tokens, and connection strings. The CLI displays a message early in its output communicating that secrets are handled with care. This message includes a `(best effort)` qualifier to set accurate expectations about the limits of the protection. Sensitive keys found in session data are masked before the session is included in the archive so that raw secret values are never packaged.

---

### CLI Tool — Privacy and Consent

A clear privacy notice is displayed before any file packaging or upload begins, explaining what data will be collected, how it will be used, and emphasizing privacy protection. Explicit user consent is required before uploading or sharing anything. The consent prompt uses `AskUserQuestion` or equivalent interactive tooling. The consent prompt defaults to `Y`.

The privacy notice text reproduced in the README covers: permission to study the project, a commitment that no commercial software will be built from the code, and a retraction contact at `support@codespeak.dev`.

---

### CLI Tool — TUI (ink-based interface)

The CLI uses ink (React for terminal) as the TUI framework.

**Screens and navigation:**
- The application always opens to the project list screen. If the current working directory is located under one of the projects in the list, that project is marked with a `(current dir)` label, sorted to index 0, and pre-selected.
- Project List screen greets the user by first name sourced from git config, lists all discovered projects with the agent(s) each has sessions from (sorted by total session count descending), and offers `Show stats` and `Share` action buttons per project. When one or more projects have already been shared, the heading reads `Share another project:`. The project list supports scrolling when entries exceed visible terminal height.
- Share Project screen displays project path, repo URL if present, agents used with session counts per agent, file count and LOC by programming language (using file extensions), total commit count across all branches, number of untracked files, number of tracked files with uncommitted changes, and worktree count with aggregated session counts from all worktrees. Shows a welcome header when it is the first screen the user sees. Pressing Escape navigates to the Project List screen.
- Consent screen displays CodeSpeak's data use terms with a Share button that creates a zip and uploads it. Pressing Enter confirms consent; pressing Escape is the secondary dismissive action.
- Review Before Sharing screen has a Sessions tab (showing agent session list or static agent/count list depending on `SESSION_PREVIEW_ENABLED`), a Code tab, and a Git tab. Has a prominent Share CTA at the top. Pressing Escape navigates back.
- Post-share screen shows a Thank You box with `Share Another` as the default highlighted action and `Quit` as secondary. A `To request deletion` message appears as a footnote outside and below the Thank You box.

**Focus zone navigation:**
- The Review screen tracks a `focusZone` state cycling through tabs, content, and action buttons via Tab key.
- Only the active focus zone processes keyboard input to prevent concurrent handler conflicts.
- `TabBar` does not handle Tab key internally — Tab is handled at the Review screen level.
- `AgentTab`, `CodeTab`, and `GitTab` each accept an `active` prop gating keyboard input.
- `ScrollableList` `active` prop is passed through from parent tab components.
- When focus is in the tabs zone, pressing down arrow moves focus to the content zone. When the user reaches the top of the content list, focus moves to the tabs zone. When the user reaches the bottom, focus moves to the actions zone.
- Pressing Shift+Enter triggers the primary action on the currently focused element. Pressing Tab cycles between focus zones.

**Key bindings and affordances:**
- Arrow keys (left, right, up, down) and Enter are used for navigation and selection throughout. Single-letter shortcuts are replaced by the ActionBar component.
- The Escape binding is indicated on the Back button. The primary action binding (Shift+Enter) is indicated on the primary action button.
- `GO_PROJECT_LIST` action clears navigation history so Escape on the share-project screen always navigates to the project list.

**Session preview feature flag:**
- `SESSION_PREVIEW_ENABLED` is controlled via `VIBE_SHARING_SESSION_PREVIEW` environment variable and defaults to false.
- When disabled, the Sessions tab displays a static read-only list of agent names and session counts.
- When enabled, the Sessions tab renders an interactive agent list that drills into a full agent tab with session preview.
- The Sessions tab is only shown if the project has agents.
- The agents section in the share-project screen is always visible regardless of the flag.

**Project discovery:**
- Discovery merges worktree entries for the same git repository into a single project list entry with combined agent lists and aggregated session counts.
- Discovery finds all projects under a parent directory including subfolders with their own `.git` roots and associated agent sessions; each such subfolder appears as a distinct entry.
- Projects whose paths contain hyphens ambiguous under lossy decode must still be discoverable.
- Cursor orphaned workspace discovery via blob data extraction and Composer session discovery via `state.vscdb` are included.

**File extension to language mapping:** hand-maintained extension-to-language map; tokei or cloc used when available as supplement.

**Visual design:**
- All screens have a modern, polished visual appearance using the terminal's full height for long scrollable lists.
- Progress bars are displayed during long-running operations.
- Tab components display cyan color, bold text, and a cursor indicator when their content zone is active/focused; dimmed styling when inactive.
- The content list displays a visible highlight when the content zone is focused.
- Review screen and Share Project screen show a legend explaining Tab key navigation and available keyboard shortcuts.
- The project matching the current working directory is labeled `(current dir)` in the project list.
- Enter/confirm action on consent screen is bright and visually prominent. Esc/dismiss is visually secondary.
- Share Another action is visually highlighted as default; Quit is de-emphasized.

**Non-goals:**
- Agent-specific parsing of manually entered session directory paths
- Manual filesystem browsing and file picking for session selection
- Git bundle or full history inclusion in the Code tab shared archive view

---

### AWS Backend Infrastructure

Infrastructure is defined and managed entirely via AWS CDK CLI commands with no AWS console interaction required. The stack deploys to `eu-north-1`. An `.envrc` file at the project root sets `AWS_PROFILE` to `default` and is automatically sourced by direnv on directory entry and unset on exit. The `scripts/` directory is added to PATH via `.envrc`.

**Lambda functions:**
- `presign`: validates request, generates S3 presigned PUT URL, stores upload metadata in DynamoDB, publishes notification to upload events SNS topic (fire-and-forget).
- `confirm`: verifies S3 object exists via `HeadObject` (requiring `s3:GetObject` IAM permission), marks upload confirmed in DynamoDB, publishes notification to upload events SNS topic (fire-and-forget). Does not return a share URL.
- `health`: returns `{ status: "ok" }`.
- `list-uploads`: scans DynamoDB for confirmed uploads and returns presigned GET URLs with 1-hour expiry.
- `slack-notify`: receives SNS messages and POSTs to Slack webhook URL retrieved from SSM Parameter Store. Caches webhook URL with a 5-minute TTL. Throws on Slack delivery failure so SNS can retry. Logs a warning and continues if the SSM parameter is absent. Invalidates cached token immediately on error response.
- `pre-sign-up`: Lambda trigger on Cognito that rejects email addresses not ending in `@codespeak.dev`, auto-confirms and auto-verifies matching addresses, and delegates actual email verification to Cognito's built-in flow.

**IAM scoping:**
- Presign Lambda: `dynamodb:PutItem` only.
- Confirm Lambda: `dynamodb:GetItem`, `dynamodb:UpdateItem`, `s3:GetObject`.
- Slack Lambda: read-only access to SSM SecureString at `/vibe-share/slack-webhook-url`.
- Both presign and confirm Lambdas have IAM permissions to publish to the upload events SNS topic.

**API Gateway:**
- HTTP API v2 with throttling. Rate limiting at 10 requests per minute per IP.
- `GET /api/v1/uploads` protected by Cognito JWT authorizer.
- CORS `allowOrigins` configured as an explicit list: `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`. API Gateway HTTP API v2 does not support wildcard characters in `allowOrigins`.

**S3:**
- Upload file size capped at 5 GB.
- CORS configuration uses `s3CorsAllowedOrigins` (wildcard-capable): `codespeak.dev`, `*.codespeak.dev`.
- Presigned PUT URLs include a `ContentType` condition enforcing `application/zip`; S3 rejects mismatched Content-Type with 403.
- All public access blocked. Files retained indefinitely.

**DynamoDB:**
- Table stores: `uploadId`, `status`, `timestamp`, IP address, email, name, repo URL.
- Point-in-time recovery enabled using `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`.
- IAM permissions scoped to exact required actions only.

**SNS topics:**
- Infrastructure alarms topic: delivers to `alarms@codespeak.dev` email subscription and Slack Lambda.
- Upload events topic (separate from alarms): delivers to Slack Lambda only. No email subscription. Fire-and-forget from presign and confirm Lambdas.

**CloudWatch alarms:** trigger on Lambda errors > 5 in 5 minutes, API 4xx errors > 50, API 5xx errors > 5. Both alarm and OK recovery actions configured on all alarms.

**SSM Parameter Store:**
- Slack webhook URL stored as SecureString at `/vibe-share/slack-webhook-url`.
- SSM PutParameter operations use overwrite flag to avoid `ParameterAlreadyExists` errors on redeployment.
- Alarm email address stored in version-controlled config file (not SSM).

**CORS and alarm config values** (`corsAllowedOrigins`, `s3CorsAllowedOrigins`, alarm email address, SSM parameter name) are extracted to a shared config file. Default deployment region is sourced from this config file rather than hardcoded inline.

**Custom domain:**
- ACM SSL certificate provisioned for `vibe-share.codespeak.dev` with DNS validation.
- API Gateway custom domain mapped to `vibe-share.codespeak.dev`.
- DNS records configured at the registrar (not Route 53 automation).
- CDK stack `env` configured with explicit AWS account and region values.

**CDK bootstrap:** must be run from within a directory containing a valid `cdk.json` or with an explicit `aws://ACCOUNT_ID/REGION` argument.

**Scripts:**
- `scripts/cdk-deploy`: invokes CDK deploy with auto-approve flag included automatically.
- `scripts/status.sh`: queries DynamoDB and displays all upload records in a formatted table with columns NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. SIZE in human-readable format (e.g., `2MB`). CONFIRMED shows `-` when absent. Timestamps in ISO 8601. Lambda log fetching is opt-in via `--logs` flag.
- `scripts/clear-uploads`: displays count of items to be deleted, requires the user to type `delete all` before proceeding, then deletes all DynamoDB records and all S3 objects.

**Non-goals:**
- Automatic deletion or expiry of S3 uploaded files
- Unauthenticated API endpoint remediation
- Abandoned upload and pending record cleanup
- Generic error message remediation
- WAF protection
- CloudFront CDN and DDoS protection
- System-wide AWS CLI profile configuration
- Email notifications for upload events

---

### Slack Notifications

Slack notifications are delivered via the `slack-notify` Lambda subscribed to both the infrastructure alarms SNS topic and the upload events SNS topic.

**Upload event notifications:**
- The initial upload notification includes the user's name, email address, and repository URL in the top-level message.
- All subsequent detail updates for the same upload are posted as threaded replies under the initial top-level message.
- Each file upload generates its own independent Slack thread; uploads are never grouped into a shared thread. Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first deterministically claims thread creation.
- When processing is complete, a download link is added to the top-level Slack message pointing to the admin web UI where Cognito login is required, immediately triggering download on authentication.
- Upload event notifications from internal users (determined by querying `InternalEmailsTable`) have the top-level message prefixed with `:codespeak:` emoji. The `slack-notify` Lambda receives the `InternalEmailsTable` name via environment variable and has read access to it.

**Alarm notifications:**
- CloudWatch alarm notifications follow the same message structure: human-readable top-level message with formatted JSON in a threaded reply.

**Message format:**
- Top-level message: human-readable plain text.
- Thread reply: full structured data as pretty-printed JSON wrapped in triple-backtick code fences.

**Failure handling:**
- Lambda throws on Slack delivery failure so SNS treats delivery as failed and retries (up to 2 additional times).
- Lambda logs a warning and continues gracefully if the SSM SecureString parameter is absent.
- Lambda invalidates cached Slack bot token immediately on error response, without waiting for the 5-minute TTL.
- An email alert is sent when a Slack notification operation fails.

**Non-goals:**
- Download link in CLI output
- ShareUrl generation and presigning in the confirm endpoint

---

### Web Admin UI

A serverless web application served via CloudFront at `https://admin.vibe-share.codespeak.dev`.

**Authentication:**
- Amazon Cognito User Pool with hosted OAuth login.
- Self-registration restricted to `@codespeak.dev` email domain via pre-sign-up Lambda trigger.
- Users receive a temporary password via email and must set a permanent password on first login.
- Email delivery uses Amazon SES (required regions: `us-east-1`, `us-west-2`, or `eu-west-1`) to avoid Cognito's default sender 50 emails/day cap and spam classification issues.
- Cognito requires email verification before a new account is active.
- Access control is per-user; team members are added and removed via AWS CLI or user creation script.
- User creation script accepts an email argument and resolves the Cognito User Pool ID from CDK stack outputs.

**File browsing:**
- `GET /api/v1/uploads` returns confirmed upload records from DynamoDB with presigned S3 GET URLs with 1-hour expiry.
- Uploads table columns: NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID.
- Internal emails (persisted in `InternalEmailsTable`) are filtered from the main table by default. A checkbox toggle shows or hides internal emails. Checkbox state is persisted to and restored from `localStorage`.
- A per-row button on the main table allows marking a user's email as internal.
- A dedicated page manages the list of internal emails.
- Internal upload rows display a 🛠️ wrench emoji prepended to the filename, with grey background `#f0f0f0` and hover `#e8e8e8`.

**GitHub URL normalization:**
- All recognized GitHub URL formats (HTTPS with/without `.git` suffix, SSH `git@github.com:user/repo.git`, `git://` protocol, URLs with trailing path segments) are normalized to `user/repo` display format rendered as a clickable hyperlink to `https://github.com/user/repo`.

**ACM certificate:**
- Must be created in `us-east-1` (CloudFront architectural requirement) with DNS validation for `admin.vibe-share.codespeak.dev`.
- ARN imported into the CDK stack and attached to the CloudFront distribution as an alternate domain name.

**CDK stack outputs:** `ApiUrl`, `BucketName`, `CognitoClientId`, `CognitoDomain`, `CognitoUserPoolId`, `WebUiUrl`, `TableName`, `CustomDomainHostedZoneId`, `CustomDomainTarget`.

**UI:**
- Simple web UI. CloudFront serves static site at `https://dzy3mo6yrryh.cloudfront.net` (also accessible via custom domain).
- Displays authenticated user's email address.
- GitHub repository URL displayed in shortened `user/repo` format as a hyperlink.

---

### Session Viewer (Next.js Application)

A Next.js application in the `session-viewer/` directory for browsing and inspecting AI agent sessions.

**Project and session list:**
- Sessions are grouped by project. Session discovery imports logic from the parent project's compiled `dist/` output.
- Sessions are displayed in a single-column list sorted by the timestamp of the last message, most recently active first.
- Session discovery supports filtering by agent type; the project page displays only Claude Code agent sessions.
- Each session card shows: AI title (from `ai-title` entry) or fallback (first lines of user messages, user message count, agent summary content); session start timestamp, end timestamp, and duration; message count and prompt count in the format `XX msgs (YY prompts)` where prompt count excludes entries where all content blocks are `tool_result` type; a purple `plan` badge when the session contains plan file references (links to the plan entry within the session).
- Same-day sessions display the date once with both start and end times separated by `→` and duration in parentheses. Multi-day same-year sessions show month/day for both endpoints. Cross-year sessions show full date including year. Single-timestamp sessions show date and time only with no arrow or duration. All times use 24-hour format. Year is included only when the session occurred in a prior calendar year.
- `ProjectCard` displays only the session count pill in the top-right area; no agent badge is rendered.

**Session detail page:**
- Loads JSONL entries via paginated API; all entries load automatically in sequence without requiring scroll interaction (eager pagination).
- Displays AI-generated title, plan badge, agent name, session ID (monospace), message count, prompt count, start/end date-time with duration, file size via a shared `SessionStats` component used by both session cards and the detail page.
- Session metadata is retrieved via single-file read for the requested session only (not a project-wide scan).
- Session discovery data and metadata are fetched in parallel on the detail page.
- The most frequently used model is displayed at the session level with format `Models: <model> x<count> (default) <model2> x<count2>`. Individual cards show the model label only when it differs from the session-level most common model.
- Message count at the top of the conversation view accurately reflects the number of messages visible when all content is expanded.

**Three-layer display pipeline:**
The display system computes card display in three ordered layers, each depending only on the preceding layer's output:
1. **Per-card defaults:** each card is assigned `isPrimary` and `defaultExpanded` flags based on signal level.
2. **Topical grouping:** consecutive related cards (tool-call cycles, progress runs) are merged into topical groups. A topical group forms only when it contains two or more cards; single-card sequences appear standalone. Filler entries join an active topical group rather than forming standalone groups.
3. **Collapsed-group formation:** all non-primary-interest cards between any two primary-interest cards are wrapped into exactly one collapsed group regardless of quantity or variety. Between any two primary-interest cards there is at most one collapsed group.

No card is ever permanently hidden or irrecoverably inaccessible — all collapsed or grouped content has an expand mechanism.

**Signal classification:**
- High-signal (primary-interest, expanded by default): user prompts, agent questions, answers to `AskUserQuestion`/`ExitPlanMode`, plans, completion reports.
- Low-signal (collapsed by default): progress updates, tool calls, thinking blocks, queue operations.
- Consecutive progress blocks merge into a single unified group. Groups containing only queue-operation entries auto-expand on initial render.

**Collapsed group display:**
- Header layout: left side `▸ XXX cards`, middle shows tool-call breakdown in `N ToolName` format (e.g., `3 Subagent`, `8 Bash`), right side shows duration.
- Duration uses adaptive formatting: sub-second → `450ms`, under one minute → `12s`, one minute or longer → `2m 13s`. Duration shown only on groups with timing data; the `other` group shows no duration.
- Duration calculation uses the span between earliest and latest timestamps among the group's entries.
- Topical group summaries display tool name and count (e.g., `1 Read` or `3 Read, 2 Bash`).
- `Agent` is replaced with `Subagent` throughout all collapsed group summary displays.
- When a collapsed group is expanded and contains exactly one topical group as its sole child, both expand simultaneously.

**Expanded group visual treatment:** background tint (`bg-blue-950/20`) with border (`border-blue-900/30`) for collapsed groups; `bg-indigo-950/15` with `border-indigo-900/30` for topical groups.

**Card types and rendering:**
- User messages: plain text (no markdown), expanded by default, blue background (`bg-blue-950/50`, `border-blue-700/40`).
- User messages whose content consists exclusively of `tool_result` blocks are classified as `tool-result` subtype, collapsed by default, displayed with amber badge labeled `tool result`, and treated as non-user messages for ellipsis grouping.
- Assistant messages: render as GitHub Flavored Markdown (headings, lists, code blocks, tables, bold, italic), green background (`bg-green-950/40`, `border-green-800/40`).
- `ai-title` cards: title text in card header with no card body.
- `FileSnapshot` cards with no tracked files: `no files tracked` in card header, no body. With tracked files: expandable file list in body.
- Thinking blocks: tagged with secondary label; collapsed state shows content preview.
- Subagent (`Subagent`) cards: cyan-tinted container. Title bar shows subagent type and description. When expanded: `Prompt` heading above prompt markdown content (no description repetition), then standalone `Worked for XXs` duration label as separator, then result content as markdown.
- Each subagent card is enriched with corresponding result data from a later `tool-result` card. Each subagent `tool-result` card includes a link back to its corresponding tool-call card. Subagent tool calls are only grouped together when separated exclusively by progress/filler cards, not by thinking entries.
- Thinking cards are not grouped with agent tool result cards.

**Plan file rendering:**
- `tool_use` blocks for Write or Edit operations targeting `~/.claude/plans/*.md` render the file's markdown content with a `Plan: <filename>` header above it (purple-tinted prose styling).
- `tool_result` blocks for Read operations targeting plan files render markdown content similarly.
- Plan file operation detection identifies actual `tool_use` blocks of type Write, Read, or Edit — not textual mentions in `tool_result` content.
- `firstPlanLineIndex` points to the actual plan file operation `tool_use` block.
- Entry cards referencing plan files display a purple badge. Clicking the badge expands the entry and navigates to it. When a URL hash targets such an entry, the entry is extracted from the grouping system and rendered as a standalone card between collapsed groups, force-expanded.

**URL hash navigation:**
- Hash is parsed after client-side mount to capture the value during Next.js client navigation.
- A `hashchange` event listener handles both initial page load and same-page hash navigation.
- `PlanBadge` on the session detail page is a client component using a button element that assigns directly to `window.location.hash` to fire the native hashchange event.
- Session card plan badges on the project page use plain anchor tags.
- Scroll to target element is deferred using nested `requestAnimationFrame` callbacks.

**Tool call and result headers:**
- Type badge renders exactly once per message in the `EntryCard` header.
- Tool names render as amber-colored badges in entry card headers.
- Bash tool call headers show the command truncated at the trailing end.
- File read/write headers show the file path truncated with leading ellipsis.
- Grep/glob headers show the relevant path with leading ellipsis.
- Tool result headers show tool name and contextual detail resolved via tool-use-id lookup map.
- Tool call and result block headers retain all metadata in both collapsed and expanded states (identical appearance in both states).
- Tool call node blocks are expanded by default when the parent entry is opened.
- Tool result blocks are expanded by default when the parent entry is opened; expanding a tool result also expands nested file contents.

**IDE context tags:**
- `<ide_*>` pattern tags in user messages display a grey clickable badge with the tag name in angle bracket notation (e.g., `<ide_opened_file>`).
- Clicking toggles expanded state showing full tag content in a scrollable panel.
- Long paths are truncated from the beginning with `...` prefix. CWD prefix is replaced with `$CWD`.
- Collapsed badge shows short preview (first 60 characters of first line) with path truncation and CWD substitution applied.
- `projectPath` is threaded from server component through the hierarchy to all renderers.

**Message timestamps:** display date, hours, minutes, and seconds; positioned at the far right of the header row; visible in both collapsed and expanded states. Rendered/JSON toggle buttons are visible only when the entry is expanded, positioned to the left of the timestamp.

**Filters:**
- The session view includes UI controls allowing users to change the active filter setting.
- Per-tag filter controls independently override card expansion state and visibility promotion; logical grouping is not subject to filter override.
- Filter state is persisted to localStorage and loaded on initialization.
- Tag pill left side (tag name): bright when set as primary interest, dim when collapsed into groups — reflecting current `FilterState` on initial render.
- Tag pill right side chevron: reflects current expanded/collapsed default from `FilterState` on initial render.
- Amber ring indicator on pills that have been customized.
- Filter pill colors: prompts `bg-blue-900 text-blue-300`; plans `bg-purple-900 text-purple-300`; tool calls `bg-[#3d2f0f] text-yellow-300`; AI title `bg-cyan-900 text-cyan-300`; progress/queue/file snapshots `bg-neutral-800 text-neutral-400`.
- Off/disabled state pills: `bg-neutral-900` grey background with colored border matching category color and `text-neutral-600` grey text (outlined appearance, not filled).
- Collapsing an expanded filter tag pill updates visible conversation entries.
- Expand All and Re-apply Filter controls are available in the session view.

**SQLite cache:**
- Project list discovery results (agent directory scans, git worktree list output) are cached in SQLite with a 30-second TTL.
- Cache stores session metadata, session entries (with `cwd`, `type`, `timestamp` columns), and entry tags.
- Sessions API serves paginated results from SQLite rather than parsing JSONL files on each request.
- Session discovery queries SQLite by `cwd` column (indexed) to filter sessions by project path.
- Uncached sessions have `cwd` verified before being included in project-filtered results.

**Non-goals:**
- Support for non-Claude-Code agent session formats in the initial session-viewer build
- Agent badge display on `ProjectCard` until multiple agent types are supported
- Dedicated collapsible plan summary card at the top of the session

---

### Cursor Session Bundling (CLI)

The CLI copies Cursor `store.db` SQLite database files wholesale into the project archive rather than extracting individual JSON blobs. `state.vscdb` extraction uses `sqlite3 CLI` with `-readonly` flag.

**Plan discovery from global registry:**
- `discoverPlansFromRegistry` queries the `composer.planRegistry` key in `state.vscdb` `ItemTable` to discover plan files whose `createdBy` composerId matches any composerId associated with discovered sessions.
- ComposerId-to-agentId mapping is resolved by querying `composerData` entries in `cursorDiskKV` or workspace-level `composer.composerData`.
- Registry-based discovery is merged with blob-scan discovery so both strategies always run.
- Discovered plan `.md` files are included in the archive.

**Filtered state extract:**
- `createStateExtract` creates a filtered `state.vscdb` containing: `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData` UUID entries from `cursorDiskKV`.
- The filtered extract contains only plan registry and workspace composer metadata, not the full database.

**Archive entries:**
- `getProviderFiles` and `getVirtualFiles` include filtered `state.vscdb`, `workspace.json`, and `discovery-manifest.json` in the archive.
- `buildDiscoveryManifest` generates `discovery-manifest.json` with intermediate findings: hashes, slugs, composerIds, plan matches, original paths, and algorithms.
- The archive replicates the `.cursor` subtree structure.

**Non-goals:**
- Human-readable JSONL extraction of Cursor database contents

---

### Session Log Extraction Script

A saved script reads all session files in `~/.claude` for the current project and extracts: user messages, `AskUserQuestion` tool prompts, user answers to those questions, `ExitPlanMode` requests with plan approval or rejection results, TODO creation and status change events, and Claude's messages sent when it finishes implementing something.

Output:
- `intent/msg-and-answers.md`: all extracted items in chronological order separated by `==========` delimiters.
- `intent/sessions/<session-id>.md`: one file per session, each containing only that session's extracted items separated by `==========` delimiters.

The script is self-contained and executable independently so extraction can be repeated without manual intervention.

---

### Vibe Coder Personality Analysis

A personality test that characterizes developer working style from measurable signals in code, git history, and AI agent session logs. Only Claude Code agent sessions are supported as the data source.

**Metrics system:**
- Each metric is defined in a separate file under `metrics/` subdirectory.
- A central tracking file at `intent/vibe-personality/TRACKING.md` lists each raw candidate metric from `vibe-personality.md` with: status emoji (not started / planning / implementing / testing / done), inline definition/description, and a clickable cursor:// link to the appropriate stage prompt.
- As metrics advance through states, links in TRACKING.md are updated to point to the next stage's prompt.
- A clickable 🔄 Sync link at the top of TRACKING.md opens Claude Code with instructions to diff `vibe-personality.md` against TRACKING.md and surface missing metrics for human review before adding.
- Prompt templates exist at `prompts/plan.md`, `prompts/implement.md`, `prompts/test.md`, `prompts/done.md`, and `prompts/sync.md`.
- General workflow instructions live in `intent/vibe-personality/CLAUDE.md`.

**Impatience metric (`metrics/impatience.md`):**
- Detects three signal types: sequence interruptions (user-prompt appearing after tool-cycle-group), explicit tool rejections (error-flagged events with rejection content), and orphan `tool_use` events (tool_use with no matching tool_result).
- Calculates three normalized rates: impatience events per user message, impatience events per minute, and tool rejection rate as a ratio.
- Implementation lives in `src/personality/impatience.ts` and reuses the `buildSegments()` utility from `grouping.ts`.

**Permissions observability (`intent/vibe-personality/permissions.md`):**
- Documents what permission-related signals exist in JSONL session logs.
- Permission prompt records distinguish between user agreeing, user declining, and user providing alternative instructions.
- Mode switch events (plan, auto, edit-automatically, bypass-permissions) are recorded via `permissionMode` field changes.
- Auto-approval cannot be definitively distinguished from user-clicked approval: no explicit `autoApproved` field exists in the JSONL format. Auto-approval can only be approximated by combining `permissionMode` with `permissions.allow` patterns from `settings.json`.
- Tool invocations without a corresponding permission prompt are inferred from the absence of a prompt record when the active permission mode would suppress it.

**Personality types:**
- Approximately 8 named archetypes defined rather than the full 32-combination set.
- Traits are amusing and reliably detectable from available signals; LLMs may be used as part of detection.

**Project scope:**
- Accepts a configurable set of projects to analyze; all Claude Code projects on the machine are included by default with ability to exclude specific projects.

**Non-goals:**
- Support for non-Claude agents (Cursor, Cline) in the first version
- Full 32-archetype named type system in the initial implementation
- Threshold classification for impatience (metric captures rates only)
- Weighting scheme across impatience signal types
- Modification of the Claude Code client to add an `autoApproved` field

---

### GitHub Repository Setup

The project is hosted under the `codespeak-dev` organization as `codespeak-dev/vibe-sharing`. `plugin.json` and README install instructions reference `codespeak-dev` as the GitHub org.

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected in favor of AWS CDK because SST is not officially AWS-supported.
- **AWS Chatbot for Slack notifications** — involves manual OAuth setup in the AWS Console and dependency on an AWS-managed service; rejected in favor of a custom Slack webhook Lambda to retain formatting control.
- **Storing Slack webhook URL in a config file** — rejected in favor of SSM Parameter Store to avoid exposing sensitive credentials in source code.
- **Storing alarm email address in SSM Parameter Store** — email is classified as non-sensitive plain configuration; SSM lookup complexity is unjustified; stored in checked-in config file instead.
- **Single unified CORS config list for API Gateway and S3** — rejected because API Gateway v2 does not support wildcard characters in CORS origin values while S3 does, requiring two separate lists.
- **Inlining all scan context and build logic directly in the command markdown** — implemented and then rejected because invoking via `claude --plugin-dir . "/vibe-share"` does not execute the command and instead opens Claude Code idly.
- **Including the raw `.git` directory in the archive** — git repositories with long history can make the `.git` directory very large; git bundle used as compact alternative.
- **Removing excluded directories entirely from the archive output** — rejected; excluded directory entries are preserved while their contents are excluded.
- **Producing only a text-based file tree without actual file contents** — rejected; actual file copies are included subject to secret filtering.
- **Using only a single git diff output** — rejected in favor of capturing both unstaged and vs-HEAD separately as distinct files.
- **Placing session files under `sessions/claude-code/` with a `referenced/` subdirectory** — rejected in favor of replicating the actual `.claude` folder structure directly under `sessions/.claude/`.
- **Collecting all debug files regardless of session transcript references** — rejected in favor of grep-based reference detection to avoid including orphaned or unrelated debug logs.
- **Browse filesystem option in the no-sessions prompt** — was a stub with no implementation; replaced by worktree-based heuristic discovery.
- **Tracking personality metrics at the V.I.B.E.S. trait or sub-signal level** — rejected in favor of tracking at the granularity of raw candidate metrics from `vibe-personality.md`.
- **Automated TRACKING.md syncing without human review** — rejected in favor of a clickable link that triggers a human-reviewed diff workflow.
- **Timing heuristic using tool_use to tool_result delay to infer auto-approval** — execution time noise conflates user response time with actual tool execution time, making inference unreliable.
- **Download Lambda at `/api/v1/download/{uploadId}` returning a 302 redirect** — proposed but not implemented; rejected in favor of returning the presigned URL directly from the confirm endpoint.
- **Web frontend at `codespeak.dev/share/{id}` via CloudFront and S3 static site** — requires additional infrastructure; rejected in favor of the presigned URL approach (subsequently also removed).
- **Lazy-loading via IntersectionObserver sentinel in session viewer** — with collapsed groups keeping the page short, the sentinel remained in viewport on initial load and never triggered again due to observer recreation on dependency changes and a race condition; replaced by eager sequential pagination.
- **Displaying per-agent tabs in the Review Before Sharing screen** — replaced with a single unified Sessions tab.
- **Three separate JSONL scan functions for titles, plans, and prompt counts** — each reading the same files independently; consolidated into a single-pass scan.
- **Outer Link wrapper containing a child Link plan badge** — nested anchor tags in HTML are stripped by browsers, breaking inner link navigation; replaced with a `div` plus `onClick` handler for the card and a standalone anchor for the plan badge.
- **Using `window.location.hash` via plain anchor tags for plan badge navigation on session detail page** — Next.js intercepts anchor tag clicks for client-side routing, preventing the native `hashchange` event from firing; replaced by a `PlanBadge` client component using a button element that assigns directly to `window.location.hash`.
- **Removing CORS entirely from API Gateway for the CLI-only tool** — deferred; CORS is a browser-side mechanism irrelevant to CLI clients, but kept to accommodate future browser-based clients.
- **FTS5 full-text search index for session entry search in SQLite** — insufficient for JSON field-wise querying use case; rejected in favor of structured columns with appropriate indexes.
- **Grouping algorithm that buffers thinking-only assistant entries and attaches them to the next ToolCycle** — caused thinking cards to be grouped with agent tool result cards incorrectly; rejected.
- **Topical group creation that wrapped single-card sequences** — nonsensical; single-card sequences remain as standalone cards without a group wrapper.
- **Displaying model on every card regardless of session-level default** — redundant; replaced by session-level most-common-model display with per-card model shown only for exceptions.
- **Grouping subagent tool calls with surrounding progress cards** — does not help the user match subagent tasks with their results; replaced by enrichment approach with cross-references linking tool-call and tool-result cards.
- **Displaying description a second time in the subagent tool-use card body** — redundant duplication; body shows only `Prompt` heading above prompt content, then elapsed time label, then result.
- **Displaying elapsed time as part of the result section heading (e.g., `Result (Xm Ys)`)** — rejected; replaced by a standalone `Worked for XXs` label between sections.
- **Extracting JSON blobs from Cursor SQLite databases as JSONL** — rejected; user selected copying `store.db` files wholesale for broad compatibility.
- **Text-based LIKE matching of plan references within session chat blobs** — plan references are stored in binary protobuf blobs, not JSON text, causing zero matches; abandoned as sole strategy in favor of registry-based discovery combined with blob-scanning.
- **Using `@inquirer/prompts` as the CLI TUI framework** — cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation; replaced by ink.
- **Cognito default email sender (`no-reply@verificationemail.com`)** — 50 emails/day hard cap, high spam/junk classification rate, blocked by corporate email filters; replaced with Amazon SES.
- **Pre-sign-up Lambda auto-confirming users and auto-verifying email attributes** — bypassed Cognito's native verification flow, allowing unverified accounts; fixed by removing auto-confirmation/verification and delegating to Cognito's built-in flow.
- **`s3:HeadObject` as IAM action for HeadObject operations** — not a valid IAM action; `s3:GetObject` is the correct permission; using the wrong action caused AccessDenied errors silently swallowed as "File not uploaded yet".
- **Provisioning ACM certificate for `api.codespeak.dev`** — wrong subdomain; correct subdomain is `vibe-share.codespeak.dev`.

---

## Known Issues

- Opening any Cursor session in the Review screen for the `khariton-style` project displays "No messages found in this session" despite the session containing messages; root cause not yet confirmed.
- Some Claude sessions display only a UUID on the Review screen instead of session content; root cause not yet confirmed.
- Gemini CLI sessions directory reports sessions found but none are shown in the Review screen; root cause not yet confirmed.
- Up navigation in the main content list on the Review screen is broken; root cause not yet confirmed.
- Session discovery logic may overlook sessions or handle them inconsistently; no confirmed root cause identified.
- The Slack webhook Lambda caches the SSM webhook URL with no TTL-based invalidation on rotation other than natural expiry after 5 minutes; a rotated webhook URL requires either a cold start or waiting for the TTL window.
- The Slack Lambda catches errors and logs without rethrowing on some code paths, causing SNS to treat delivery as successful even when Slack is unreachable, suppressing retry behavior on those paths.
- No per-environment variation in `config.ts` — changing values between staging and production requires file edits.
- CloudFormation stack left in `UPDATE_IN_PROGRESS` state from a canceled deployment blocks new updates until the state resolves.
- IDE unresolved AWS SDK type errors are false positives that resolve at esbuild bundle time.
- 90.6% of chat hashes in Cursor's chats storage do not match current `workspaceStorage` entries; possible causes include stale records from deleted workspaces or parallel ID schemes that evolved independently; root cause unconfirmed.