# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm run dev            # Run locally with tsx (no build needed)
npm start              # Run compiled output (requires build first)
```

**Backend (CDK):**
```bash
cd backend && npm install
npx aws-cdk deploy --profile YOUR_PROFILE
npx aws-cdk diff --profile YOUR_PROFILE
```

**Point CLI at a custom backend:**
```bash
VIBE_SHARING_API_URL=https://YOUR_API_URL npm run dev
```

There is no test suite or linter configured.

## Architecture

This is a CLI tool (`npx codespeak-vibe-share`) that discovers AI coding sessions from multiple agents, lets users preview and select what to share, then uploads an archive to CodeSpeak's S3 backend.

### Two CLI flows

- **Default (interactive):** React + Ink TUI launched from `src/index.ts` → `startApp()`. A screen state machine in `src/ui/app.tsx` drives navigation: loading → project-list → share-project → review → consent → uploading → thank-you.
- **Legacy (`--project` flag):** Linear CLI flow in `src/cli.ts`, detects project at cwd.

### Agent provider system

Each AI agent (Claude Code, Cursor, Codex, Gemini, Cline, OpenCode) implements the `AgentProvider` interface (`src/sessions/types.ts`). Providers live in `src/sessions/agents/` and handle:
- Detection (is the agent installed?)
- Project discovery (what projects have sessions?)
- Session enumeration and file collection

`src/sessions/global-discovery.ts` runs all providers in parallel, merges results, and consolidates git worktrees into single project entries.

### Data flow for upload

1. `src/git/git-state.ts` — captures git status, diff, log, and creates a git bundle
2. `src/archive/archiver.ts` — zips project files + session files + manifest
3. `src/archive/manifest.ts` — generates metadata JSON included in the archive
4. `src/upload/upload.ts` — requests a presigned S3 URL from the backend, then PUTs the archive

### Backend

AWS CDK stack in `backend/` — API Gateway + Lambda (Node.js 20, ARM64) + S3 + DynamoDB. Lambda functions are in `backend/lambda/` (presign, confirm, health, slack-notify). Config in `backend/lib/config.ts`.

### Key conventions

- ESM throughout (`"type": "module"`, `.js` extensions in imports even for TypeScript)
- JSX uses `react-jsx` transform (React 19 + Ink 6 for terminal UI)
- Cursor and OpenCode providers query SQLite databases via the `sqlite3` CLI. Cursor has per-session `store.db` files; OpenCode has a single `~/.local/share/opencode/opencode.db`. Both create filtered DB extracts (via `sqliteCreateFiltered`) to avoid leaking other projects' data.
- Path encoding for Claude Code sessions is lossy (path separators → hyphens); `history.jsonl` is used as fallback for disambiguation
- `src_init/` is an older version of the source; active development is in `src/`

### Environment variables

- `VIBE_SHARING_API_URL` — override API endpoint (default: `https://vibe-share.codespeak.dev`)
- `VIBE_SHARING_SESSION_PREVIEW` — set to `"true"` to enable session preview in review screen
