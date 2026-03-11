---
description: Package project files and Claude Code sessions into a shareable zip
allowed-tools: [Bash, AskUserQuestion]
---

# Vibe Share

You are packaging this project and its Claude Code sessions into a zip file for sharing.

## Context

Project name: !`basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"`
Project dir: !`git rev-parse --show-toplevel 2>/dev/null || pwd`
Has git: !`[ -d .git ] && echo "yes" || echo "no"`

Session dir: !`echo "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')"`
Session count: !`find "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' '`
Subagent session count: !`find "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')" -path "*/subagents/*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' '`
Has memory: !`[ -d "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory" ] && echo "yes" || echo "no"`
Plans dir: !`echo "$HOME/.claude/plans"`
Referenced plan count: !`find "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')" -name "*.jsonl" -type f -exec grep -ohE '\.claude/plans/[a-zA-Z0-9_-]+\.md' {} + 2>/dev/null | sed 's|.*/||' | sort -u | while IFS= read -r p; do [ -f "$HOME/.claude/plans/$p" ] && echo "$p"; done | wc -l | tr -d ' '`
Debug dir: !`echo "$HOME/.claude/debug"`
Referenced debug count: !`find "$HOME/.claude/projects/$(pwd | sed 's|/|-|g')" -name "*.jsonl" -type f -exec grep -ohE '\.claude/debug/[a-zA-Z0-9_-]+\.txt' {} + 2>/dev/null | sed 's|.*/||' | sort -u | while IFS= read -r d; do [ -f "$HOME/.claude/debug/$d" ] && echo "$d"; done | wc -l | tr -d ' '`

Untracked/changed files (not secrets): !`{ git ls-files --others --exclude-standard 2>/dev/null; git diff --name-only HEAD 2>/dev/null; git diff --name-only --staged 2>/dev/null; } | sort -u | while IFS= read -r f; do case "$(basename "$f")" in .env|.env.*|*.key|*.pem|*.p12|*.pfx) ;; *) [ -f "$f" ] && echo "$f" ;; esac; done`
Loose file count: !`{ git ls-files --others --exclude-standard 2>/dev/null; git diff --name-only HEAD 2>/dev/null; git diff --name-only --staged 2>/dev/null; } | sort -u | while IFS= read -r f; do case "$(basename "$f")" in .env|.env.*|*.key|*.pem|*.p12|*.pfx) ;; *) [ -f "$f" ] && echo "$f" ;; esac; done | wc -l`

Secret files found: !`find . -maxdepth 3 -type f \( -name ".env" -o -name ".env.*" -o -name ".env.local" -o -name ".env.production" -o -name "*.key" -o -name "*.pem" -o -name "*.p12" -o -name "*.pfx" \) 2>/dev/null || echo "(none)"`

Excluded directories (present on disk but only in the tree listing, not copied):
- node_modules: !`[ -d node_modules ] && find node_modules -type f 2>/dev/null | wc -l || echo 0` files
- venv: !`[ -d venv ] && find venv -type f 2>/dev/null | wc -l || echo 0` files
- .venv: !`[ -d .venv ] && find .venv -type f 2>/dev/null | wc -l || echo 0` files
- __pycache__: !`find . -name __pycache__ -type d -exec find {} -type f \; 2>/dev/null | wc -l || echo 0` files
- dist: !`[ -d dist ] && find dist -type f 2>/dev/null | wc -l || echo 0` files
- build: !`[ -d build ] && find build -type f 2>/dev/null | wc -l || echo 0` files
- .next: !`[ -d .next ] && find .next -type f 2>/dev/null | wc -l || echo 0` files
- target: !`[ -d target ] && find target -type f 2>/dev/null | wc -l || echo 0` files
- vendor: !`[ -d vendor ] && find vendor -type f 2>/dev/null | wc -l || echo 0` files

## What goes in the zip

The zip does NOT contain all source files. Instead:
- **repo.bundle** — git bundle with full history (all tracked source is recoverable via `git clone repo.bundle .`)
- **file-tree.txt** — text listing of ALL files on disk (including node_modules etc.)
- **git-status.txt** + **git-diff.txt** — snapshots of current state
- **claude-sessions/** — the entire project sessions directory: main transcripts, subagent transcripts, tool results, and memory
- **claude-plans/** — plan files from `~/.claude/plans/` that are referenced in the session transcripts
- **claude-debug/** — debug logs from `~/.claude/debug/` that are referenced in the session transcripts
- **untracked-files/** — actual copies of untracked/changed files ONLY (stuff git doesn't have), excluding secret files

## Instructions

Before doing anything else, display this welcome message to the user as plain text (not in a tool):

---

**Vibe Share** — packaging your project for sharing.

Your secrets matter to us. Here's what we do to protect them:

- Secret files (`.env`, `*.key`, `*.pem`, etc.) are **never** included
- Gitignored files (node_modules, venv, etc.) are **not copied** — they only appear as names in a text listing
- Source code travels inside a git bundle, not as loose files
- Only untracked/changed files get copied — and we filter secrets out of those too
- Session transcripts are scanned and detected secrets are masked with `***REDACTED***` (best effort — pattern matching can't catch everything)
- You'll get a full preview before anything is created
- After the zip is built, you can search it for suspect filenames before sharing

---

Then follow this 3-step interactive flow using the context above.

### Step 1: Preview & Consent

Use AskUserQuestion to present a preview of what will be packaged.

The question should be: "Ready to package your project for sharing?"
The header should be: "Vibe Share"

Create two options:

**Option 1: "Create zip"** with a preview showing a nicely formatted summary:
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

<if any excluded dirs have count > 0:>
ON DISK BUT NOT COPIED (in tree listing only):
  <dir_name>/ ............. <count> files
  ...

<if secret files were found:>
SECRET FILES EXCLUDED:
  <each secret file path>

<if no loose files:>
No untracked/changed files to copy
(everything is in the git bundle)
```

**Option 2: "Show untracked file list"** with a preview showing:
```
I'll show you the untracked/changed files
that would be copied into the zip.
```

If the user picks "Show untracked file list":
1. Show them the untracked/changed files from the Context section
2. Then ask the consent question again (without the "Show list" option)

If the user picks "Create zip", proceed to Step 2.

### Step 2: Build

Run the following Bash commands to build the zip. Substitute values from the Context section.

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="<project_dir from context>"
PROJECT_NAME="<project_name from context>"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ZIP_NAME="vibe-share-${PROJECT_NAME}-${TIMESTAMP}.zip"
ZIP_PATH="${PROJECT_DIR}/${ZIP_NAME}"
SESSIONS_DIR="<session_dir from context>"
PLANS_DIR="<plans_dir from context>"
DEBUG_DIR="<debug_dir from context>"

STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

# 1. Full file tree listing (all files on disk, excluding .git internals)
cd "$PROJECT_DIR"
find . -not -path './.git/*' 2>/dev/null | sort > "$STAGING_DIR/file-tree.txt"

# 2. Git status and diff
if [ -d "$PROJECT_DIR/.git" ]; then
  git -C "$PROJECT_DIR" status > "$STAGING_DIR/git-status.txt" 2>&1
  { echo "=== Unstaged changes ==="; git -C "$PROJECT_DIR" diff 2>&1; echo ""; echo "=== Staged changes ==="; git -C "$PROJECT_DIR" diff --staged 2>&1; } > "$STAGING_DIR/git-diff.txt"
fi

# 3. Git bundle
if [ -d "$PROJECT_DIR/.git" ]; then
  git -C "$PROJECT_DIR" bundle create "$STAGING_DIR/repo.bundle" --all 2>/dev/null || true
fi

# 4. Copy entire sessions directory (sessions + subagents + tool-results + memory)
SESSION_COUNT=0
SUBAGENT_COUNT=0
REDACTION_COUNT=0
if [ -d "$SESSIONS_DIR" ]; then
  cp -r "$SESSIONS_DIR" "$STAGING_DIR/claude-sessions"
  SESSION_COUNT=$(find "$STAGING_DIR/claude-sessions" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
  SUBAGENT_COUNT=$(find "$STAGING_DIR/claude-sessions" -path "*/subagents/*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
  # Redact secrets in ALL jsonl files — sessions AND subagents (best effort)
  find "$STAGING_DIR/claude-sessions" -name "*.jsonl" -type f | while IFS= read -r f; do
    before=$(wc -c < "$f")
    sed -i.bak -E 's/(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]{16,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(AKIA[A-Z0-9]{4})[A-Z0-9]{12,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(AIza[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]{31,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(sk_live_[a-zA-Z0-9]{4})[a-zA-Z0-9]{20,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(rk_live_[a-zA-Z0-9]{4})[a-zA-Z0-9]{20,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(ghp_[a-zA-Z0-9]{4})[a-zA-Z0-9]{32,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(glpat-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]{16,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(xox[bpors]-[a-zA-Z0-9-]{4})[a-zA-Z0-9-]{6,}/\1***REDACTED***/g' "$f"
    sed -i.bak -E 's/(BEGIN[[:space:]]+(RSA|DSA|EC|OPENSSH)?[[:space:]]*PRIVATE[[:space:]]+KEY)/\1 ***REDACTED***/g' "$f"
    sed -i.bak -E 's#((postgresql|mysql|mongodb|redis|amqp)://[^:]*:)[^@]*(@)#\1***REDACTED***\3#g' "$f"
    sed -i.bak -E 's/(Bearer[[:space:]]+[a-zA-Z0-9_.-]{4})[a-zA-Z0-9_.-]{16,}/\1***REDACTED***/g' "$f"
    after=$(wc -c < "$f")
    [ "$before" != "$after" ] && REDACTION_COUNT=$((REDACTION_COUNT + 1))
    rm -f "$f.bak"
  done
fi

# 4b. Collect referenced plan files
PLAN_COUNT=0
if [ -d "$PLANS_DIR" ] && [ -d "$STAGING_DIR/claude-sessions" ]; then
  plan_files=$(find "$STAGING_DIR/claude-sessions" -name "*.jsonl" -type f -exec grep -ohE '\.claude/plans/[a-zA-Z0-9_-]+\.md' {} + 2>/dev/null | sed 's|.*/||' | sort -u || true)
  if [ -n "$plan_files" ]; then
    mkdir -p "$STAGING_DIR/claude-plans"
    echo "$plan_files" | while IFS= read -r plan_name; do
      [ -f "$PLANS_DIR/$plan_name" ] && cp "$PLANS_DIR/$plan_name" "$STAGING_DIR/claude-plans/"
    done
    PLAN_COUNT=$(echo "$plan_files" | wc -l | tr -d ' ')
  fi
fi

# 4c. Collect referenced debug files
DEBUG_COUNT=0
if [ -d "$DEBUG_DIR" ] && [ -d "$STAGING_DIR/claude-sessions" ]; then
  debug_files=$(find "$STAGING_DIR/claude-sessions" -name "*.jsonl" -type f -exec grep -ohE '\.claude/debug/[a-zA-Z0-9_-]+\.txt' {} + 2>/dev/null | sed 's|.*/||' | sort -u || true)
  if [ -n "$debug_files" ]; then
    mkdir -p "$STAGING_DIR/claude-debug"
    echo "$debug_files" | while IFS= read -r debug_name; do
      [ -f "$DEBUG_DIR/$debug_name" ] && cp "$DEBUG_DIR/$debug_name" "$STAGING_DIR/claude-debug/"
    done
    DEBUG_COUNT=$(echo "$debug_files" | wc -l | tr -d ' ')
  fi
fi

# 5. Copy untracked/changed files (excluding secrets)
LOOSE_COUNT=0
cd "$PROJECT_DIR"
{ git ls-files --others --exclude-standard 2>/dev/null; git diff --name-only HEAD 2>/dev/null; git diff --name-only --staged 2>/dev/null; } | sort -u | while IFS= read -r file; do
  base=$(basename "$file")
  case "$base" in .env|.env.*|*.key|*.pem|*.p12|*.pfx) continue ;; esac
  if [ -f "$PROJECT_DIR/$file" ]; then
    target_dir="$STAGING_DIR/untracked-files/$(dirname "$file")"
    mkdir -p "$target_dir"
    cp "$PROJECT_DIR/$file" "$target_dir/"
  fi
done
LOOSE_COUNT=$([ -d "$STAGING_DIR/untracked-files" ] && find "$STAGING_DIR/untracked-files" -type f | wc -l | tr -d ' ' || echo 0)

# 6. Zip everything in staging
cd "$STAGING_DIR"
zip -r -q "$ZIP_PATH" .

# 7. Report
ZIP_SIZE=$(du -sh "$ZIP_PATH" | cut -f1)
ITEM_COUNT=$(zipinfo -1 "$ZIP_PATH" 2>/dev/null | wc -l | tr -d ' ')
echo "BUILD_COMPLETE"
echo "ZIP_PATH=$ZIP_PATH"
echo "ZIP_NAME=$ZIP_NAME"
echo "ZIP_SIZE=$ZIP_SIZE"
echo "ITEM_COUNT=$ITEM_COUNT"
echo "SESSION_COUNT=$SESSION_COUNT"
echo "SUBAGENT_COUNT=$SUBAGENT_COUNT"
echo "PLAN_COUNT=$PLAN_COUNT"
echo "DEBUG_COUNT=$DEBUG_COUNT"
echo "LOOSE_COUNT=$LOOSE_COUNT"
echo "REDACTION_COUNT=$REDACTION_COUNT"
```

Run this as a single Bash command. Parse the output to extract the reported values.

### Step 3: Review Result

Use AskUserQuestion to let the user review the result.

The question should be: "Your vibe-share zip is ready! Want to review it?"
The header should be: "Done!"

Create three options:

**Option 1: "Looks good!"** with a preview showing:
```
CREATED: <zip_name>
SIZE:    <zip_size>

CONTENTS:
  1 git bundle (full history)
  1 file tree listing
  2 git snapshots (status + diff)
  <session_count> Claude Code sessions
  <subagent_count> subagent sessions
  <plan_count> plan files
  <debug_count> debug logs
  <loose_count> untracked/changed files

<if redaction_count > 0:>
SECRETS REDACTED (best effort):
  Detected and masked secrets in
  <redaction_count> session file(s).
  Pattern matching can't catch everything
  — review before sharing sensitive projects.

TO RESTORE THE PROJECT:
  unzip <zip_name>
  git clone repo.bundle .

REMINDER: Session transcripts may contain
secrets pasted during conversations.
Review before sharing with untrusted parties.
```

**Option 2: "Show me suspect files"** with a preview showing:
```
I'll search the zip for files with names
that could indicate secrets (key, token,
password, credential, .env, etc.)
```

**Option 3: "Delete zip and start over"** with a preview showing:
```
I'll delete the zip so you can adjust
and try again.
```

Handle each choice:
- "Looks good!" - Done! Tell the user where the zip is.
- "Show me suspect files" - Run: `zipinfo -1 "<zip_path>" | grep -iE 'secret|key|token|password|credential|\.env|\.pem|\.pfx|\.p12|private' || echo "No suspect files found!"`. Show results. Then ask again with just "Looks good!" and "Delete zip" options.
- "Delete zip and start over" - Delete the zip file with `rm "<zip_path>"` and tell the user they can run `/vibe-share` again.
