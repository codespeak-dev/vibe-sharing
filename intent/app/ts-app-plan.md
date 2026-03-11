# Vibe-Sharing CLI Tool — Implementation Plan

## Context

We need a CLI tool that collects a user's vibe-coded project (source files + AI coding session transcripts) and uploads them for analysis. The tool must be extremely robust — users who hit errors will abandon the process rather than troubleshoot.

**Key principles**:
- Zero-install experience wherever possible
- Privacy-first: inform the user clearly, get explicit consent before any data leaves their machine
- Cross-platform: macOS, Linux, Windows
- No secrets of ours ever touch the user's machine
- Graceful degradation: never crash, always produce something useful

## Technology

- **TypeScript + Node.js** (ESM, requires Node 18+)
- **Dependencies**: `commander`, `@inquirer/prompts`, `ora`, `chalk`, `archiver`
- **Git operations**: `child_process.execFile` (only need a few git commands)
- **HTTP**: Native `fetch`

## Distribution

**Goal**: As close to zero-install as possible.

| Method | Audience | Command |
|--------|----------|---------|
| `npx codespeak-vibe-share` | Anyone with Node.js | Zero install |
| Standalone binary | Everyone else | Download + run |

**Standalone binary**: Use Node.js SEA (Single Executable Application, built into Node 22) to produce platform-specific binaries (macOS-arm64, macOS-x64, linux-x64, windows-x64). Distribute via GitHub releases.

**One-liner install** (for non-Node users):
```bash
# macOS/Linux
curl -fsSL https://get.codespeak.dev/vibe-share | sh

# Windows (PowerShell)
irm https://get.codespeak.dev/vibe-share | iex
```

The install script detects platform, downloads the right binary from GitHub releases, puts it in a local dir (e.g., `~/.codespeak/bin`), and suggests adding to PATH. No `sudo` required.

**For MVP**: Start with `npx` only. Add standalone binaries in a fast follow.

## Cross-Platform Considerations

- Use `path.join` / `path.resolve` everywhere (never hardcode `/`)
- Use `os.homedir()` for `~` expansion
- Windows: Claude Code stores sessions in `%USERPROFILE%\.claude\projects\` with the same encoding but using the Windows absolute path (e.g., `-C-Users-foo-project`)
- Use `execFile('git', ...)` not `exec('git ...')` — works on all platforms, avoids shell injection
- Archive paths: always use forward slashes in zip entries (zip spec requires it)
- Test: `process.platform === 'win32'` for any platform-specific behavior

## Project Structure

```
src/
  index.ts                # CLI entry point (#!/usr/bin/env node, commander setup)
  cli.ts                  # Main orchestration flow
  config.ts               # Constants (paths, limits, API URL)
  git/
    git-state.ts          # Git detection, tracked/untracked file listing
  sessions/
    types.ts              # TypeScript types for session data
    discovery.ts          # Orchestrates agent detection + session finding
    agents/
      claude.ts           # Claude Code session discovery
      codex.ts            # OpenAI Codex CLI session discovery
      gemini.ts           # Google Gemini CLI session discovery
      cline.ts            # Cline session discovery
      base.ts             # AgentProvider interface
  archive/
    archiver.ts           # Zip creation with progress
    manifest.ts           # Manifest type + builder
  upload/
    upload.ts             # Presigned URL fetch + S3 PUT
  ui/
    prompts.ts            # All Inquirer interactions
    display.ts            # File trees, summaries, success/error display
    consent.ts            # Privacy notice + explicit consent flow
  utils/
    errors.ts             # VibeError class, user-friendly error factories
    paths.ts              # Path utilities
    fs-helpers.ts         # Safe JSON/JSONL reading, file/dir existence checks
    excludes.ts           # Default exclude patterns for non-git projects
```

## Main Flow (`cli.ts`)

```
1. Welcome + Privacy Notice
   - Explain what the tool does: "This tool collects your project files and
     AI coding session transcripts so you can share them with [us]."
   - Emphasize: "Nothing leaves your machine without your explicit approval.
     You will see every file before anything is shared."
   - Get initial consent to proceed with scanning

2. Detect project files
   - If git repo: get tracked files, untracked files (ask user which to include)
   - If NOT git repo: walk directory, auto-exclude common patterns,
     show the exclude list, let user customize

3. Discover AI sessions (auto-detect all supported agents)
   - Scan for all known agents in parallel
   - Show what was found (e.g. "Found 3 Claude Code sessions, 1 Codex session")
   - Let user select which sessions to include
   - If nothing found: offer to browse filesystem manually

4. Display complete file manifest + size estimate
   - Show project files, session files, total size
   - "These files will be packaged and uploaded to [destination]."
   - "No other data will be collected or sent."
   - Get EXPLICIT confirmation: "Do you consent to sharing these files? (y/N)"
     (Default NO — user must actively opt in)

5. Create zip archive with progress spinner

6. Upload or save locally
   - If backend available: presigned URL → S3 PUT → confirm → show share URL
   - If backend unavailable or --output: save zip locally
   - Show: "Upload complete. Your data is stored at [URL]. You can request
     deletion at any time by contacting [email]."

7. Clean up temp files
```

## Privacy & Consent UX

This is a first-class concern, not an afterthought.

**Three consent gates**:
1. **Initial**: "This tool will scan your project and AI sessions. Nothing is shared yet. Proceed?" (before any file scanning)
2. **Review**: Show exact file list. "These N files (X MB) will be shared with [org]. Do you consent?" (default: No)
3. **Upload confirmation**: After zip is created, before upload. "Ready to upload X MB to [destination]. Proceed?"

**Privacy notice** (shown at startup):
```
╔══════════════════════════════════════════════════════════════╗
║  codespeak-vibe-share — Project & Session Collector           ║
║                                                              ║
║  This tool helps you share your project and AI coding        ║
║  sessions with [Organization].                               ║
║                                                              ║
║  • You control exactly what gets shared                      ║
║  • You'll review every file before upload                    ║
║  • Nothing leaves your machine without your consent          ║
║  • No data is collected about you beyond what you share      ║
║  • You can request deletion at any time                      ║
╚══════════════════════════════════════════════════════════════╝
```

## Security: No Secrets on User's Machine

The CLI must be **completely stateless** regarding our infrastructure:

- **No API keys baked into the binary** — the presigned URL endpoint is anonymous (rate-limited by IP)
- **No auth tokens cached** — each run is independent
- **No config files written** — the CLI reads project files, produces a zip, uploads, done
- **Presigned URLs are one-time-use and expire in minutes** — even if intercepted, they're useless after
- **The only thing the user's machine ever receives from us**: a presigned URL and a share URL. Neither grants ongoing access.
- **Reversibility**: if someone decompiles the CLI, all they find is a public API endpoint URL. That endpoint only allows creating presigned upload URLs with rate limiting — no read access to anything.

## Agent Session Support

### Interface

```typescript
interface AgentProvider {
  name: string;                    // "Claude Code", "Codex", etc.
  detect(): Promise<boolean>;      // Does this agent exist on the system?
  findSessions(projectPath: string): Promise<DiscoveredSession[]>;
  getSessionFiles(session: DiscoveredSession): Promise<string[]>;
}
```

### Claude Code (`~/.claude/projects/`)

- **Storage**: `~/.claude/projects/<encoded-path>/` where `/` → `-`
- **Format**: JSONL files (one per session) + subdirs with subagent JSONL files
- **Discovery**:
  1. Compute encoded path, check if dir exists
  2. If `sessions-index.json` exists → verify `projectPath` matches
  3. If no index → read first `user` message from each JSONL, check `cwd` field
  4. Fallback: scan `~/.claude/history.jsonl` for entries with matching `project` field
- **Files to collect**: `*.jsonl`, `*/subagents/*.jsonl`, `*/subagents/*.meta.json`, `sessions-index.json`

### OpenAI Codex (`~/.codex/sessions/`)

- **Storage**: `~/.codex/sessions/` — flat or organized by `YYYY/MM/DD/`
- **Format**: Older sessions are JSON (`rollout-YYYY-MM-DD-<uuid>.json`), newer are JSONL
- **Discovery**: Scan session files, parse `session_meta` / `session` for `cwd` field, match against project path
- **Also useful**: `~/.codex/history.jsonl` for session-to-project mapping

### Google Gemini CLI (`~/.gemini/antigravity/`)

- **Storage**: `~/.gemini/antigravity/conversations/` + `implicit/` + `brain/`
- **Format**: Protocol Buffer binary (`.pb` files)
- **Discovery**: Grep `.pb` files for project path as raw string (paths appear as plaintext in protobuf). If no matches, show available conversations by UUID and let user pick.
- **Files to collect**: matching `*.pb` files + corresponding `brain/<uuid>/` dirs

### Cline (`~/.cline/data/tasks/`)

- **Storage**: `~/.cline/data/tasks/<timestamp>/`
- **Format**: JSON files (`task_metadata.json`, `api_conversation_history.json`, `ui_messages.json`)
- **Discovery**: Read `~/.cline/data/state/taskHistory.json`, match `cwdOnTaskInitialization` to project path

### Fallback: Manual Browse

If no supported agent found sessions, or user wants to add more:
- List `~/` dirs matching `.*` that look like agent configs
- Let user pick directories to include wholesale

## Non-Git Project Handling

Default exclude patterns (in `src/utils/excludes.ts`):
```
node_modules/  .venv/  venv/  __pycache__/  .git/
dist/  build/  out/  .next/  .nuxt/  .output/
.env  .env.*  *.log
.DS_Store  Thumbs.db
*.pyc  *.pyo  *.class  *.o  *.so  *.dylib  *.dll
```

Flow: walk directory → apply excludes → show user what's excluded and what's included → let them add/remove patterns → proceed.

## Upload

### Architecture (MVP)
- CLI calls `POST <API_URL>/api/v1/presign` with `{ filename, sizeBytes }`
- Backend generates time-limited S3 presigned URL, returns `{ uploadUrl, uploadId }`
- CLI PUTs zip directly to S3
- CLI calls `POST <API_URL>/api/v1/confirm` with `{ uploadId }`
- Backend returns `{ shareUrl }`

### Security
- **No AWS credentials in the CLI** — ever
- **No API keys** — the presign endpoint is public with rate limiting (by IP) and size limits
- **Presigned URLs** expire in 5 minutes, are scoped to a single object key
- Backend IAM role: `s3:PutObject` only, scoped to one bucket prefix

### Graceful degradation
- `API_URL` configurable via env var `VIBE_SHARING_API_URL`
- If no API URL set, or API unreachable → save zip locally, tell user where it is
- `--output <path>` always available

## Error Handling

`VibeError` class with `userMessage` + `suggestion`.

**Philosophy**: Never crash. Degrade gracefully. Always produce a zip if possible.

Key scenarios:
- Git not found → continue without git (use exclude-pattern mode)
- No sessions found → offer to browse or proceed without
- Network error → save zip locally instead
- Archive too large → suggest excluding large files
- Permission denied → clear message about which files, suggest fix

## Zip Structure

```
manifest.json
project/
  <source files, preserving directory structure>
sessions/
  claude-code/
    <session files>
  codex/
    <session files>
  gemini/
    <session files>
  cline/
    <session files>
  manual/
    <user-selected files>
```

### Manifest (`manifest.json`)
```typescript
{
  version: 1,
  createdAt: string,
  toolVersion: string,
  project: {
    name: string,
    path: string,
    isGitRepo: boolean,
    gitBranch?: string,
    gitCommit?: string,
  },
  agents: {
    [agentName: string]: {
      sessionCount: number,
      sessions: { id: string, summary?: string, messageCount?: number }[]
    }
  },
  files: {
    projectFileCount: number,
    sessionFileCount: number,
    totalSizeBytes: number,
  }
}
```

## CLI Interface

```
codespeak-vibe-share [options]

Options:
  --dry-run        Show what would be included without creating archive
  --no-sessions    Exclude AI coding sessions
  --output <path>  Save zip locally instead of uploading
  --verbose        Show detailed progress
  -V, --version    Show version
  -h, --help       Show help
```

## Implementation Order

1. **Scaffolding**: package.json, tsconfig.json, .gitignore, src/config.ts, src/utils/*
2. **Git + file collection**: src/git/git-state.ts, src/utils/excludes.ts
3. **Session discovery**: src/sessions/agents/base.ts, then claude.ts, codex.ts, gemini.ts, cline.ts, then discovery.ts
4. **UI + consent**: src/ui/consent.ts, src/ui/display.ts, src/ui/prompts.ts
5. **Archive**: src/archive/manifest.ts, src/archive/archiver.ts
6. **Upload**: src/upload/upload.ts (with local-save fallback)
7. **Orchestration**: src/index.ts, src/cli.ts
8. **Testing & polish**: run against real projects, fix edge cases

## Verification

- Run in this repo — should find its own Claude Code sessions
- Run in a project with Codex sessions — verify Codex discovery
- Run in a non-git directory — verify exclude patterns and file collection
- `--dry-run` — verify file list display without creating archive
- `--output test.zip` — inspect zip structure (unzip -l, open manifest.json)
- Test with no internet — should fall back to local zip gracefully
- Test consent flow — verify all three consent gates work, default is "no"
- Test on Windows (WSL at minimum) — verify path handling
- Verify no secrets/tokens are written to disk after a run

## Future Directions (not in initial build)

### Server-Side Agent for File Discovery
Instead of hardcoded discovery logic, a server-side Claude agent (read-only, no write/destructive ops) connects to the user's machine via a lightweight relay, explores the filesystem, and proposes the file list. This decouples "figuring out what to share" from the CLI, making it adaptable to new agents without CLI updates.

### GitHub Repo Sharing
Instead of (or in addition to) zip upload:
- If user has a GitHub repo for the project → offer to grant access to our org
- If not → push current state to a new private repo under our org (org name from server-side config)
- Upload sessions as a directory in the repo (or a separate branch)
- Enables incremental updates: user can push new sessions/code later
- Requires `gh` CLI or GitHub token — offer as an alternative to zip upload

### Sensitive Data Detection
Before packaging, scan for potential secrets and PII:
- `.env` files, API keys, tokens, passwords in source files
- Personal info in session transcripts
- Warn user and offer to exclude flagged files
