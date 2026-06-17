# Vibe Sharing — Specification

## Overview

Vibe Sharing is a command-line tool and supporting cloud infrastructure that lets developers package and share their vibe-coded projects together with the complete AI agent session history used to build them. The CLI scans the project directory, locates session files from Claude Code, Cursor, Codex, Gemini, and other agents, filters out secrets and dependency noise, and uploads a structured zip archive to a secure AWS backend. A web-based session viewer and an admin UI complement the CLI, providing browsable access to uploaded sessions and project data. The system is designed so non-technical users can run it via npx with zero configuration.

## Foundation

**Stack:** TypeScript, Node.js 22.x, React/Ink (terminal UI), Next.js (session viewer and admin web UI), AWS CDK (infrastructure), AWS Lambda, API Gateway HTTP API v2, S3, DynamoDB, Cognito, SNS, CloudWatch, SSM Parameter Store, SQLite (local session cache), esbuild (Lambda bundling), react-markdown with remark-gfm.

**Architecture:**
- *Deployment topology:* Serverless AWS backend (Lambda + API Gateway) with a CDK-managed stack deployed to eu-north-1; web UIs served via CloudFront; CLI distributed via npm/npx.
- *Communication pattern:* CLI generates a presigned S3 PUT URL via a presign Lambda, uploads directly to S3, then calls a confirm Lambda to verify and record the upload; upload events are published fire-and-forget to SNS for Slack notification.
- *Data model:* DynamoDB stores upload metadata (uploadId, status, timestamp, IP, email, name, repoUrl); S3 stores zip archives indefinitely; SQLite stores local session cache for the session viewer.
- *Authentication:* Cognito User Pool with hosted domain, OAuth login, and a pre-sign-up Lambda enforcing @codespeak.dev domain restriction; JWT authorizer on the list-uploads API route.

**Cross-cutting constraints:**
- All Lambda functions use Node.js 22.x runtime.
- Lambda functions are bundled via esbuild within CDK.
- IAM permissions follow least-privilege: presign Lambda has only `dynamodb:PutItem`; confirm Lambda has `dynamodb:GetItem`, `dynamodb:UpdateItem`, and `s3:GetObject`.
- Secrets and credentials belonging to the tool operator must never be present on the user's machine.
- The tool must be robust against exceptions — failures must never surface as raw stack traces or silent exits.
- Configuration values (domain names, region, alarm email, CORS origins) are centralised in a shared config file rather than scattered as inline literals.
- Secret redaction is applied to session JSONL transcripts, covering API keys, private keys, bearer tokens, and connection strings, before any content is packaged or uploaded.

---

## Features

### CLI Tool

The CLI is distributed as `@codespeak/vibe-share` on npm and invocable via `npx @codespeak/vibe-share` with no prior installation or configuration. The command name for global installs is `codespeak-vibe-share`.

**Startup and project detection**

On launch, the CLI detects whether the current directory is under git version control. It reads the user's email and name from git config and prompts only when those values are absent. It auto-detects the git remote URL to pre-populate the repo URL field; when no remotes are configured the repo URL prompt is skipped entirely. If launched from a subfolder, the CLI must correctly identify the actual project root regardless of whether a `.git` directory is present — the non-git fallback must not silently use the subdirectory path as the project root.

**Session discovery**

The CLI locates AI agent session directories for the project. For Claude Code, sessions are found in `~/.claude/projects/<encoded-path>/` including all subagent session files and `tool-results/` directories. Session discovery searches across all git worktrees associated with the same repository; sessions from all worktrees are collected and presented together. Worktree tracking stores both the filesystem path and branch name for each worktree, reading branch information directly from each worktree's `.git/worktrees/<name>/HEAD` file without executing git commands, so discovery works on archived repos without requiring git availability.

If Claude Code sessions are not found, the CLI asks which AI agent the user used. Supported agents with filesystem-based session storage include Codex and Gemini. If no supported agent session is found, the CLI offers a heuristic search of candidate directories based on path references rather than asking the user to navigate manually. The Browse filesystem stub is removed; worktree-based heuristic discovery is the supported path.

**File collection — git projects**

For git-managed projects the archive includes:
- Output of `git status` as a text file
- Two separate git diff files: unstaged changes and all uncommitted changes versus HEAD
- Recursive file listing
- A `project/untracked/` directory containing untracked non-gitignored files
- A git bundle with `--all` refs, or null if bundle creation fails (empty repo, shallow clone, corrupted refs); archive creation continues without a bundle when creation fails

For empty git repositories (no commits), all files are captured as untracked using `git ls-files --others --exclude-standard` and archived under `project/untracked/`.

**File collection — non-git projects**

For non-git directories the CLI walks the directory applying exclude patterns (`.venv`, `node_modules`, `.env.local`, and similar dependency/environment folders). Users can customise the exclusion list. Binary file detection or per-file size limits prevent accidental inclusion of large files such as disk images, media files, or ML model weights. Symlink handling prevents external file leakage and infinite directory walk cycles.

**Archive structure**

The archive filename uses the repository name extracted from the git remote URL (stripping `.git` suffix), falling back to the project folder name, formatted as `<name>-<timestamp>.zip`. No `vibe-share` prefix or infix appears in the filename. Archive filename construction logic is deduplicated into a single variable.

Session files are placed under `sessions/.claude/` replicating the actual `.claude` folder hierarchy with path fidelity:
- Project session files under `sessions/.claude/projects/<encoded-path>/`
- Plan files under `sessions/.claude/plans/`
- Debug files under `sessions/.claude/debug/`
- Filtered `state.vscdb` extract (for Cursor) included alongside session files

Plan files and debug files are collected only when they are referenced in session transcripts via grep-based detection, not by filesystem enumeration. The `AgentProvider` interface includes an optional `getArchiveRoot` method; the Claude provider implements it returning `~/.claude`.

Archive size estimation accounts for all included content: session data and project files. For git repos the estimate sums text output sizes, git bundle file size, and untracked file sizes. For non-git repos it sums all project file sizes.

**Privacy and consent**

Before any packaging or upload, a prominent privacy notice is displayed explaining what data will be collected and how it will be used, with emphasis on privacy protection. The notice includes a `(best effort)` qualifier to set accurate expectations. Explicit user consent is required before any upload proceeds. The consent prompt defaults to `Y`. Sensitive keys found in session data are masked/redacted before inclusion in the archive so raw secret values are never packaged.

**Upload flow**

The CLI checks backend availability via the health endpoint before proceeding, falling back to a local zip save if the backend is unreachable. The default backend URL is `https://vibe-share.codespeak.dev`. This can be overridden at runtime via the `VIBE_SHARING_API_URL` environment variable. Metadata fields (email, name, repo URL) are optional and do not block uploads. Upload file size is capped at 5 GB.

When upload fails, the CLI displays which step failed (e.g. "confirm step") along with suggestions to use `--output` to save locally and `--verbose` for detailed diagnostics. With `--verbose`, the full error cause chain including HTTP status code and response body is displayed. Post-upload output does not include a download URL or share URL.

**Local zip fallback**

When the backend is unavailable or disabled, the CLI produces a local zip file the user can handle manually.

**Cross-platform support**

The CLI runs on macOS, Linux, and Windows without platform-specific installation procedures. Installation requires zero steps for end users via npx.

**Telemetry**

On failure, the CLI automatically sends error telemetry to the backend capturing error type, failure step, OS version, Node version, and a sanitised error message (no PII or sensitive content). The CLI generates a correlation/request ID that flows through all steps and corresponding backend calls. The CLI writes a local diagnostic log file on every run with timestamped debug output for user-sharable troubleshooting. Telemetry is sent without requiring explicit user opt-in consent.

**Non-goals:**
- Cursor session support in the initial version
- Server-side read-only agent for file discovery in the initial version
- GitHub repository push-to-org feature in the initial version
- Manual filesystem browsing and file picking for session selection
- Download URL display in post-upload flow
- Share URL field in upload confirm response handling
- User-provided server URL configuration

---

### AWS Backend

**Lambda functions**

Three core Lambda functions:
- **Presign** — validates the request, generates a presigned S3 PUT URL with a `Content-Type: application/zip` condition (S3 returns 403 on mismatch), records upload metadata in DynamoDB with `pending` status, publishes a fire-and-forget notification to the upload events SNS topic including filename, size, IP, and user info.
- **Confirm** — verifies the S3 object exists via `HeadObject` (requires `s3:GetObject` permission; `s3:HeadObject` is not a valid IAM action), updates DynamoDB record status, publishes a notification to the upload events SNS topic including filename, size, and outcome (success or missing-file failure). Does not return a `shareUrl` field.
- **Health** — returns `{ status: "ok" }`.

A fourth **list-uploads** Lambda scans DynamoDB for confirmed uploads and returns presigned S3 GET URLs with 1-hour expiry, protected by a Cognito JWT authorizer.

**Presign request** accepts an optional reporting payload with user email, name, and repo URL stored in DynamoDB.

**S3 errors in confirm Lambda are logged, not silently swallowed.**

**API Gateway**

HTTP API v2 with throttling; rate limiting at 10 requests per minute per IP. CORS `allowOrigins` configured as an explicit list of domain strings (no wildcards, because API Gateway HTTP API v2 does not support wildcard characters in `allowOrigins`): `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`. Explicit `Content-Type` and `Content-Length` headers allowed.

**S3**

Files retained indefinitely with no lifecycle expiry. S3 CORS configured with allowed origins from the central config file using wildcard-capable syntax (`*.codespeak.dev`) for future browser-based presigned upload flows.

**DynamoDB**

Fields: `uploadId`, `status`, `timestamp`, `ipAddress`, `email`, `name`, `repoUrl`. Point-in-time recovery enabled using `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }`. IAM permissions scoped to exact required actions only.

**Token-based invite-only access** supported via a token flag or environment variable backed by DynamoDB or Lambda environment variable lookup.

**CloudWatch alarms and alerting**

Alarms trigger on:
- Lambda errors exceeding 5 in 5 minutes
- API 4xx errors exceeding 50
- API 5xx errors exceeding 5

Each alarm has both an alarm action and an OK recovery action so operators are notified when incidents begin and when they resolve.

An SNS topic delivers alarm notifications to `alarms@codespeak.dev` (email) and to a Slack webhook Lambda simultaneously. The alarm email address is defined in the central config file.

**Slack notification Lambda**

- Retrieves webhook URL from SSM Parameter Store at `/vibe-share/slack-webhook-url` (SecureString).
- Caches the webhook URL with a 5-minute TTL; invalidates the cache immediately on receiving an error response from Slack.
- Throws on Slack delivery failure so SNS treats it as failed and retries (up to 2 additional attempts).
- Logs a warning and continues gracefully if the SSM parameter is absent, so SNS email delivery is not disrupted.
- Formats messages as human-readable plain text at the top level with structured JSON in a thread reply wrapped in triple-backtick code fences.
- CloudWatch alarm notifications follow the same structure.

**Upload events SNS topic**

A separate SNS topic (distinct from the infrastructure alarms topic) receives upload lifecycle events from presign and confirm Lambdas. The Slack notification Lambda is subscribed to this topic. There is no email subscription on the upload events topic. Publish calls are fire-and-forget and do not block API responses. Both presign and confirm Lambdas are granted IAM publish permissions for this topic; the ARN is passed via environment variables.

Each file upload event generates its own independent Slack thread; uploads are not grouped into a shared thread. Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes to eliminate the race condition where the confirm handler may call `getThread` before the presign handler finishes writing to DynamoDB.

**Initial Slack message** for an upload includes the user's name, email address, and repository URL. Detail updates are posted as threaded replies. A download link pointing to the admin web UI authenticated download experience is added to the top-level message when processing completes. Internal uploads (emails in the internal emails table) are prefixed with the `:codespeak:` emoji in the top-level message.

**Custom domain**

API served at `https://vibe-share.codespeak.dev`. ACM certificate provisioned for this domain with DNS validation. API Gateway custom domain mapping configured to the regional endpoint. DNS records configured at the external registrar (not via Route 53 automation). CDK stack env configured with explicit AWS account and region values. The custom domain name is defined exactly once in the codebase.

**Deployment**

AWS CDK with `AdministratorAccess` for development. SSO-based credentials (`aws configure sso`) are supported. CDK Bootstrap must be run from a directory containing `cdk.json` or with an explicit `aws://ACCOUNT_ID/REGION` argument. A `cdk-deploy` script in `scripts/` invokes CDK deploy with auto-approve automatically. The `scripts/` directory is added to PATH via `.envrc` using direnv. An `.envrc` at the project root sets `AWS_PROFILE` to `default` and is automatically sourced/unset by direnv on directory entry/exit.

**CORS configuration** is maintained as two separate lists in the central config file: `corsAllowedOrigins` for API Gateway (explicit domains only) and `s3CorsAllowedOrigins` for S3 (wildcard-capable).

**Non-goals:**
- Automatic deletion or expiry of S3 uploaded files
- Unauthenticated API endpoint remediation
- Abandoned upload and pending record cleanup
- Generic error message remediation
- WAF protection
- CloudFront CDN and DDoS protection via Shield Standard
- System-wide AWS CLI profile configuration
- Email notifications for upload events

---

### Admin Web UI

A serverless, CloudFront-hosted web application for authenticated staff to browse and download uploaded files.

**Access control:** Cognito User Pool with hosted OAuth domain. Self-registration is enabled for `@codespeak.dev` email addresses only; a pre-sign-up Lambda rejects other domains, auto-confirms and auto-verifies qualifying addresses, and delegates verification to Cognito's built-in flow. Users receive a temporary password via email and must set a permanent password on first login. Email delivery uses Amazon SES (Cognito's default sender has a 50 emails/day cap and high spam classification rate). SES must be configured in us-east-1, us-west-2, or eu-west-1. Cognito callback and logout URLs are set to the CloudFront domain.

**File listing:** `GET /api/v1/uploads` protected by Cognito JWT authorizer; list-uploads Lambda returns confirmed uploads with presigned S3 GET download URLs (1-hour expiry).

**Authenticated download:** the download link in Slack notifications points to a URL that prompts Cognito login if unauthenticated and then starts the download immediately.

**Custom domain:** accessible at `admin.vibe-share.codespeak.dev`. ACM certificate created in us-east-1 (required by CloudFront regardless of the stack's eu-north-1 deployment region), covering `admin.vibe-share.codespeak.dev`, with DNS validation. CDK stack imports the certificate ARN and attaches it to the CloudFront distribution as an alternate domain name.

**Internal uploads management:** user emails can be flagged as internal. Internal emails are persisted in an `InternalEmailsTable` in DynamoDB. The main upload table hides internal emails by default; a checkbox toggle shows or hides them. A per-row button on the main table marks an email as internal directly. A dedicated management page allows adding emails to the internal list. The show-internal-uploads checkbox state is saved to and restored from `localStorage`. Internal upload rows display a 🛠️ wrench emoji prepended to the filename with grey background (`#f0f0f0`, hover `#e8e8e8`). Internal user status is determined by querying `InternalEmailsTable` at notification time with no caching.

**GitHub URL normalisation:** all common GitHub URL formats — HTTPS with/without `.git` suffix, SSH (`git@github.com:user/repo.git`), `git://` protocol, URLs with trailing subdirectory paths — are parsed to a shortened `user/repo` display label rendered as a clickable hyperlink to `https://github.com/user/repo`.

**UI:**
- User email address is displayed in the UI.
- Repository URL is displayed in shortened `user/repo` hyperlink format.
- Main table columns include NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID.
- CONFIRMED column shows a dash when no confirmation timestamp is present.
- SIZE is displayed in human-readable format (e.g., 2 MB).
- Timestamps are in ISO 8601 format.
- Internal uploads show 🛠️ before the filename with grey row styling.
- A checkbox on the main table toggles visibility of internal emails; a per-row button marks an email as internal.
- A dedicated internal emails management page exists.

---

### Ops Scripts

Scripts in `scripts/` (on PATH via direnv):

**`status.sh`** — queries DynamoDB and prints a formatted table of all upload records with columns: NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. A header line reads `=== DynamoDB Uploads ===` followed by a total count. Lambda logs are fetched only with `--logs` flag.

**`clear-uploads.sh`** — displays the count of items to be deleted, requires the user to type the exact phrase `delete all` before proceeding, then deletes all DynamoDB records and all S3 objects in a single run.

**`cdk-deploy`** — invokes CDK deploy with auto-approve flag included automatically.

**`create-user`** — accepts an email argument, resolves the Cognito User Pool ID from CDK stack outputs, and invokes `cognito admin-create-user` via AWS CLI with username and temporary/permanent password support.

---

### Cursor Session Support

**Storage research and implementation**

Cursor stores agent sessions in SQLite `store.db` files within workspace-specific directories under `~/Library/Application Support/Cursor/User/workspaceStorage/`. Session data uses content-addressed binary blobs; plan references may be stored in binary protobuf format rather than JSON, making text-based LIKE matching unreliable. The global `state.vscdb` contains a `composer.planRegistry` that maps each plan to its originating `composerId`, enabling discovery of plans created via the Cursor IDE UI that have no cross-references in session blob data.

**Implementation approach: database copying**

`store.db` SQLite files are copied wholesale into the project archive rather than extracting individual JSON blobs, chosen for maximum compatibility across user environments.

**Plan discovery uses a dual strategy** — both registry-based lookup and blob-scanning always run, with results merged:
- `discoverPlansFromRegistry` queries `composer.planRegistry` in global `state.vscdb`, matches by `composerId`, and resolves the `composerId`-to-`agentId` mapping via `composer.composerData` entries in `cursorDiskKV` or workspace-level composer data.
- Blob-scanning searches session content for plan path references.

**Archive contents for Cursor projects:**
- Workspace `store.db` files
- Workspace `workspace.json`
- A filtered `state.vscdb` extract containing only `composer.planRegistry` from global state, `composer.composerData` from workspace state, and `composerData UUID` entries from `cursorDiskKV` (extracted using `sqlite3` CLI with `-readonly` flag, target size ~1.8 MB)
- Plan `.md` files discovered via registry
- A `discovery-manifest.json` with intermediate findings (hashes, slugs, composerIds, plan matches, original paths, algorithms)

**Workspace discovery:**
- `findWorkspaceStorageDir` scans `workspaceStorage/*/workspace.json` to match workspace by path.
- `getWorkspaceComposerIds` reads workspace `state.vscdb` to extract all composerIds.
- Composer sessions from `~/Library/Application Support/Cursor/User/workspaceStorage/` state.vscdb files are included alongside chat directory sessions, with deduplication by seen identifiers.
- Orphaned chat directories (no `workspace.json`) are recovered by extracting workspace paths embedded in `store.db` blob data using a regex pattern (path followed by newline or quote), validated for directory existence.

**Archive structure:** replicates the `.cursor` subtree structure under `sessions/.cursor/`.

**Non-goals:**
- Human-readable JSONL extraction of Cursor database contents
- Text-only LIKE matching as the sole plan discovery strategy

---

### Session Extraction Script (Claude Code)

A self-contained executable script saved to disk that, when run, reads all Claude Code session log files for the current project from `~/.claude`, extracts the following event types: user messages, `AskUserQuestion` tool prompts, user answers to those questions, `ExitPlanMode` requests with plan approval or rejection results, TODO creation and status change events, and Claude's implementation-completion messages. It writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters, and additionally writes one per-session file per session into `intent/sessions/`, each containing only that session's extracted items separated by `==========` delimiters.

The script must be self-contained and independently executable so extraction can be repeated without re-specification.

---

### Console UI Gratitude Animation

The CLI terminal UI displays a progression of gratitude-themed pseudographic frames in the bottom-left corner of the screen during checkbox and select prompts. Confirm prompts do not include the animation.

**Frames** cycle continuously (wrapping from frame 3 back to frame 0) on each navigation keypress (arrow keys, space, numbers). The animation disappears on Enter confirmation, showing the normal completion summary instead. All four frames have identical height and display-column width:
- Frame 0: 💛 hearts diamond pattern with `THANK YOU!` message
- Frame 1: 🌟 star border with `YOU ARE AMAZING!` message
- Frame 2: 🎉🙏🎊 celebration theme with `SO MUCH GRATITUDE!` message
- Frame 3: 🏆🔥 trophy theme with `YOU'RE THE BEST!` message

Frame lines are prepended to the left of prompt output lines; prompt content is shifted right by the frame column width. The frame's last line is vertically aligned with the last line of prompt output.

**Emoji width handling:** display width is computed separately, counting emoji as 2 terminal columns and stripping zero-width joiners and variation selectors. All padding and normalisation operations use display width rather than string length.

**Non-goals:**
- Animated animal character (goose or duck) in the console UI

---

### Session Viewer (Next.js)

A Next.js application in the `session-viewer/` directory that imports session discovery logic from the parent project's compiled `dist/` output rather than duplicating it.

**Project list**

Sessions are grouped by project. The project list loads from a SQLite cache (populated on first load, served on repeat loads within a 30-second TTL) so both first and repeat loads are fast. Each project card shows a session count pill in the top-right; no agent badge is rendered until multiple agent types are supported.

**Session list**

Sessions are displayed in a single-column list sorted by timestamp of the last message, most recently active first. Only Claude Code agent sessions are shown on the project page; filtering is performed at the discovery level.

Each session card shows:
- AI-generated title when an `ai-title` entry is present; otherwise falls back to first lines of user messages, user message count, and agent summary content
- A purple `plan` badge when the session references plan files, rendered as a navigation link to the plan message
- Message count and user prompt count in format `XX msgs (YY prompts)` (tool-result-only entries excluded from prompt count)
- Start timestamp, end timestamp, and duration in hours and minutes, all in 24-hour format
- Same-day sessions: shared date displayed once with both times shown; multi-day same-year: month/day for both endpoints; cross-year: full date including year on both endpoints; identical start/end: single timestamp with no arrow or duration
- Year included in date only when the session year differs from the current year

A shared `SessionStats` component is used by both session cards and the session detail page.

**Session detail page**

Loads JSONL entries via a paginated API serving from SQLite rather than parsing JSONL on each request. Metadata (title, plan indicator, agent name, session ID, message count, prompt count, start/end date-time, duration, file size) is retrieved via a single-file read for the requested session only, not a project-wide scan. Session discovery data and metadata are fetched in parallel.

**Entry cards**

All card types except pure user messages are collapsed by default. Collapsed cards show minimal header information only. Expanded cards show full content. Type badge renders exactly once per message in the `EntryCard` header; individual message renderers do not repeat badges or labels.

Special card handling:
- `ai-title` cards display title text in the header with no body
- `FileSnapshot` with no tracked files displays that state in the header with no body
- `FileSnapshot` with tracked files renders an expandable file list in the body
- Consecutive non-user messages between user turns are hidden behind an ellipsis indicator showing the count of hidden messages; clicking expands them
- User messages where all content blocks are `tool_result` type are classified as a distinct `tool-result` subtype, collapsed by default, and display an amber `tool result` badge
- When a significant proportion of messages are hidden, the system proactively loads additional messages to maintain adequate visible content

**Plan file rendering**

When tool-use blocks for Write or Edit operations reference files matching `~/.claude/plans/*.md`, the file's markdown content is rendered as formatted markdown with the plan filename as a human-readable header. Read tool-result blocks referencing plan files similarly render formatted markdown. Markdown tables render as formatted HTML tables (remark-gfm). Plan-related entry cards display a purple badge; clicking the badge expands the entry and navigates to the plan content via URL hash. Plan detection identifies actual `tool_use` blocks of type Write, Read, or Edit targeting plan paths, excluding textual mentions in `tool_result` content.

**Hash navigation**

URL hash is parsed synchronously in the `useState` initialiser (not in a post-mount effect) so highlighted entry state is available on first render. When a hash targets an entry, that entry is extracted from collapsed groups and rendered as a standalone card between surrounding collapsed groups. Entry cards auto-expand when targeted by a URL hash. Scroll to the target element is deferred using nested `requestAnimationFrame` callbacks to wait for both React's commit phase and the browser's paint phase. A `hashchange` event listener handles both initial page load and same-page navigation. On the session detail page, plan badge navigation uses a client component button that assigns directly to `window.location.hash` to fire the native `hashchange` event; on the project page, plan badges use plain anchor tags since full-page navigation naturally fires `hashchange`.

**Thinking blocks:** tagged with a secondary label; collapsed state shows a content preview.

**IDE context tags (`<ide_*>`):** rendered as grey clickable badge elements with monospace font displaying the tag name in angle bracket notation (e.g., `<ide_opened_file>`). Clicking toggles an expanded scrollable panel with full tag content. Long paths are truncated from the beginning with `...` prefix; paths under the current working directory replace the CWD prefix with `$CWD`. The `projectPath` prop is threaded from server component through the rendering tree; `cwd` is derived from `projectPath` with fallback to `entry.raw.cwd`.

**Tool call and result headers:**
- Tool names render as amber badges in entry card headers for both assistant entries and tool-result entries
- Bash tool call headers include a badge with the command string, trailing-truncated to preserve the command start
- File read/write headers show the file path with leading ellipsis truncation
- Grep, glob, and other filesystem tool results show the relevant path with leading ellipsis truncation
- Tool result headers reference the originating tool call via a `tool-use-id` lookup map

**Timestamps** display both date and time and are positioned at the right-most end of the header row.

**SQLite cache schema** supports JSON field-wise indexing; includes session metadata, session entries with `cwd`, `type`, and `timestamp` columns (with index on `cwd`), and entry tags. Sessions API serves paginated results from SQLite.

---

### Redesigned CLI UI (Ink/React)

The CLI uses Ink (React for terminal) as the TUI framework.

**Application entry:** always opens to the project list screen. If the current working directory is under a listed project, that project is marked with `(current dir)` and sorted to the top of the list.

**Project list screen**

Greets the user by first name from git config. Lists all discovered projects sorted by total session count descending. Global project discovery merges worktree entries for the same git repository into a single entry with combined agent lists and aggregated session counts. Projects whose paths contain hyphens ambiguous under lossy decode are still discoverable. Each subfolder with its own `.git` root appears as a distinct project entry. The list is scrollable when entries exceed visible terminal height. After one or more projects have been shared, the heading reads `Share another project:`.

**Project share screen**

Displays: project path, repo URL if present, agents with session counts per agent, worktree count, session count across all worktrees, file count and LOC by programming language (using file extension to language map), total commit count across all branches, untracked file count, and tracked-but-uncommitted file count. Dependency and environment directories (`node_modules`, `venv`, etc.) and gitignored files are excluded from file and LOC counts. Pressing Escape navigates to the project list.

**Review before sharing screen**

Tabs along the top: one Sessions tab, one Code tab, one git tab. Tab navigation and content list navigation are keyboard-driven via a focus zone system cycling through three zones: tabs, content, and action buttons. Only the active focus zone processes keyboard input at any time (enforced via `isActive` prop on `useInput` hooks) to prevent concurrent handler conflicts. `TabBar` does not handle Tab key internally — Tab is handled at the parent screen level. Tab key cycles focus between zones; Shift+Enter triggers the primary action; Escape is the back action.

When focus is in the tabs zone, pressing down moves focus to the content zone. When focus is in the content zone, navigating past the top moves focus to the tabs zone; navigating past the bottom moves focus to the action buttons zone.

The Sessions tab replaces per-agent tabs. When the `SESSION_PREVIEW_ENABLED` feature flag (`VIBE_SHARING_SESSION_PREVIEW` env var, default false) is disabled, the Sessions tab shows a static read-only list of agent names and session counts. When enabled, it renders an interactive agent list drilling into session preview. The Sessions tab is only shown if the project has agents. The agents section on the share-project screen is always visible regardless of the flag.

The Code tab shows the current working tree state. Shared files are git-tracked plus user-selected untracked files; Not Shared files are gitignored and files in excluded directories. Not Shared files and folders are labelled explicitly; Not Shared folders cannot be expanded. Pressing Enter on a file previews its content. Pressing Escape while previewing returns to the Files tab, not to the Share Project screen.

The git tab shows branches and commits per branch.

A legend at the bottom of the review screen indicates Tab cycles focus zones and available keyboard shortcuts. The Share Project screen shows a legend with Shift+Enter for primary action and Esc for back.

**Consent screen**

Displays CodeSpeak data use terms: permission to study the project, no commercial software built from the code, retraction contact at `support@codespeak.dev`. Enter confirms; Escape is the secondary dismissive action. Enter confirmation is visually prominent; Escape is visually secondary.

**Post-share screen**

Thank You box with `Share Another` as the default highlighted action and `Quit` as the visually de-emphasised secondary action. `To request deletion` message appears as a footnote outside the Thank You box.

**Progress indicators** are displayed during long-running operations.

**Session display:** Claude session first messages have `<ide_*>` tags stripped before display. Sessions with empty names display a fallback label. Opening a session displays its messages. When a session directory is found but contains no parseable sessions, all found sessions are still displayed.

**`ActionBar` component** replaces letter-key shortcuts. The Back button indicates Escape triggers it; the primary action button indicates Shift+Enter triggers it.

**Non-goals:**
- Agent-specific parsing of manually entered session directory paths
- Git bundle or full history inclusion in the Code tab shared archive view

---

### Vibe Coder Personality Test

A personality typing system that humorously characterises developer personalities based on measurable signals from code, git history, and Claude Code agent sessions.

**Scope:** analyses all Claude Code projects on the machine by default; specific projects can be excluded before running. Only Claude Code agent sessions are supported. Approximately 8 named archetypes are defined rather than a full 32-combination set.

**Structure:** 5 personality traits that are amusing, at least some potentially useful, and all reliably detectable from the available signals. Traits are combined into named personality types using a system analogous to MBTI. LLMs may be used as part of the detection mechanism.

**Plan file location:** `intent/vibe-personality/`.

**Non-goals:**
- Support for non-Claude coding agents (Cursor, Cline) in the first version
- Full 32-archetype named type system in the initial implementation

---

### Claude Code Permission Event Observability

Research and documentation of what permission-related signals are available in Claude Code JSONL session logs, persisted to `intent/vibe-personality/permissions.md`.

**Available signals:**
- Permission prompt events when Claude requests to run a command or edit a file
- Permission mode switch events (plan, auto, edit-automatically, bypass-permissions modes) recorded as `permissionMode` field changes
- User response type distinguishable via `tool_result` content: agreement, decline (`is_error` set), or alternative instructions

**Architectural limitation:** no explicit field (such as `autoApproved`) indicates whether a permission prompt was shown for a given tool call. Auto-approval can only be approximated by combining the `permissionMode` field with `permissions.allow` patterns from `settings.json`.

**Non-goals:**
- Modification of the Claude Code client to add an `autoApproved` field or equivalent

---

### Plugin / Slash Command (Claude Code Plugin)

A Claude Code plugin providing a `/vibe-share` slash command. Installed under the `codespeak-dev` organisation. Plugin file structure uses command markdown mechanics; the `REQUIREMENTS.md` plan file is copied to the `intent/` directory.

The plugin script operates in three modes:
- **Scan mode** — audits existing project state and reports counts of session transcripts, plan files, and debug files
- **Build mode** — collects session transcripts, plan files referenced in transcripts (via grep), debug files referenced in transcripts (via grep, pattern `.claude/debug/<uuid>.txt`), and packages all into a zip archive with subdirectories; outputs a build report with session count, plan count, and debug count
- **Review mode** — previews the contents of the packaged zip archive

Session files are bundled from the full `.claude/projects/<project-id>/` folder including all subagent session files. Plan files go into `claude-plans/`; debug files into `claude-debug/`. Only files explicitly referenced in session transcripts are collected; orphaned files are excluded. The archive generation retains excluded directories as entries in the output rather than removing them entirely. The requirements document (plan file) is copied to `intent/` for organised documentation storage.

---

### GitHub Repository

The project is hosted as `codespeak-dev/vibe-sharing` on GitHub, initialised from the local working directory using the GitHub CLI.

---

## Design Decisions

- **SST v3 as infrastructure tool** — rejected in favour of AWS CDK because SST is not officially AWS-supported.
- **AWS Chatbot for Slack notifications** — rejected in favour of a custom Slack webhook Lambda to retain message formatting control and avoid an AWS-managed service dependency with manual OAuth console setup.
- **Storing Slack webhook URL in a config file** — rejected in favour of SSM Parameter Store to avoid exposing sensitive credentials in source code.
- **Auth0 for authentication** — considered as an external provider; not selected in favour of AWS-native Cognito.
- **Cloudflare Access with email OTP** — required DNS migration to Cloudflare; not selected. Shared password via CloudFront and Lambda@Edge was the simplest option but does not support per-user access control; not selected.
- **Storing alarm notification email in SSM** — rejected because email is non-sensitive plain configuration; storing in a checked-in config file provides audit trail and code-review visibility without SSM lookup overhead.
- **Using `pointInTimeRecovery` property on DynamoDB `TableOptions`** — rejected because `aws-cdk-lib` deprecated it in favour of `pointInTimeRecoverySpecification`.
- **S3 lifecycle auto-delete after 90 days** — rejected; all uploaded data must be retained indefinitely.
- **`npx cdk bootstrap` from the backend directory without an explicit environment argument** — fails because the directory lacks `cdk.json` and CDK cannot resolve the target AWS environment; must be run from a directory with `cdk.json` or with an explicit `aws://ACCOUNT_ID/REGION` argument.
- **`s3:HeadObject` IAM action for HeadObject operations** — rejected because it is not a valid IAM action; the correct permission is `s3:GetObject`.
- **Silent catch block in confirm Lambda** — replaced with a logging catch block because it masked `AccessDenied` errors as `File not uploaded yet`, hiding the true cause.
- **`https://codespeak.dev/share/{uploadId}` as share URL format** — rejected because no backend exists for that route, the S3 bucket blocks all public access, and no web frontend exists to serve that path; the confirm endpoint was updated to not return a share URL.
- **Download Lambda at `/api/v1/download/{uploadId}` returning a 302 redirect** — proposed but not implemented; rejected in favour of returning the presigned URL directly from the confirm endpoint (subsequently the confirm endpoint was changed to return no URL at all).
- **Wildcard subdomain pattern `https://*.codespeak.dev` in API Gateway HTTP API v2 `allowOrigins`** — deployed and rejected at deployment time; API Gateway V2 does not permit wildcard characters in `allowOrigins`, causing `BadRequestException` and full stack rollback.
- **Single unified CORS list for both API Gateway and S3** — rejected because API Gateway v2 does not support wildcard syntax while S3 does, requiring two separate lists.
- **Setting `AWS_PROFILE` as a system-wide environment variable in `~/.zshrc`** — rejected because it applies globally across all projects rather than being scoped to this project; replaced by direnv-based `.envrc`.
- **Adding a `profile` field to `cdk.json`** — rejected because it scopes the profile to CDK commands only and does not apply to raw AWS CLI commands such as `aws ssm put-parameter`.
- **Presigned S3 GET URL with 7-day expiry returned from the confirm endpoint** — implemented but subsequently removed; the deployed backend never provided a `shareUrl` and all client-side handling was dead code.
- **Including the raw `.git` directory in the archive** — rejected because git repositories with long history make the `.git` directory very large; replaced by git bundle.
- **Producing only a text-based file tree without actual file contents** — rejected; actual file copies are included subject to secret filtering.
- **Removing excluded directories entirely from the archive output** — rejected; directory entries are preserved in the archive while their contents are excluded.
- **Placing session JSONL files under `sessions/claude-code/` with referenced files in `sessions/claude-code/referenced/`** — rejected in favour of replicating the actual `.claude` folder structure directly under `sessions/.claude/`.
- **`initialCursor` prop on `ScrollableList` to pre-position the cursor on the current project** — replaced by sorting the current project to index 0, making `initialCursor` redundant and subsequently removed.
- **`useMemo` for grouped entry segments computation placed after early return statements in `SessionClient`** — caused a React Rules of Hooks violation; relocated to before all early returns.
- **Reading `window.location.hash` in a `useEffect` after mount to initialise `highlightEntry`** — rejected because `highlightEntry` was null when segments were first computed with real entries, causing the targeted entry to remain inside collapsed groups; replaced by reading the hash synchronously in the `useState` initialiser.
- **Next.js `Link` component for plan badge navigation on the session detail page** — rejected because Link performs client-side navigation without remounting the session component, so hash effects never re-ran; replaced by a client component button assigning directly to `window.location.hash`.
- **Plain anchor tags for plan badge navigation on the session detail page** — rejected because Next.js intercepts anchor clicks for client-side routing, preventing the native `hashchange` event from firing on same-page navigation.
- **Three separate JSONL scan passes for titles, plans, and prompt counts** — consolidated into a single-pass scan to eliminate redundant file I/O.
- **Session detail page calling a project-wide scan to retrieve single-session metadata** — rejected; replaced by a single-file read returning message count, creation timestamp, modification timestamp, and file size.
- **FTS5 full-text search index for session entry queries** — rejected because FTS5 alone is insufficient for JSON field-wise querying.
- **Text-based LIKE matching on session blob content as the sole plan discovery strategy for Cursor** — rejected because plan references are stored in binary protobuf format, causing zero matches; replaced by a dual strategy combining registry-based lookup via `composer.planRegistry` and blob-scanning.
- **Extracting JSON blobs from Cursor SQLite databases as human-readable JSONL** — not chosen; store.db files are copied wholesale for maximum compatibility.
- **Per-agent tabs in the review screen** — replaced with a single unified Sessions tab to reduce UI clutter.
- **Hiding the agents section on the share-project screen behind the `SESSION_PREVIEW_ENABLED` flag** — rejected in favour of always showing it regardless of flag state.
- **Full 32-archetype named type system** — rejected in favour of approximately 8 key archetypes to reduce upfront design complexity.
- **Timing heuristic using tool_use/tool_result timestamp delta to infer auto-approval** — rejected because execution time noise makes inference unreliable.
- **`promptId` field as a signal for auto-approval correlation** — investigated and rejected because it did not correlate with auto-approval behaviour.
- **Hardcoded raw API Gateway URL as the CLI default** — rejected because the URL is fragile and changes if the AWS stack is ever recreated; replaced by the custom domain `vibe-share.codespeak.dev`.
- **ACM certificate provisioned for `api.codespeak.dev`** — rejected because the correct subdomain is `vibe-share.codespeak.dev`; the pending certificate was cancelled and the stack redeployed.
- **Agent badge on `ProjectCard`** — deferred until multiple agent types are supported; co-presence with the session count pill creates two visually similar badge elements without differentiation value.

---

## Known Issues

- Some Claude sessions display only a UUID on the Review screen.
- Gemini CLI sessions directory reports sessions found but none appear in the Review screen.
- Up navigation in the main content list on the review screen is broken.
- Opening a Cursor session in Review for the `khariton-style` project at `/Users/abreslav/codespeak/playground/khariton-style` shows `No messages found in this session` despite the session containing messages.
- 90.6% of chat hashes in Cursor's chats storage do not match current workspaceStorage entries, likely due to stale records from deleted workspaces, a migration path that did not update references, or parallel ID schemes that evolved independently; root cause unconfirmed.
- Slack messages for uploads from the same upload are still being grouped into a single thread instead of each upload generating its own independent thread.