#!/usr/bin/env bash
set -euo pipefail

# vibe-share.sh - Package project + Claude Code sessions into a zip
# Modes:
#   --scan       Dry-run: output JSON summary
#   --list       List untracked/changed files that would be copied
#   --build      Create the zip
#   --review     List contents of an existing zip
#   --suspects   Search zip for secret-like filenames

MODE="${1:-}"
ZIP_ARG="${2:-}"

# --- Project detection ---
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

# --- Claude session directory ---
ENCODED_PATH=$(echo "$PROJECT_DIR" | sed 's|/|-|g')
SESSIONS_DIR="$HOME/.claude/projects/${ENCODED_PATH}"
PLANS_DIR="$HOME/.claude/plans"
DEBUG_DIR="$HOME/.claude/debug"

# --- Secret file patterns (excluded from untracked file copies) ---
is_secret_file() {
  local file="$1"
  local base
  base=$(basename "$file")
  case "$base" in
    .env|.env.*|.env.local|.env.production|.env.development)
      return 0 ;;
    *.key|*.pem|*.p12|*.pfx)
      return 0 ;;
  esac
  return 1
}

# List untracked and modified files (not in git, or changed from HEAD)
# These are the files git doesn't fully have
list_loose_files() {
  cd "$PROJECT_DIR"
  # Untracked files (not gitignored)
  git ls-files --others --exclude-standard 2>/dev/null || true
  # Modified tracked files (working tree differs from HEAD)
  git diff --name-only HEAD 2>/dev/null || true
  # Staged changes
  git diff --name-only --staged 2>/dev/null || true
}

# Deduplicated, secret-filtered loose files
list_safe_loose_files() {
  list_loose_files | sort -u | while IFS= read -r file; do
    if [ -n "$file" ] && [ -f "$PROJECT_DIR/$file" ] && ! is_secret_file "$file"; then
      echo "$file"
    fi
  done
}

count_sessions() {
  if [ -d "$SESSIONS_DIR" ]; then
    # Count main sessions (top-level jsonl files only)
    find "$SESSIONS_DIR" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

count_subagent_sessions() {
  if [ -d "$SESSIONS_DIR" ]; then
    find "$SESSIONS_DIR" -path "*/subagents/*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

# Find plan files referenced in any session jsonl (including subagents)
# Searches for the full path pattern ".claude/plans/<name>" to avoid false positives
find_referenced_plans() {
  if [ ! -d "$SESSIONS_DIR" ] || [ ! -d "$PLANS_DIR" ]; then
    return
  fi
  # Extract all plan filenames actually referenced as paths in session transcripts
  find "$SESSIONS_DIR" -name "*.jsonl" -type f -exec \
    grep -ohE '\.claude/plans/[a-zA-Z0-9_-]+\.md' {} + 2>/dev/null \
    | sed 's|.*/||' | sort -u | while IFS= read -r plan_name; do
      [ -f "$PLANS_DIR/$plan_name" ] && echo "$plan_name"
    done
}

# Find debug files referenced in any session jsonl (including subagents)
find_referenced_debug_files() {
  if [ ! -d "$SESSIONS_DIR" ] || [ ! -d "$DEBUG_DIR" ]; then
    return
  fi
  find "$SESSIONS_DIR" -name "*.jsonl" -type f -exec \
    grep -ohE '\.claude/debug/[a-zA-Z0-9_-]+\.txt' {} + 2>/dev/null \
    | sed 's|.*/||' | sort -u | while IFS= read -r debug_name; do
      [ -f "$DEBUG_DIR/$debug_name" ] && echo "$debug_name"
    done
}

list_secret_files() {
  cd "$PROJECT_DIR"
  find . -maxdepth 3 -type f \( \
    -name ".env" -o -name ".env.*" -o -name ".env.local" -o -name ".env.production" \
    -o -name "*.key" -o -name "*.pem" -o -name "*.p12" -o -name "*.pfx" \
  \) 2>/dev/null | sort
}

human_size() {
  local kb=$1
  if [ "$kb" -gt 1048576 ]; then
    echo "$(( kb / 1048576 )) GB"
  elif [ "$kb" -gt 1024 ]; then
    echo "$(( kb / 1024 )) MB"
  else
    echo "${kb} KB"
  fi
}

# =====================
# MODE: --scan
# =====================
if [ "$MODE" = "--scan" ]; then
  session_count=$(count_sessions)
  subagent_count=$(count_subagent_sessions)
  secret_files=$(list_secret_files)
  loose_files=$(list_safe_loose_files)
  loose_count=$(echo "$loose_files" | grep -c . || echo "0")
  plan_files=$(find_referenced_plans)
  plan_count=$(echo "$plan_files" | grep -c . || echo "0")
  debug_files=$(find_referenced_debug_files)
  debug_count=$(echo "$debug_files" | grep -c . || echo "0")

  has_git="false"
  [ -d "$PROJECT_DIR/.git" ] && has_git="true"

  has_memory="false"
  [ -d "$SESSIONS_DIR/memory" ] && has_memory="true"

  # Estimate size (entire sessions dir, not just top-level jsonl)
  git_bundle_kb=0
  if [ -d "$PROJECT_DIR/.git" ]; then
    git_bundle_kb=$(du -sc "$PROJECT_DIR/.git" 2>/dev/null | tail -1 | cut -f1 || echo "0")
  fi
  session_kb=0
  if [ -d "$SESSIONS_DIR" ]; then
    session_kb=$(du -sc "$SESSIONS_DIR" 2>/dev/null | tail -1 | cut -f1 || echo "0")
  fi
  loose_kb=0
  if [ -n "$loose_files" ]; then
    loose_kb=$(echo "$loose_files" | while IFS= read -r f; do [ -f "$PROJECT_DIR/$f" ] && echo "$PROJECT_DIR/$f"; done | xargs du -sc 2>/dev/null | tail -1 | cut -f1 || echo "0")
  fi
  estimated_human=$(human_size $(( git_bundle_kb + session_kb + loose_kb )))

  cat << ENDJSON
{
  "project_name": "$PROJECT_NAME",
  "project_dir": "$PROJECT_DIR",
  "session_count": $session_count,
  "subagent_count": $subagent_count,
  "plan_count": $plan_count,
  "debug_count": $debug_count,
  "loose_file_count": $loose_count,
  "has_git": $has_git,
  "has_memory": $has_memory,
  "estimated_size": "$estimated_human",
  "secret_files": "$(echo "$secret_files" | grep -v '^$' | tr '\n' '|')"
}
ENDJSON

# =====================
# MODE: --list
# =====================
elif [ "$MODE" = "--list" ]; then
  list_safe_loose_files

# =====================
# MODE: --build
# =====================
elif [ "$MODE" = "--build" ]; then
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  ZIP_NAME="vibe-share-${PROJECT_NAME}-${TIMESTAMP}.zip"
  ZIP_PATH="${PROJECT_DIR}/${ZIP_NAME}"

  STAGING_DIR=$(mktemp -d)
  trap 'rm -rf "$STAGING_DIR"' EXIT

  echo "Creating staging area..."

  # 1. Full file tree listing (ALL files on disk, including deps)
  cd "$PROJECT_DIR"
  find . -not -path './.git/*' 2>/dev/null | sort > "$STAGING_DIR/file-tree.txt"
  echo "  file-tree.txt created ($(wc -l < "$STAGING_DIR/file-tree.txt") entries)"

  # 2. Git status and diff
  if [ -d "$PROJECT_DIR/.git" ]; then
    git -C "$PROJECT_DIR" status > "$STAGING_DIR/git-status.txt" 2>&1 || true
    {
      echo "=== Unstaged changes ==="
      git -C "$PROJECT_DIR" diff 2>&1 || true
      echo ""
      echo "=== Staged changes ==="
      git -C "$PROJECT_DIR" diff --staged 2>&1 || true
    } > "$STAGING_DIR/git-diff.txt"
    echo "  git-status.txt and git-diff.txt captured"
  fi

  # 3. Git bundle
  if [ -d "$PROJECT_DIR/.git" ]; then
    echo "Creating git bundle (full history)..."
    git -C "$PROJECT_DIR" bundle create "$STAGING_DIR/repo.bundle" --all 2>/dev/null || true
    if [ -f "$STAGING_DIR/repo.bundle" ]; then
      bundle_size=$(du -sh "$STAGING_DIR/repo.bundle" | cut -f1)
      echo "  repo.bundle created ($bundle_size)"
    fi
  fi

  # 4. Copy entire sessions directory (includes subagents, tool-results, memory)
  SESSION_COUNT=0
  SUBAGENT_COUNT=0
  REDACTION_COUNT=0
  if [ -d "$SESSIONS_DIR" ]; then
    # Copy the whole directory tree — this gets sessions, subagents, tool-results, memory, meta files
    cp -r "$SESSIONS_DIR" "$STAGING_DIR/claude-sessions"
    SESSION_COUNT=$(find "$STAGING_DIR/claude-sessions" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
    SUBAGENT_COUNT=$(find "$STAGING_DIR/claude-sessions" -path "*/subagents/*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "  $SESSION_COUNT session(s) + $SUBAGENT_COUNT subagent session(s) copied"

    # Redact secrets in ALL copied jsonl files — sessions AND subagents (best effort)
    echo "  Scanning all transcripts for secrets (best effort)..."
    find "$STAGING_DIR/claude-sessions" -name "*.jsonl" -type f | while IFS= read -r f; do
      before=$(wc -c < "$f")

      # API keys: OpenAI, Anthropic, AWS, Google, Stripe, GitHub, GitLab, Slack
      sed -i.bak -E 's/(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]{16,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(AKIA[A-Z0-9]{4})[A-Z0-9]{12,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(AIza[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]{31,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(sk_live_[a-zA-Z0-9]{4})[a-zA-Z0-9]{20,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(rk_live_[a-zA-Z0-9]{4})[a-zA-Z0-9]{20,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(ghp_[a-zA-Z0-9]{4})[a-zA-Z0-9]{32,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(glpat-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]{16,}/\1***REDACTED***/g' "$f"
      sed -i.bak -E 's/(xox[bpors]-[a-zA-Z0-9-]{4})[a-zA-Z0-9-]{6,}/\1***REDACTED***/g' "$f"

      # Private keys
      sed -i.bak -E 's/(BEGIN[[:space:]]+(RSA|DSA|EC|OPENSSH)?[[:space:]]*PRIVATE[[:space:]]+KEY)/\1 ***REDACTED***/g' "$f"

      # Connection strings with credentials (redact the password part)
      sed -i.bak -E 's#((postgresql|mysql|mongodb|redis|amqp)://[^:]*:)[^@]*(@)#\1***REDACTED***\3#g' "$f"

      # Bearer tokens
      sed -i.bak -E 's/(Bearer[[:space:]]+[a-zA-Z0-9_.-]{4})[a-zA-Z0-9_.-]{16,}/\1***REDACTED***/g' "$f"

      after=$(wc -c < "$f")
      if [ "$before" != "$after" ]; then
        REDACTION_COUNT=$((REDACTION_COUNT + 1))
      fi

      rm -f "$f.bak"
    done
    if [ "$REDACTION_COUNT" -gt 0 ]; then
      echo "  Redacted secrets in $REDACTION_COUNT transcript file(s)"
    else
      echo "  No secrets detected in transcripts"
    fi
  fi

  # 4b. Collect referenced plan files
  PLAN_COUNT=0
  if [ -d "$PLANS_DIR" ] && [ -d "$STAGING_DIR/claude-sessions" ]; then
    echo "  Scanning for referenced plan files..."
    plan_files=$(find_referenced_plans)
    if [ -n "$plan_files" ]; then
      mkdir -p "$STAGING_DIR/claude-plans"
      echo "$plan_files" | while IFS= read -r plan_name; do
        if [ -f "$PLANS_DIR/$plan_name" ]; then
          cp "$PLANS_DIR/$plan_name" "$STAGING_DIR/claude-plans/"
        fi
      done
      PLAN_COUNT=$(echo "$plan_files" | wc -l | tr -d ' ')
      echo "  $PLAN_COUNT plan file(s) copied"
    else
      echo "  No referenced plan files found"
    fi
  fi

  # 4c. Collect referenced debug files
  DEBUG_COUNT=0
  if [ -d "$DEBUG_DIR" ] && [ -d "$STAGING_DIR/claude-sessions" ]; then
    echo "  Scanning for referenced debug logs..."
    debug_files=$(find_referenced_debug_files)
    if [ -n "$debug_files" ]; then
      mkdir -p "$STAGING_DIR/claude-debug"
      echo "$debug_files" | while IFS= read -r debug_name; do
        if [ -f "$DEBUG_DIR/$debug_name" ]; then
          cp "$DEBUG_DIR/$debug_name" "$STAGING_DIR/claude-debug/"
        fi
      done
      DEBUG_COUNT=$(echo "$debug_files" | wc -l | tr -d ' ')
      echo "  $DEBUG_COUNT debug log(s) copied"
    else
      echo "  No referenced debug logs found"
    fi
  fi

  # 5. Copy untracked/changed files (excluding secrets)
  LOOSE_COUNT=0
  loose_files=$(list_safe_loose_files)
  if [ -n "$loose_files" ]; then
    mkdir -p "$STAGING_DIR/untracked-files"
    echo "$loose_files" | while IFS= read -r file; do
      if [ -f "$PROJECT_DIR/$file" ]; then
        target_dir="$STAGING_DIR/untracked-files/$(dirname "$file")"
        mkdir -p "$target_dir"
        cp "$PROJECT_DIR/$file" "$target_dir/"
      fi
    done
    LOOSE_COUNT=$(echo "$loose_files" | wc -l | tr -d ' ')
    echo "  $LOOSE_COUNT untracked/changed file(s) copied"
  fi

  # 6. Zip everything in staging
  cd "$STAGING_DIR"
  zip -r -q "$ZIP_PATH" . 2>/dev/null

  # 7. Report
  ZIP_SIZE=$(du -sh "$ZIP_PATH" | cut -f1)
  ITEM_COUNT=$(zipinfo -1 "$ZIP_PATH" 2>/dev/null | wc -l | tr -d ' ')

  echo ""
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

# =====================
# MODE: --review
# =====================
elif [ "$MODE" = "--review" ]; then
  if [ -z "$ZIP_ARG" ]; then
    echo "ERROR: --review requires a zip path"
    exit 1
  fi
  zipinfo -1 "$ZIP_ARG" 2>/dev/null | sort

# =====================
# MODE: --suspects
# =====================
elif [ "$MODE" = "--suspects" ]; then
  if [ -z "$ZIP_ARG" ]; then
    echo "ERROR: --suspects requires a zip path"
    exit 1
  fi
  zipinfo -1 "$ZIP_ARG" | grep -iE 'secret|key|token|password|credential|\.env|\.pem|\.pfx|\.p12|private' || echo "No suspect files found!"

# =====================
# MODE: --scan-sessions
# =====================
elif [ "$MODE" = "--scan-sessions" ]; then
  if [ ! -d "$SESSIONS_DIR" ]; then
    echo "No sessions found."
    exit 0
  fi

  # Patterns that commonly indicate secrets in conversation transcripts
  # Organized by category for clear reporting
  found=0
  # Scan ALL jsonl files: main sessions AND subagent sessions
  while IFS= read -r f; do
    session_name=$(echo "$f" | sed "s|$SESSIONS_DIR/||")

    # API keys (OpenAI, Anthropic, AWS, Google, Stripe, etc.)
    matches=$(grep -noE '(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[a-zA-Z0-9_-]{35}|sk_live_[a-zA-Z0-9]{24,}|rk_live_[a-zA-Z0-9]{24,}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,}|xox[bpors]-[a-zA-Z0-9-]{10,})' "$f" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      echo "API_KEY|$session_name|$(echo "$matches" | head -5)"
      found=$((found + 1))
    fi

    # Private keys
    matches=$(grep -nc 'BEGIN.*PRIVATE KEY' "$f" 2>/dev/null || true)
    if [ "$matches" -gt 0 ]; then
      echo "PRIVATE_KEY|$session_name|$matches occurrence(s)"
      found=$((found + 1))
    fi

    # Connection strings with credentials
    matches=$(grep -noE '(postgresql|mysql|mongodb|redis|amqp)://[^"[:space:]]*:[^"[:space:]]*@' "$f" 2>/dev/null | head -3 || true)
    if [ -n "$matches" ]; then
      echo "CONNECTION_STRING|$session_name|$(echo "$matches" | wc -l | tr -d ' ') occurrence(s)"
      found=$((found + 1))
    fi

    # Bearer tokens
    matches=$(grep -noEi 'bearer [a-zA-Z0-9_.-]{20,}' "$f" 2>/dev/null | head -3 || true)
    if [ -n "$matches" ]; then
      echo "BEARER_TOKEN|$session_name|$(echo "$matches" | wc -l | tr -d ' ') occurrence(s)"
      found=$((found + 1))
    fi

    # Generic secret assignments (password=, secret_key=, api_key=, etc.)
    matches=$(grep -noEi '(password|passwd|secret_key|api_key|api_secret|access_token|auth_token)[[:space:]]*[=:][[:space:]]*["\x27]?[a-zA-Z0-9_/.+=-]{8,}' "$f" 2>/dev/null | head -5 || true)
    if [ -n "$matches" ]; then
      echo "SECRET_ASSIGNMENT|$session_name|$(echo "$matches" | wc -l | tr -d ' ') occurrence(s)"
      found=$((found + 1))
    fi
  done < <(find "$SESSIONS_DIR" -name "*.jsonl" -type f)

  if [ "$found" -eq 0 ]; then
    echo "NO_SUSPECTS_FOUND"
  else
    echo ""
    echo "TOTAL_SUSPECTS=$found"
  fi

else
  echo "Usage: vibe-share.sh [--scan|--list|--build|--review <zip>|--suspects <zip>|--scan-sessions]"
  exit 1
fi
