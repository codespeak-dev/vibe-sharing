# vibe-sharing — Requirements

A Claude Code plugin that packages a project and its Claude Code session transcripts into a shareable zip file. Built for sharing vibe-coded projects — includes git history, the Claude conversations that built it, and any uncommitted work.

**Distribution:** `claude plugin install --from-github codespeak-dev/vibe-sharing`
**Invocation:** `/vibe-share` in any git project

---

## 1. Plugin Structure

```
vibe-sharing/
  .claude-plugin/
    plugin.json           # Plugin manifest (name, description, version, author)
  commands/
    vibe-share.md         # /vibe-share slash command definition
  scripts/
    vibe-share.sh         # Shell script with all packaging logic
  README.md               # User-facing docs
  REQUIREMENTS.md         # This file
```

The slash command markdown (`commands/vibe-share.md`) uses frontmatter `allowed-tools: [Bash, AskUserQuestion]` and `!` backtick preprocessing to gather context before presenting the interactive flow.

---

## 2. Zip Contents

The zip does **not** contain source files directly. All tracked source is in the git bundle. Only files git doesn't have are copied as loose files.

| Entry | Description | Source |
|-------|-------------|--------|
| `repo.bundle` | Git bundle with full repo history (`git bundle create ... --all`). Restore with `git clone repo.bundle .` | `PROJECT_DIR/.git` |
| `file-tree.txt` | Text listing of ALL files on disk, including dependencies like `node_modules/` (everything except `.git/` internals) | `find . -not -path './.git/*'` |
| `git-status.txt` | `git status` output at time of export | `git status` |
| `git-diff.txt` | Both unstaged (`git diff`) and staged (`git diff --staged`) changes | `git diff` + `git diff --staged` |
| `claude-sessions/` | **Entire** project sessions directory — see section 3 | `~/.claude/projects/<encoded-path>/` |
| `claude-plans/` | Plan files referenced in session transcripts | `~/.claude/plans/` (filtered) |
| `claude-debug/` | Debug logs referenced in session transcripts | `~/.claude/debug/` (filtered) |
| `untracked-files/` | Actual file copies of untracked + modified files only (stuff git doesn't have), preserving directory structure | `git ls-files --others` + `git diff --name-only` |

### Output filename

`vibe-share-<project-name>-<YYYYMMDD-HHMMSS>.zip` — placed in the project root.

---

## 3. Claude Code Session Data

### 3.1 Sessions Directory

The entire project sessions directory is copied recursively:

```
~/.claude/projects/<encoded-path>/
  ├── <uuid>.jsonl              # Main session transcripts (top-level)
  ├── <uuid>/
  │   ├── subagents/
  │   │   ├── agent-*.jsonl     # Subagent session transcripts
  │   │   └── *.meta.json       # Subagent metadata
  │   └── tool-results/         # Tool result data
  └── memory/                   # Memory files
```

Where `<encoded-path>` is the project's absolute path with `/` replaced by `-` (e.g., `/Users/alice/myapp` → `-Users-alice-myapp`).

**Critical:** The entire directory tree is copied (`cp -r`), not cherry-picked. This ensures subagent sessions, tool results, metadata, and memory are all included.

### 3.2 Plan Files

Plans live in `~/.claude/plans/` globally (not per-project). To determine which plans belong to this project:

1. Scan ALL `.jsonl` files in the sessions directory (including subagent sessions) for the path pattern `.claude/plans/<name>.md`
2. Extract unique plan filenames
3. Copy only those files that exist in `~/.claude/plans/`

The grep pattern is `\.claude/plans/[a-zA-Z0-9_-]+\.md` — matching the full path avoids false positives from filenames appearing in other contexts (e.g., `ls` output in transcripts).

### 3.3 Debug Logs

Debug logs live in `~/.claude/debug/` globally. Same approach as plans:

1. Scan ALL `.jsonl` files for the path pattern `.claude/debug/<uuid>.txt`
2. Extract unique debug filenames
3. Copy only those files that exist in `~/.claude/debug/`

---

## 4. Secret Protection

### 4.1 Secret Files — Never Included

The following files are **never** copied into the zip, regardless of their git status:

| Pattern | Examples |
|---------|----------|
| `.env`, `.env.*` | `.env`, `.env.local`, `.env.production`, `.env.development` |
| `*.key` | `server.key`, `private.key` |
| `*.pem` | `cert.pem`, `ca.pem` |
| `*.p12` | `keystore.p12` |
| `*.pfx` | `certificate.pfx` |

These are excluded from the `untracked-files/` copies. They are detected via `find` (up to 3 levels deep) and displayed to the user in the preview.

### 4.2 Gitignored Files — Not Copied

Files matching `.gitignore` rules (e.g., `node_modules/`, `venv/`, `dist/`, `build/`) are never copied. They appear only as names in `file-tree.txt`.

### 4.3 Session Transcript Redaction

All `.jsonl` files (main sessions AND subagent sessions) are scanned and redacted **before** being added to the zip. Redaction is best-effort pattern matching — it preserves the first 4 characters of detected secrets for identification, replacing the rest with `***REDACTED***`.

**Patterns redacted:**

| Category | Pattern | Example Match |
|----------|---------|---------------|
| OpenAI/Anthropic API keys | `sk-` followed by 20+ alphanumeric chars | `sk-abcd***REDACTED***` |
| AWS access keys | `AKIA` followed by 16+ uppercase alphanumeric | `AKIA1234***REDACTED***` |
| Google API keys | `AIza` followed by 35+ chars | `AIzaSy***REDACTED***` |
| Stripe live keys | `sk_live_` or `rk_live_` followed by 24+ chars | `sk_live_abcd***REDACTED***` |
| GitHub PATs | `ghp_` followed by 36+ chars | `ghp_abcd***REDACTED***` |
| GitLab PATs | `glpat-` followed by 20+ chars | `glpat-abcd***REDACTED***` |
| Slack tokens | `xox[bpors]-` followed by 10+ chars | `xoxb-abcd***REDACTED***` |
| Private keys | `BEGIN ... PRIVATE KEY` blocks | Marker appended |
| Connection strings | `protocol://user:password@host` (postgresql, mysql, mongodb, redis, amqp) | Password portion replaced |
| Bearer tokens | `Bearer` followed by 20+ char token | First 4 chars kept |

**Implementation detail:** Uses `sed -i.bak -E` for macOS compatibility (macOS `sed` requires a backup extension with `-i`). Backup files are removed after processing. Connection string replacement uses `#` as the sed delimiter to avoid conflicts with regex `|` alternation.

### 4.4 Limitations

- Pattern matching cannot catch every possible secret format
- Secrets embedded in unusual formats or custom token schemes will not be detected
- The user is warned about this at every stage (welcome message, review screen)
- The "Show me suspect files" review option provides an additional manual check

---

## 5. Interactive UX Flow

The command uses a 3-step interactive flow. All user interaction happens through Claude's built-in `AskUserQuestion` tool with formatted `preview` fields.

### 5.0 Welcome Message

Before any interaction, display a plain-text welcome message explaining:
- What secret protections are in place
- That gitignored files are not copied
- That session transcripts are scanned and redacted (best effort)
- That the user gets a preview before anything is created
- That they can search for suspect files after the zip is built

### 5.1 Step 1 — Preview & Consent

**Tool:** `AskUserQuestion`
**Header:** "Vibe Share"
**Question:** "Ready to package your project for sharing?"

**Option 1: "Create zip"** — preview shows:
```
PROJECT: <project_name>

WHAT'S GOING IN THE ZIP:
  Git bundle ............. full repo history
  File tree listing ...... all files on disk
  Git status + diff ...... 2 snapshots
  Claude sessions ........ <count> transcripts
  Subagent sessions ...... <count> transcripts
  Plan files ............. <count> referenced plans
  Debug logs ............. <count> referenced logs
  Untracked/changed files  <count> files

ON DISK BUT NOT COPIED (in tree listing only):
  node_modules/ .......... <count> files
  venv/ .................. <count> files
  ...

SECRET FILES EXCLUDED:
  .env.local
  ...
```

**Option 2: "Show untracked file list"** — shows the list of untracked/changed files, then asks consent again (without this option).

### 5.2 Step 2 — Build

Run the build as a single Bash command. The build script:
1. Creates a temp staging directory (cleaned up on exit via `trap`)
2. Generates `file-tree.txt`
3. Captures `git-status.txt` and `git-diff.txt`
4. Creates `repo.bundle`
5. Copies entire sessions directory, then redacts all `.jsonl` files
6. Collects referenced plan files
7. Collects referenced debug logs
8. Copies untracked/changed files (excluding secrets)
9. Zips everything in staging to the output path
10. Reports machine-readable summary (parsed by Claude)

### 5.3 Step 3 — Review

**Tool:** `AskUserQuestion`
**Header:** "Done!"
**Question:** "Your vibe-share zip is ready! Want to review it?"

**Option 1: "Looks good!"** — preview shows zip name, size, content counts, redaction summary, restore instructions, and a reminder about session transcript secrets.

**Option 2: "Show me suspect files"** — searches zip contents for filenames matching: `secret`, `key`, `token`, `password`, `credential`, `.env`, `.pem`, `.pfx`, `.p12`, `private`. Shows results, then asks again with just "Looks good!" and "Delete zip" options.

**Option 3: "Delete zip and start over"** — deletes the zip, tells user to run `/vibe-share` again.

---

## 6. Shell Script Modes

`scripts/vibe-share.sh` supports multiple modes for the command markdown and potential future tooling:

| Mode | Purpose |
|------|---------|
| `--scan` | Dry-run: outputs JSON with project name, counts, estimated size, secret file list |
| `--list` | Lists untracked/changed files that would be copied (secret-filtered) |
| `--build` | Creates the zip (full build with progress output) |
| `--review <zip>` | Lists contents of an existing zip |
| `--suspects <zip>` | Searches zip for secret-like filenames |
| `--scan-sessions` | Scans session transcripts for embedded secrets (reports by category: API_KEY, PRIVATE_KEY, CONNECTION_STRING, BEARER_TOKEN, SECRET_ASSIGNMENT) |

### Session scanning (`--scan-sessions`)

Uses process substitution (`done < <(find ...)`) instead of piped `find ... | while` to avoid subshell variable scoping issues — the `found` counter must be visible after the loop.

---

## 7. Restoring a Shared Project

```bash
unzip vibe-share-my-project-20260311-143022.zip
git clone repo.bundle my-project
cd my-project
# Untracked files are in ../untracked-files/ if you need them
# Session transcripts are in ../claude-sessions/
#   Main sessions: top-level *.jsonl files
#   Subagent sessions: <session-id>/subagents/agent-*.jsonl
# Plan files are in ../claude-plans/
# Debug logs are in ../claude-debug/
```

---

## 8. Platform Considerations

- **macOS `sed`:** Requires `-i.bak` (backup extension) for in-place editing. GNU `sed` accepts `-i ''` but macOS does not. All `sed -i` calls use `.bak` and clean up the backup files afterward.
- **Zip format:** Chosen over tar.gz for universal accessibility (Windows support).
- **Shell compatibility:** Uses `bash` with `set -euo pipefail`. Requires `git`, `zip`, `zipinfo`, `find`, `sed`, `grep`, `du`, `wc`.
