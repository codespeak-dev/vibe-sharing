# Plan: vibe-sharing Plugin

## Context

You want people to share their vibe-coded projects with you, including Claude Code session transcripts. This plugin gives them a one-command way to package everything up as a zip, while excluding secrets and dependencies.

## Approach: Claude Code Plugin with a `/vibe-share` Command

Build a **plugin** (git repo with `.claude-plugin/plugin.json`) containing a **command** (slash command invoked via `/vibe-share`). This matches the pattern used by official Anthropic plugins like `commit-commands`.

**Installation for end users:**
```bash
claude plugin install --from-github codespeak-dev/vibe-sharing
```
Then in any project: `/vibe-share`

## File Structure

```
vibe-sharing/
  .claude-plugin/
    plugin.json                # Plugin manifest
  commands/
    vibe-share.md              # The /vibe-share slash command
  scripts/
    vibe-share.sh              # Shell script with all packaging logic
  README.md                    # Installation + usage docs
```

## Implementation

### 1. `.claude-plugin/plugin.json`

Standard plugin manifest with name, description, author.

### 2. `scripts/vibe-share.sh`

Shell script that does the mechanical work. But all user-facing messaging is handled by **Claude using built-in tools** (AskUserQuestion for previews and consent).

**Logic:**
1. Determine project root via `git rev-parse --show-toplevel` (fallback to `pwd`)
2. Compute Claude session path: `~/.claude/projects/$(echo "$PROJECT_DIR" | sed 's|/|-|g')/`
3. Create temp staging directory
4. Capture `git status` and `git diff` (staged + unstaged) into text files
5. Create `git bundle` (compact single-file representation of full repo history)
6. Copy ALL session `.jsonl` files and `memory/` directory into staging
7. Build zip of project directory with exclusion patterns (see below), **excluding `.git/`**
8. Append staging files (git metadata, bundle, sessions) into the zip
9. Output machine-readable summary (JSON) for Claude to parse and present beautifully

**Exclusion patterns:**
- Secrets: `.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`
- Secret dirs: `.aws/`, `.ssh/`
- Dependencies: `node_modules/`, `venv/`, `.venv/`, `__pycache__/`
- Build output: `dist/`, `build/`, `.next/`, `.nuxt/`, `target/`, `vendor/`
- OS junk: `.DS_Store`, `Thumbs.db`
- Previous exports: `vibe-share-*.zip`

**Output:** `vibe-share-<project-name>-<YYYYMMDD-HHMMSS>.zip` in the project root.

**Untracked files:** Automatically included because we zip the full directory tree (not `git archive`).

### UX Flow (handled in `commands/vibe-share.md`)

The command markdown instructs Claude to use a **3-step interactive flow**:

**Step 1 - Preview & Consent (AskUserQuestion):**
Claude first runs a dry-run scan (list files that would be included, count sessions, estimate size) and presents a beautiful preview using AskUserQuestion:
- Header: "Vibe Share"
- Question: "Ready to package your project?"
- Preview pane shows:
  ```
  PROJECT: my-cool-app

  What's going in:
    Source files:      47 files
    Claude sessions:    3 transcripts
    Git history:        1 bundle (full history)
    Git status/diff:    2 files

  What's being excluded:
    .env, .env.local
    node_modules/ (4,231 files skipped)
    .venv/ (1,892 files skipped)

  Estimated zip size: ~12 MB
  ```
- Options: "Create zip" / "Show full file list first"

If user picks "Show full file list first", Claude shows the complete file list, then asks again.

**Step 2 - Build:**
Claude runs the actual packaging script. Prints progress as it goes.

**Step 3 - Review Result (AskUserQuestion):**
After the zip is created, Claude uses AskUserQuestion to present the result:
- Preview shows the actual zip contents (grouped by category)
- Options: "Looks good!" / "Show me suspect files" / "Delete and try again"
- "Show me suspect files" runs a grep for secret-like patterns in the file list and shows matches

### 3. `commands/vibe-share.md`

Follows the pattern from `commit-commands/commit.md`:
- Frontmatter: `allowed-tools: [Bash, AskUserQuestion]`, `description`
- Uses `!` backtick syntax to gather initial context (project path, session count, file count)
- Instructs Claude to follow the 3-step interactive UX flow described above
- Claude uses AskUserQuestion with `preview` fields for beautiful formatted displays

### 4. `README.md`

Installation instructions, what's included/excluded, security warning about session transcripts.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command vs Skill | Command | Explicit user action with side effects |
| Shell script vs inline Claude | Shell script | Deterministic, fast, consistent |
| `.git/` as-is vs `git bundle` | `git bundle` | Compact single file; recipient runs `git clone repo.bundle .` to restore |
| Zip vs tar.gz | Zip | More universally accessible (Windows support) |
| Output location | Project root | Easy to find, alongside the project |
| Session selection | All sessions | Simpler; grabs everything for this project |
| GitHub org | codespeak-dev | github.com/codespeak-dev/vibe-sharing |

## Verification

1. Install locally: `claude --plugin-dir /Users/abreslav/codespeak/vibe-sharing`
2. Open a test project and run `/vibe-share`
3. Verify the zip contains: project files, `repo.bundle`, `claude-sessions/*.jsonl`, `git-status.txt`, `git-diff.txt`, `CONTENTS.txt`
4. Verify the zip does NOT contain: `.env`, `node_modules/`, `.git/`, etc.
5. Verify `CONTENTS.txt` inside the zip lists all files in a reviewable format
5. Unzip somewhere, run `git clone repo.bundle .` and confirm full history is intact
6. Push to GitHub, test `claude plugin install --from-github codespeak-dev/vibe-sharing`
