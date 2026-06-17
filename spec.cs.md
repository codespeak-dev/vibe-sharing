# CodeSpeak Vibe Share Specification

## Overview

CodeSpeak Vibe Share is a tool for collecting and sharing vibe-coded projects together with the AI agent sessions used to build them. It packages filtered copies of project files (excluding secrets), full session history including subagent sessions, referenced plan files, and debug files into a portable archive that can be uploaded to a secure backend or saved locally. The system includes a CLI tool users run from their project directory, a serverless AWS backend for receiving uploads, a web UI for browsing uploaded archives, and a session viewer application for inspecting session history in depth. The goal is to let developers share complete project context with minimal friction and no technical setup.

## Foundation

**Stack:** TypeScript, Node.js 22.x, React (via ink for CLI TUI and Next.js for session viewer), AWS CDK, AWS Lambda, API Gateway HTTP API v2, DynamoDB, S3, SNS, CloudWatch, Amazon Cognito, Amazon SES, SQLite (session viewer cache), esbuild (Lambda bundling).

**Architecture:**
- *Deployment topology:* Serverless — Lambda functions behind API Gateway handle all backend operations; no persistent compute.
- *Communication pattern:* CLI uploads via presigned S3 PUT URLs issued by a Lambda presign endpoint; CLI confirms upload via a separate confirm Lambda endpoint; Slack notifications are fire-and-forget SNS publishes from Lambda.
- *Data model:* DynamoDB stores upload metadata (uploadId, status, timestamp, IP, email, name, repo URL); S3 stores zip archives; SQLite stores session viewer cache (project discovery, session metadata, session entries with indexed cwd column).
- *Authentication:* Amazon Cognito user pool with hosted domain for the web UI; token-based invite-only access optionally supported on the API.

**Cross-cutting constraints:**
- All Lambda functions use Node.js 22.x runtime.
- Lambda functions are bundled via esbuild within CDK rather than a separate build step.
- Backend uses CommonJS module format.
- IAM permissions follow least-privilege: presign Lambda has only `dynamodb:PutItem`; confirm Lambda has only `dynamodb:GetItem` and `dynamodb:UpdateItem`; confirm Lambda has `s3:GetObject` for HeadObject checks.
- Slack webhook URL stored as SSM SecureString at `/vibe-share/slack-webhook-url`; never in source code or config files.
- Telemetry payloads must be sanitized before transmission — no personally identifiable or sensitive content.
- CORS configuration is split into two separate lists: `corsAllowedOrigins` for API Gateway (explicit domains only — `codespeak.dev`, `app.codespeak.dev`, `www.codespeak.dev`) and `s3CorsAllowedOrigins` for S3 (wildcard-capable — `codespeak.dev`, `*.codespeak.dev`), because API Gateway HTTP API v2 does not permit wildcard characters in `allowOrigins` values while S3 does.
- Secrets and credentials belonging to the tool operator must never be present on the user's machine.
- The tool must be robust against exceptions — failures must never present as raw stack traces or silent exits.

## Features

### CLI Tool

The CLI tool is distributed as `@codespeak/vibe-share` on npm, invocable via `npx @codespeak/vibe-share` with no prior installation or configuration. The bin command name is `codespeak-vibe-share` for global installs. The `package.json` restricts published files to `dist/` only, includes a `prepublishOnly` script that runs TypeScript compilation, and is published with `--access public`.

**Entry point and startup:**
- On startup, reads email and username from git config; prompts the user only when git config values are absent or unset.
- Generates a correlation/request ID that flows through all steps of the upload journey for end-to-end tracing.
- Writes a local diagnostic log file on every run with timestamped debug output that users can share when reporting issues.
- Displays a clear privacy notice before any files are shared. The sharing consent prompt defaults to `Y` (enabled by default); the prompt displays uppercase `Y` to indicate the active default.
- Automatically sends error telemetry to the backend on failure, capturing error type, failure step, OS version, Node version, and sanitized error message. No explicit user opt-in is required.

**Project detection:**
- Detects whether the current directory is under git version control.
- Correctly identifies the project root when invoked from any subfolder, including projects without a `.git` directory. When git-based root detection fails and the current working directory is a subfolder, the tool must not silently use the wrong encoded path for session lookup.
- When the project is under git, produces: a text file with `git status` output; a text file listing all files and directories recursively; a text file with unstaged changes (`git diff`); a text file with all uncommitted changes versus HEAD (`git diff HEAD`); a directory named `untracked/` containing untracked files that are not gitignored; and a git bundle including all refs (`--all`).
- Git bundle creation failures (empty repository, shallow clone, corrupted refs) are caught and represented as `null` rather than throwing exceptions. For empty git repos, all files are captured as untracked using `git ls-files --others --exclude-standard` and archived under `project/untracked/`. For bundle failures, tracked file paths appear in `file-listing.txt` and untracked files are included if selected.
- When no git remotes are configured, the repo URL prompt is skipped entirely.
- For non-git directories, walks the directory using exclude patterns (node_modules, venv, .env.local, etc.) without invoking git bundle code. The user can customise the exclusion list.
- Archive size estimation accounts for all content: session data and project files. For git repos, sums text output sizes, git bundle file size, and untracked file sizes. For non-git repos, sums all project file sizes.

**Session discovery:**
- Locates Claude Code session directories at `~/.claude/projects/<derived-dir-name>`, scanning non-indexed JSONL files in addition to the sessions index to return all sessions. Project filtering reads the working directory only from user-type messages.
- Supports session discovery for Codex, Gemini, and Cursor (chat directory sessions plus Composer sessions from workspace `state.vscdb`). Cursor Composer sessions already discovered via chat directory are deduplicated.
- Discovers sessions across all git worktrees associated with the same repository, not just the current working directory. Branch information is read from each worktree's `HEAD` file in `.git/worktrees/<name>/HEAD` rather than by executing git commands. Worktree discovery works on archived repos without requiring git command availability.
- When no supported agent session is found, offers the user a file system browser to locate session files manually.
- When manually entered session directories are provided for an unknown agent, all files from those directories are included as-is without agent-specific parsing.
- When a session directory is found but contains no parseable sessions, all found sessions are still displayed.

**Packaging and archive:**
- Bundles the entire `.claude/projects/<project-id>` folder including all subagent session files and `tool-results/` directories.
- Scans all session files for references to plan files under `.claude/plans/` and debug files under `.claude/debug/<uuid>.txt`; copies only referenced files (not orphaned or unreferenced files). Reference detection uses grep against session transcript content.
- Archive `.claude` subdirectory replicates the structure of the local `.claude` folder: session project files under `.claude/projects/<encoded-path>/`; plan files under `.claude/plans/`; debug files under `.claude/debug/`.
- Archive filename uses the repository name extracted from the git remote URL (supporting SSH, HTTPS with and without `.git` suffix), stripping any `.git` suffix. Falls back to project folder name when no remote is available. Format: `<reponame>-<timestamp>.zip`. No `vibe-share` prefix or infix in the filename.
- Archive filename construction logic is deduplicated into a single variable.
- Secret redaction is applied before packaging: secret files (`.env`, key files) are excluded; gitignored files are excluded; sensitive keys in session transcripts are masked.
- The privacy messaging displayed early in the script output must include a `(best effort)` qualifier.
- Excluded directories are retained as entries in the archive output rather than removed entirely; excluded directory handling preserves directory entries while excluding their contents.
- Falls back to producing a local zip file when the backend is unavailable or disabled.
- After upload, no download URL is shown in the success output. The confirm endpoint does not return a `shareUrl` field and the CLI does not display one.

**Upload flow:**
- Checks backend availability via a health endpoint before proceeding; falls back to local zip save if unreachable.
- Backend API base URL defaults to `https://vibe-share.codespeak.dev`. Overridable at runtime via `VIBE_SHARING_API_URL` environment variable.
- Repo URL is auto-detected from git remote and included automatically without prompting. Optional metadata fields (email, name) do not block uploads.
- Upload file size is capped at 5 GB.
- On upload failure, displays which step failed (e.g., `confirm step`) along with recovery suggestions including `--output` flag and `--verbose` flag.
- With `--verbose` flag, displays the full error cause chain including HTTP status code and response body. Verbose details are opt-in to keep happy-path output clean; `--verbose` is mentioned in the base error message.
- Progress is reported during zip creation and upload.

**Platform support:** macOS, Linux, and Windows, without platform-specific installation procedures.

### Gratitude Animation (Console UI)

The console UI displays a progression of gratitude-themed pseudographic frames alongside checkbox and select prompts only; confirm prompts do not include the animation.

Frames cycle continuously (wrapping from frame 3 back to frame 0) on each navigation keypress (arrow keys, space, numbers) in checkbox and select prompts. The animation disappears on Enter confirmation, showing the normal completion summary instead.

The progression consists of exactly 4 frames, all with identical height and display-column width:
- Frame 0: 💛 hearts diamond pattern with `THANK YOU!` message
- Frame 1: 🌟 star border with `YOU ARE AMAZING!` message
- Frame 2: 🎉🙏🎊 celebration theme with `SO MUCH GRATITUDE!` message
- Frame 3: 🏆🔥 trophy theme with `YOU'RE THE BEST!` message

Frames are rendered to the left of prompt output lines, with prompt content shifted right by the frame column width. The frame's last line is vertically aligned with the last line of prompt output.

Display width calculation treats emoji as 2 terminal columns and strips zero-width joiners and variation selectors. All padding and normalization use display width rather than string length. The frame column width constant is computed from display width rather than string length.

### AWS Backend

**Infrastructure (CDK):**
- Three Lambda functions: presign (validates request, generates S3 PUT URL), confirm (verifies S3 object exists, marks upload confirmed), health (returns status ok).
- S3 bucket retains all uploaded files indefinitely with no lifecycle expiry or automatic deletion.
- DynamoDB table storing: `uploadId`, `status`, `timestamp`, `IP address`, `email`, `name`, `repo URL`. Point-in-time recovery enabled using the `pointInTimeRecoverySpecification` API field (not the deprecated `pointInTimeRecovery` property) with 35-day restore window.
- API Gateway HTTP API with throttling; rate limiting at 10 requests per minute per IP.
- Presigned PUT URL includes a `ContentType: application/zip` condition enforced by AWS; S3 returns 403 if the uploader sends a mismatched `Content-Type`.
- CDK stack env configured with explicit AWS account and region values. Default deployment region is sourced from a configuration file.
- `cdk-deploy` script in `scripts/` directory invokes CDK deploy with auto-approve flag.
- An `.envrc` at the project root sets `AWS_PROFILE` to `default`; the `scripts/` directory is added to `PATH` via `.envrc` using direnv.
- `backend/README.md` documents setup, configuration, and usage including the requirement to create the SSM SecureString parameter `/vibe-share/slack-webhook-url` before deploying the Slack notification Lambda.

**Presign Lambda:**
- Accepts optional reporter payload: user email, user name, repo URL.
- Publishes a fire-and-forget notification to the upload events SNS topic including filename, size, IP, and user info. Publish does not block the API response.

**Confirm Lambda:**
- Uses `s3:GetObject` IAM permission for HeadObject checks. S3 errors are logged, not silently swallowed.
- Transitions DynamoDB records out of pending status upon successful confirmation.
- Publishes to the upload events SNS topic when upload is successfully confirmed (includes filename, size, share URL) and when upload fails due to file missing from S3.
- Both idempotent and normal confirm code paths generate the presigned URL from the upload record's S3 key.
- Does not return a `shareUrl` field and does not presign a share URL.

**Alerting:**
- CloudWatch alarms trigger on: Lambda errors exceeding 5 in 5 minutes; API 4xx errors exceeding 50; API 5xx errors exceeding 5.
- All alarms have both `addAlarmAction` and `addOkAction` so recovery events generate notifications.
- SNS alarms topic delivers to `alarms@codespeak.dev` email and to the Slack webhook Lambda simultaneously.
- CORS origins, alarm email address, and SSM parameter name are defined in a shared config file (`backend/lib/config.ts`).

**Upload events SNS topic:**
- A separate SNS topic exclusively for upload events, distinct from the infrastructure alarms SNS topic.
- Has no email subscription; delivers via Slack webhook Lambda only.
- Both presign and confirm Lambdas are granted IAM publish permissions and receive the topic ARN via environment variable.
- A shared helper function is used by both Lambdas to publish upload event notifications.

**Slack webhook Lambda:**
- Subscribed to both the alarms SNS topic and the upload events SNS topic.
- Retrieves the webhook URL from SSM Parameter Store at runtime. Caches the value with a 5-minute TTL; invalidates the cache immediately upon receiving an error response from Slack.
- Throws on Slack delivery failure so SNS treats the delivery as failed and can retry (up to 2 additional attempts).
- Logs a warning and continues gracefully if the SSM SecureString parameter is absent, rather than throwing a fatal error that would disrupt email alerting.
- Top-level Slack message is human-readable plain text; thread reply contains full structured data as pretty-printed JSON wrapped in triple-backtick code fences.
- CloudWatch alarm notifications follow the same structure: human-readable top-level message with formatted JSON in a thread reply.
- Each file upload event generates its own independent Slack thread; upload notifications are not grouped into a shared thread.
- The initial upload notification includes user name, email, and repo URL. Detail updates and subsequent notifications are posted as threaded replies.
- When processing is complete, a download link is appended to the top-level Slack message pointing to the admin web UI, which requires Cognito authentication before download begins.
- Top-level messages for uploads from internal users are prefixed with the `:codespeak:` emoji. Internal user status is determined by querying `InternalEmailsTable` at notification time with no caching. The Slack Lambda has read access to `InternalEmailsTable` and receives its table name via environment variable.
- Thread creation between presign and confirm handlers uses atomic DynamoDB conditional writes so whichever handler arrives first deterministically claims thread creation while the other polls until completion.

**Telemetry endpoint:**
- Receives CLI error payloads and stores or forwards error data for developer review.

**Custom domain:**
- ACM SSL certificate provisioned for `vibe-share.codespeak.dev` with DNS validation. Certificate for the web UI admin domain (`admin.vibe-share.codespeak.dev`) must be in `us-east-1` for CloudFront compatibility.
- API Gateway custom domain mapped to `vibe-share.codespeak.dev`. DNS configured manually at the registrar (not via Route 53 automation).
- CDK outputs expose custom domain target and hosted zone ID.

### Web UI (Admin)

A serverless web interface for browsing and downloading uploaded files, served via CloudFront at `admin.vibe-share.codespeak.dev`.

**Authentication:**
- Amazon Cognito user pool with hosted domain for OAuth authentication.
- Self-signup enabled and restricted to `@codespeak.dev` email addresses via a pre-sign-up Lambda trigger that rejects other domains and auto-confirms/auto-verifies `@codespeak.dev` addresses.
- Email verification is required before an account is active; pre-sign-up Lambda does not auto-confirm or auto-verify, delegating to Cognito's built-in verification flow.
- Email delivery for verification and password recovery uses Amazon SES (not Cognito's default sender). SES must be configured in `us-east-1`, `us-west-2`, or `eu-west-1`.
- Users receive a temporary password via email and must set a permanent password on first login.
- Per-user access management via Cognito; users can be added/removed.

**File browsing:**
- `GET /api/v1/uploads` route protected by Cognito JWT authorizer.
- `list-uploads` Lambda scans DynamoDB for confirmed uploads and returns presigned download URLs with 1-hour expiry.

**Internal email management:**
- User emails can be flagged as internal. Internal email data is persisted in a database (`InternalEmailsTable`).
- Internal emails are filtered out from the main user table by default.
- A checkbox toggle shows or hides internal emails. The checkbox state is saved to `localStorage` when the filter is applied and restored from `localStorage` on page initialization.
- A button on each main table row marks that email as internal directly from the row.
- A dedicated page allows adding emails to the internal list.
- Internal upload rows display a 🛠️ wrench emoji prepended to the filename and are styled with grey background `#f0f0f0` and hover state `#e8e8e8`.

**GitHub URL normalization:**
- All recognized GitHub URL formats (HTTPS with/without `.git` suffix, SSH `git@github.com:`, `git://` protocol, URLs with trailing subdirectory paths) are normalized to a shortened `user/repo` display format.
- The `user/repo` label is rendered as a clickable hyperlink to `https://github.com/user/repo`.

**CDK stack outputs:** `ApiUrl`, `BucketName`, `CognitoClientId`, `CognitoDomain`, `CognitoUserPoolId`, `WebUiUrl`, `TableName`, `CustomDomainHostedZoneId`, `CustomDomainTarget`.

### Operator Scripts

- `status.sh`: queries DynamoDB and displays all upload records in a formatted table with columns in order: NAME, EMAIL, FILENAME, SIZE, STATUS, CREATED, CONFIRMED, REPO_URL, UPLOAD_ID. SIZE is human-readable (e.g., 2MB). Timestamps are ISO 8601. CONFIRMED shows `-` when absent. Lambda log fetching is opt-in via `--logs` flag. Header reads `=== DynamoDB Uploads ===` followed by total record count.
- `clear-uploads` script: displays count of items to be deleted, requires typing the exact phrase `delete all` as confirmation, then deletes all DynamoDB records and all S3 objects in a single execution.
- `cdk-deploy` script: invokes CDK deploy with auto-approve flag.
- User creation script: accepts an email argument, resolves Cognito User Pool ID from CDK stack outputs, invokes `admin-create-user` via AWS CLI.

### Session Extraction Script

A self-contained executable script saved to disk that, when run, reads all Claude session log files for the current project from `~/.claude`, extracts: user messages, AskUserQuestion tool prompts, user answers to those questions, ExitPlanMode requests with plan approval or rejection results, TODO creation and status change events, and Claude implementation-completion messages. Writes all extracted items chronologically to `intent/msg-and-answers.md` separated by `==========` delimiters. Also writes one per-session file per session into `intent/sessions/`, each containing that session's extracted items in chronological order separated by `==========` delimiters.

### Claude Code Plugin (vibe-share)

A Claude Code plugin invocable via slash command that packages project context into a zip archive.

**Modes:**
- *Scan mode:* audits existing project state and reports counts of session transcripts, plan files, and debug files.
- *Build mode:* collects session transcripts, plan files referenced in session transcripts via grep, and debug files referenced in session transcripts via grep; packages all collected files into a zip archive with `claude-plans/` and `claude-debug/` subdirectories; outputs a build report with session count, plan count, and debug count.
- *Review mode:* previews packaged contents of the zip archive.

Only debug files and plan files explicitly referenced in session transcripts are collected — orphaned or unreferenced files are excluded. Debug file path pattern for grep matching is `.claude/debug/<uuid>.txt`.

The plugin script does not contain special exclusions for the `.claude-plugin/` directory.

Archive creation uses built-in platform tools (such as `AskUserQuestion`) to present messages and collect user consent. A visually prominent, warm, reassuring message appears early in the script output noting that secrets are handled with care and including a `(best effort)` qualifier.

Plugin is installed under the `codespeak-dev` organization per `plugin.json` and README install instructions.

### Session Viewer (Next.js App)

A Next.js application in `session-viewer/` for browsing AI agent sessions grouped by project.

**Project list:**
- Discovers all sessions and groups by project. SQLite cache stores project discovery results (agent directory scans, git worktree list output) with a 30-second TTL so subsequent loads read from cache rather than re-running filesystem and git operations.
- Each project card shows a session count pill in the top-right. No agent badge is rendered on `ProjectCard`.

**Session list:**
- Sessions are displayed in a single-column list sorted by timestamp of the last message, most recently active first.
- Session plan detection scans JSONL files for `~/.claude/plans/` path references, identifying actual `tool_use` blocks of type Write, Read, or Edit targeting `~/.claude/plans/*.md` files. Excludes textual mentions in `tool_result` content.
- Each session card shows: AI-generated title if a `ai-title` entry with `aiTitle` field is present, otherwise first lines of user messages plus user message count and agent summary content; message and prompt counts in format `XX msgs (YY prompts)` where prompt count excludes entries where all content blocks are `tool_result` type; start timestamp, end timestamp, duration; purple plan badge when the session has plans.
- Timestamp display rules: 24-hour time format; same-day sessions show the date once with both times and duration; multi-day same-year sessions show month/day for both endpoints; cross-year sessions show full date including year; single-timestamp sessions show date and time only with no arrow or duration; year is omitted when it matches the current year.
- Session card container navigates to the session on click via `onClick` and `router.push`. Plan badge navigates independently via anchor; plan badge click uses `stopPropagation` to prevent session navigation.
- Session filtering by agent type is performed at the discovery level; the project page shows only Claude Code agent sessions.
- Consolidated single-pass JSONL scanning extracts session titles, plan detection, and prompt counts in one read per file.

**Session detail:**
- Loads JSONL entries via a paginated API; entries served from SQLite with indexed `cwd` column for fast project-path filtering.
- Retrieves metadata for a single session via single-file read (message count, creation timestamp, modification timestamp, file size) without scanning other sessions.
- Session discovery data and metadata are fetched in parallel.
- Displays: AI-generated title as heading; agent name badge, plan badge, session ID in monospace; stats row (message count, prompt count, date/time range with duration, file size) via shared `SessionStats` component also used by session cards.
- `SessionStats` component is shared between session cards and the session detail page.
- Full sequence of all JSON objects, with none skipped by default.
- When a significant proportion of messages are hidden due to ellipsis grouping, the system proactively loads additional messages to maintain adequate visible message count.

**Entry cards:**
- All card types except user messages are collapsed by default. Pure user message cards are expanded by default. Tool-result message cards are collapsed by default.
- Cards support collapsible/expanded toggle. Collapsed state renders minimal information in the card header only; expanded state renders full content.
- Type badge renders exactly once per message in the `EntryCard` header. Redundant type badges and labels are not rendered in individual message renderer bodies.
- `ai-title` card displays title text in card header with no card body.
- `FileSnapshot` cards with no tracked files display that state in the card header with no card body. With tracked files, render an expandable file list in the card body.
- Consecutive non-user messages between user turns are collapsed behind an ellipsis indicator showing the count of hidden messages. Clicking the indicator expands all hidden messages inline.
- User messages whose content consists exclusively of `tool_result` content blocks are identified as `tool-result` subtype, classified as non-user for ellipsis grouping, collapsed by default, and displayed with an amber `tool result` badge.
- When a URL hash targets an entry containing plan-related blocks, the highlighted entry is extracted from the grouping system and rendered as a standalone card between collapsed groups, force-expanded with content visible. Hash is parsed after client-side mount. Scroll to target element is deferred using nested `requestAnimationFrame` callbacks.
- Same-page hash navigation via plan badge clicks uses a `PlanBadge` client component with a button element that assigns directly to `window.location.hash` to fire the native `hashchange` event.
- All React hooks in `SessionClient` are called unconditionally before any early return statements.

**Thinking blocks:** tagged with a secondary tag label; collapsed state shows a content preview.

**IDE context tags:**
- User messages containing `<ide_*>` pattern tags display a grey clickable badge for each tag, with the tag name wrapped in angle brackets (e.g., `<ide_opened_file>`), in monospace font.
- Clicking a badge toggles expansion of full tag content in a scrollable panel.
- Long paths in tag content are truncated from the beginning with `...` prefix, preserving the filename. Paths beginning with the current working directory are replaced with `$CWD`.
- Collapsed badge shows a short preview (first 60 characters of first line) with path truncation and CWD substitution applied.
- `projectPath` is threaded from server component through `SessionClient`, `CollapsedGroup`, and `EntryCard`; `cwd` is derived from `projectPath` with fallback to `entry.raw.cwd`.

**Tool call and result display:**
- Tool names render as amber-colored badges in entry card headers for both assistant entries and tool-result entries.
- Bash tool call entry card headers show the command string as badge detail text, truncated at the trailing end.
- File path and pattern detail text uses monospace styling with leading ellipsis truncation when too long.
- Tool result headers display tool name and file path looked up from a tool-use-id lookup map; file paths use leading ellipsis truncation.
- A single centralized helper function extracts and formats tool detail for reuse across tool use blocks, tool result blocks, and entry card display.
- When a tool result block is expanded, the file contents within are also expanded automatically. Tool result blocks and tool call node blocks are expanded by default when the parent entry is opened.
- Tool block headers display identically in collapsed and expanded states — no content appears or disappears across state transitions.
- Message timestamps display date, hours, minutes, and seconds, positioned at the far right of the header row using flex layout with margin-left auto, visible in both collapsed and expanded states.
- Rendered/JSON view toggle buttons are only visible when the message entry is expanded.

**Plan file rendering:**
- `tool_use` blocks of type Write or Edit targeting `~/.claude/plans/*.md` render the file's markdown content as formatted markdown with the plan file name as a header.
- `tool_result` blocks for Read operations targeting plan files render markdown content as formatted markdown.
- Entry cards referencing plan files display a purple badge. Clicking the badge on the session page assigns to `window.location.hash` to navigate to the plan entry.
- Markdown rendering uses `react-markdown` with Tailwind typography plugin. Markdown tables render as formatted HTML tables via `remark-gfm`.

### TUI CLI (ink-based)

A redesigned CLI interface built with ink (React for terminal) providing full interactive navigation across all screens.

**Navigation model:**
- Arrow keys (up, down, left, right) and Enter are used for navigation and selection throughout.
- Tab cycles focus between three distinct zones: tabs, content list, and action buttons. Only the active focus zone processes keyboard input at any given time.
- Shift+Enter triggers the primary action on the focused element. Esc navigates back to the previous screen.
- On the review screen: pressing up from the top of the main content list moves focus to the tabs zone; pressing down from the bottom moves focus to the actions zone; pressing down in the tabs zone moves focus to the content zone.
- Tab key is handled at the parent Review screen level; `TabBar` does not handle Tab internally.
- `AgentTab`, `CodeTab`, `GitTab`, and `ScrollableList` each accept an `active` prop that gates their keyboard input handling.
- Tab component displays cyan color, bold text, and cursor indicator only when its content zone is the active focused zone; displays dimmed styling when inactive.

**Project List screen:**
- Opens automatically on launch. If the current working directory is located under a listed project, that project is marked with `(current dir)` and sorted to index 0.
- Greets the user by first name sourced from git config. Lists all discovered projects; shows combined agent lists and aggregated session counts after merging worktree entries for the same git repository.
- Projects sorted by total session count descending.
- List is scrollable when entries exceed visible terminal height.
- Shows `Share another project:` as heading when one or more projects have already been shared.
- Global project discovery finds all projects including subfolders with their own `.git` roots as distinct entries.
- Project discovery recovers workspace paths from orphaned Cursor chat directories by extracting paths embedded in `store.db` blob data using a regex pattern, validated with a directory existence check.
- Project discovery includes Composer sessions from `~/Library/Application Support/Cursor/User/workspaceStorage/` by querying `composer.composerData` from `state.vscdb` files.

**Share Project screen:**
- Displays project path, repo URL if present, agents used with session counts per agent, file count and lines of code by programming language, total commit count across all branches, number of untracked files, number of tracked files with uncommitted changes, and worktree count.
- File and LOC counts exclude node_modules, venv, and similar directories; exclude gitignored files.
- File extensions mapped to programming languages via hand-maintained extension-to-language map; tokei or cloc used when available as supplement.
- Shows a welcome header when it is the first screen the user sees.
- Pressing Escape navigates to the project list.

**Consent screen:**
- Displays CodeSpeak's data use terms (permission to study the project, no commercial software built from code, retraction contact `support@codespeak.dev`).
- Enter confirms consent (bright, prominent); Esc is secondary dismissive action (visually de-emphasized).

**Review Before Sharing screen:**
- A single Sessions tab replaces per-agent tabs. Controlled via `SESSION_PREVIEW_ENABLED` flag sourced from `VIBE_SHARING_SESSION_PREVIEW` environment variable (defaults to false).
- When sessions preview is disabled: Sessions tab displays a static read-only list of agent names and session counts in the same visual format as the share-project screen. Sessions tab label shows `Sessions (N)`.
- When sessions preview is enabled: Sessions tab renders an interactive agent list that drills into a full agent tab with session preview.
- Sessions tab is only shown if the project has agents.
- Code tab shows navigable file tree; files excluded from sharing are labelled `Not Shared` inline. Not Shared folders appear in the tree but cannot be expanded. Shared files are git-tracked plus user-selected untracked files. Not Shared files are gitignored or in excluded directories.
- Git tab shows git branches and commits per branch.
- Review screen and Share Project screen display a legend explaining Tab key navigation and available keyboard shortcuts.
- Back button displays a hint indicating Escape triggers it. Primary action button displays a hint indicating Shift+Enter triggers it.
- Progress bars displayed during long-running operations.

**Post-share screen:**
- `Share Another` is the default highlighted action; `Quit` is visually de-emphasized as secondary.
- `To request deletion` message appears as a footnote outside the Thank You box.

**Session preview:**
- Pressing Enter on a session opens a preview of that session. Pressing Esc while previewing returns to the Preview screen with the Files tab open.
- Claude session first messages have `<ide_*>` tags stripped before display.
- Sessions with null or empty names display a fallback label. Sessions with empty names convert empty `firstPrompt` strings to null at the provider level.
- Opening a session displays its messages; worktree session files are located correctly using `findClaudeSessionFile` lookup.

**`ActionBar` component** replaces letter-key shortcuts for navigation. The `GO_PROJECT_LIST` action clears navigation history so Escape on the share-project screen always navigates to the project list.

### Cursor Session Support

The CLI app supports bundling Cursor session data by copying `store.db` SQLite database files wholesale into the project archive (rather than extracting individual JSON blobs) for maximum compatibility across user environments.

**Discovery:**
- `findWorkspaceStorageDir` scans `workspaceStorage/*/workspace.json` to match workspace by path.
- `getWorkspaceComposerIds` reads workspace `state.vscdb` to extract all composerIds for the workspace.
- `discoverPlansFromRegistry` queries the global plan registry and matches by composerId, merged with blob-scanning so both discovery strategies always run.
- Plan files created via the Cursor IDE UI are discovered via `composer.planRegistry` in the global `state.vscdb` and linked to sessions through composerId matching.
- `composerId`-to-`agentId` mapping is resolved via `composer.composerData` entries in `cursorDiskKV` or workspace-level `composer.composerData`.
- `createStateExtract` creates a filtered `state.vscdb` containing: `composer.planRegistry` from global state; `composer.composerData` from workspace state; `composerData` UUID entries from `cursorDiskKV`. The filtered extract uses `sqlite3 CLI` with `-readonly` flag and contains only plan registry and workspace composer metadata.
- `buildDiscoveryManifest` generates `discovery-manifest.json` with intermediate findings including hashes, slugs, composerIds, plan matches, original paths, and algorithms.
- `getProviderFiles` and `getVirtualFiles` include filtered `state.vscdb`, `workspace.json`, and discovery manifest in the archive.
- Archive replicates the `.cursor` subtree structure.

**Session viewer integration:**
- Cursor session discovery includes Composer sessions extracted from workspace state in addition to chat directory sessions.
- Composer sessions already discovered via chat are deduplicated using seen identifiers.
- Session count computation during project discovery does not perform redundant file validation; real session count is computed once via `findSessions()` filtering when the tab loads.

### Vibe Coder Personality Test

Analyzes coding behavior signals from code, git history, and Claude Code agent sessions to produce a named personality type with trait breakdown.

- Defines 5 personality traits that are amusing, at least some of which are practically useful, and all reliably detectable from code analysis, git history, and agent session logs.
- Traits are combined into approximately 8 named archetypes (not the full 32-combination set).
- Accepts a configurable set of projects to analyze; all Claude Code projects on the machine are included by default with the ability to exclude specific projects.
- Only Claude Code agent sessions are supported as the data source.
- LLMs may be used as part of the trait detection mechanism.
- Trait detectability from available signals is a hard constraint on trait selection.
- Plan file saved to `intent/vibe-personality/` directory.

### Permission Event Observability

Documents what permission-related signals exist in Claude JSONL session logs:

- Permission prompt events are recorded when Claude asks to run a command or edit a file. Records distinguish between user agreeing, user declining, and user providing alternative instructions. User rejection is detectable via `is_error` `tool_result`. Mode switches are detectable via `permissionMode` changes in session data.
- Auto-approval cannot be definitively identified from session logs because no explicit field (e.g., `autoApproved`) exists; auto-approval must be approximated using the `permissionMode` field combined with `permissions.allow` patterns from `settings.json`.
- Successfully executed tool calls with no rejection record indicate the active mode suppressed the prompt.
- Findings are documented in `intent/vibe-personality/permissions.md`.

## Design Decisions

- **Ink (React for terminal) as TUI framework** — chosen over `@inquirer/prompts` which cannot cleanly support tabs, file tree navigation, text preview, and screen-to-screen navigation.

- **Copying `store.db` SQLite files wholesale into the archive** — extracting JSON blobs from Cursor databases as human-readable JSONL was considered but not chosen; wholesale file copy was selected for maximum compatibility across user environments.

- **Registry-based plan discovery via `composer.planRegistry` in `state.vscdb` combined with blob-scanning** — text-based LIKE matching of plan references within session chat blobs in `store.db` was implemented and confirmed to find zero matches; root cause: plan references are stored in binary protobuf blobs rather than JSON, making text-based matching fail. Dual strategy ensures both discovery paths always run.

- **Separate upload events SNS topic from infrastructure alarms topic** — a single unified topic was considered; rejected to allow independent filtering and scaling of upload event notifications.

- **Slack webhook Lambda with SSM SecureString for webhook URL** — AWS Chatbot integration was considered; rejected to retain formatting control and avoid AWS-managed service dependency. Storing the webhook URL in a configuration file was rejected to avoid exposing sensitive credentials in source code.

- **Dedicated `PlanBadge` client component using `button` element with direct `window.location.hash` assignment** — Next.js `Link` components and plain anchor tags were tried for same-page plan badge navigation on the session detail page; both were rejected because Next.js intercepts client-side navigation without remounting the component, preventing the `hashchange` event from firing and leaving highlighted entry state stale.

- **Split CORS configuration into two lists** — a single unified CORS list was proposed; rejected because API Gateway HTTP API v2 does not support wildcard characters in `allowOrigins` values while S3 does, making a shared list with wildcard syntax incompatible with API Gateway constraints.

- **Presigned S3 GET URL returned from confirm endpoint** — the `https://codespeak.dev/share/{uploadId}` share URL format was implemented and displayed to users but confirmed non-functional: the S3 bucket blocks all public access and no web frontend exists to serve that path. All share URL handling has since been removed from both client and server.

- **Route 53 CDK automation not used for DNS** — DNS is managed through an external registrar; DNS record configuration is performed manually at the registrar after ACM certificate and API Gateway custom domain are created.

- **`pointInTimeRecoverySpecification` API field for DynamoDB PITR** — the deprecated `pointInTimeRecovery` property was in use; replaced because `aws-cdk-lib` has deprecated it and will remove it in the next major release.

- **SSM PutParameter with overwrite enabled** — calling SSM PutParameter without the overwrite flag causes `ParameterAlreadyExists` errors when re-running deployments.

- **Alarm notification email stored in config file, not SSM** — email is classified as non-sensitive plain configuration; the added SSM lookup complexity is unjustified compared to a checked-in config file.

- **`s3:GetObject` IAM action for HeadObject checks** — `s3:HeadObject` was implemented and deployed; rejected because it is not a valid IAM action in AWS IAM, causing `AccessDenied` errors from S3.

- **`AdministratorAccess` permission level recommended for development** — reduces setup friction; static IAM credentials via `aws configure` and SSO-based login via `aws configure sso` are both valid for CDK use.

- **CDK Bootstrap requires `cdk.json` present or explicit `aws://ACCOUNT_ID/REGION` argument** — running `npx cdk bootstrap` from a directory without `cdk.json` fails with an environment resolution error.

- **S3 indefinite retention** — S3 lifecycle rule auto-deleting uploads after 90 days was proposed as a default; rejected because all uploaded data must be retained indefinitely.

- **Per-session selection excluded** — all Claude Code sessions associated with a project are included in the archive without selection.

- **Scoped npm package name** — moving from unscoped to scoped after first publish would require deprecating the original unscoped package with no clean reversal.

- **Minor version bump (0.2.0) over patch** — 20 accumulated commits including Cursor Composer sessions, spinners, and focus navigation judged to warrant a minor bump.

- **Only approximately 8 named archetypes** — a full 32-archetype system covering all trait combinations was considered; rejected to reduce upfront design complexity.

- **Removing auto-confirmation from pre-sign-up Lambda** — the Lambda was auto-confirming and auto-verifying users, bypassing Cognito's native verification flow. Fix: retain only email domain validation in the Lambda, delegating verification to Cognito's built-in flow.

- **Amazon SES for Cognito email delivery** — Cognito's default sender (`no-reply@verificationemail.com`) has a 50 emails/day hard cap, high spam classification rate, and is blocked by corporate email filters.

- **`initialCursor` prop removed from `ScrollableList`** — an `initialCursor` prop was added to pre-position the cursor on the current project; replaced by sorting the current project to index 0, making the prop redundant.

- **`useMemo` for grouped entry segments relocated before early returns in `SessionClient`** — the hook was originally placed after early return statements, violating React Rules of Hooks by skipping the hook on some render paths.

- **Session detail page uses single-file read for metadata** — the detail page was calling a function that scanned all sessions across all agents for the entire project even though only one session's metadata was needed; replaced with single-file read returning message count, creation/modification timestamps, and file size.

- **SQLite caching for project discovery and session entries** — first project list load took multiple seconds due to agent directory scanning and git subprocess calls on every load with no persistent cache; session list for specific projects read large numbers of JSONL files in full to check membership even when metadata was cached.

- **Filtering sessions by agent type at discovery level** — filtering at display level was considered; rejected to reduce the volume of data processed and improve page load performance.

- **Per-agent tabs replaced by single Sessions tab** — per-agent tabs created UI clutter; a single unified Sessions tab with `SESSION_PREVIEW_ENABLED` flag allows graceful degradation from interactive preview to static listing.

- **Agents section on share-project screen always visible** — the agents section was gated behind `SESSION_PREVIEW_ENABLED`; rejected in favor of always showing it regardless of flag state.

## Known Issues

- Reloading the project list and session list takes too long; no root cause confirmed.

- Some Claude sessions display only a UUID on the Review screen; no root cause confirmed.

- Gemini CLI sessions directory reports sessions found but none appear in the Review screen; no root cause confirmed.

- Opening a Cursor session in Review for the khariton-style project shows `No messages found in this session` despite the session existing and containing messages; no root cause confirmed.

- Up navigation in the main content list on the Review screen is broken; no root cause confirmed.

- Session discovery logic may overlook some Cursor sessions or handle them inconsistently; no confirmed root cause.