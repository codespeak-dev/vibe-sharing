#!/usr/bin/env bash
set -euo pipefail

# vibe-share.sh - Package project + Claude Code sessions into a zip
# This script is called by the /vibe-share command.
# It supports two modes:
#   --scan     Dry-run: output JSON summary of what would be included
#   --build    Actually create the zip
#   --review   List contents of an existing zip

MODE="${1:-}"
ZIP_ARG="${2:-}"

# --- Project detection ---
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

# --- Claude session directory ---
ENCODED_PATH=$(echo "$PROJECT_DIR" | sed 's|/|-|g')
SESSIONS_DIR="$HOME/.claude/projects/${ENCODED_PATH}"

# --- Exclusion patterns for find ---
EXCLUDE_PATTERNS=(
  -name ".env" -o -name ".env.*" -o -name ".env.local" -o -name ".env.production"
  -o -name "*.key" -o -name "*.pem" -o -name "*.p12" -o -name "*.pfx"
  -o -name ".DS_Store" -o -name "Thumbs.db"
  -o -name "vibe-share-*.zip"
)

EXCLUDE_DIRS=(
  -name "node_modules" -o -name "venv" -o -name ".venv" -o -name "__pycache__"
  -o -name "dist" -o -name "build" -o -name ".next" -o -name ".nuxt"
  -o -name "target" -o -name "vendor" -o -name ".git"
  -o -name ".aws" -o -name ".ssh"
  -o -name ".tox" -o -name ".eggs" -o -name "*.egg-info"
)

# Count files that would be included
count_project_files() {
  cd "$PROJECT_DIR"
  find . -type d \( "${EXCLUDE_DIRS[@]}" \) -prune -o \
    -type f ! \( "${EXCLUDE_PATTERNS[@]}" \) -print 2>/dev/null | wc -l | tr -d ' '
}

# List files that would be included
list_project_files() {
  cd "$PROJECT_DIR"
  find . -type d \( "${EXCLUDE_DIRS[@]}" \) -prune -o \
    -type f ! \( "${EXCLUDE_PATTERNS[@]}" \) -print 2>/dev/null | sort
}

# Count files that would be excluded (for reporting)
count_excluded_by_dir() {
  local dir_name="$1"
  cd "$PROJECT_DIR"
  if [ -d "$dir_name" ]; then
    find "$dir_name" -type f 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

# List secret files that exist (for warning)
list_secret_files() {
  cd "$PROJECT_DIR"
  find . -maxdepth 3 -type f \( \
    -name ".env" -o -name ".env.*" -o -name ".env.local" -o -name ".env.production" \
    -o -name "*.key" -o -name "*.pem" -o -name "*.p12" -o -name "*.pfx" \
  \) 2>/dev/null | sort
}

# Count sessions
count_sessions() {
  if [ -d "$SESSIONS_DIR" ]; then
    find "$SESSIONS_DIR" -maxdepth 1 -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

# Estimate total size of included files
estimate_size() {
  cd "$PROJECT_DIR"
  local project_size
  project_size=$(find . -type d \( "${EXCLUDE_DIRS[@]}" \) -prune -o \
    -type f ! \( "${EXCLUDE_PATTERNS[@]}" \) -print0 2>/dev/null | xargs -0 du -sc 2>/dev/null | tail -1 | cut -f1)

  local session_size=0
  if [ -d "$SESSIONS_DIR" ]; then
    session_size=$(du -sc "$SESSIONS_DIR"/*.jsonl 2>/dev/null | tail -1 | cut -f1 || echo "0")
  fi

  local git_bundle_size=0
  if [ -d "$PROJECT_DIR/.git" ]; then
    # Rough estimate: git bundle is usually close to .git/objects pack size
    git_bundle_size=$(du -sc "$PROJECT_DIR/.git" 2>/dev/null | tail -1 | cut -f1 || echo "0")
  fi

  echo $(( (project_size + session_size + git_bundle_size) ))
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
  file_count=$(count_project_files)
  session_count=$(count_sessions)
  secret_files=$(list_secret_files)
  estimated_kb=$(estimate_size)
  estimated_human=$(human_size "$estimated_kb")

  # Excluded dir counts
  node_modules_count=$(count_excluded_by_dir "node_modules")
  venv_count=$(count_excluded_by_dir "venv")
  dot_venv_count=$(count_excluded_by_dir ".venv")
  pycache_count=$(count_excluded_by_dir "__pycache__")
  dist_count=$(count_excluded_by_dir "dist")
  build_count=$(count_excluded_by_dir "build")
  next_count=$(count_excluded_by_dir ".next")
  target_count=$(count_excluded_by_dir "target")
  vendor_count=$(count_excluded_by_dir "vendor")

  has_git="false"
  [ -d "$PROJECT_DIR/.git" ] && has_git="true"

  has_memory="false"
  [ -d "$SESSIONS_DIR/memory" ] && has_memory="true"

  cat << ENDJSON
{
  "project_name": "$PROJECT_NAME",
  "project_dir": "$PROJECT_DIR",
  "file_count": $file_count,
  "session_count": $session_count,
  "has_git": $has_git,
  "has_memory": $has_memory,
  "estimated_size": "$estimated_human",
  "secret_files": "$(echo "$secret_files" | grep -v '^$' | tr '\n' '|')",
  "excluded": {
    "node_modules": $node_modules_count,
    "venv": $venv_count,
    ".venv": $dot_venv_count,
    "__pycache__": $pycache_count,
    "dist": $dist_count,
    "build": $build_count,
    ".next": $next_count,
    "target": $target_count,
    "vendor": $vendor_count
  }
}
ENDJSON

# =====================
# MODE: --list
# =====================
elif [ "$MODE" = "--list" ]; then
  list_project_files

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

  # 1. Git status and diff
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

  # 2. Git bundle
  if [ -d "$PROJECT_DIR/.git" ]; then
    echo "Creating git bundle (full history)..."
    git -C "$PROJECT_DIR" bundle create "$STAGING_DIR/repo.bundle" --all 2>/dev/null || true
    if [ -f "$STAGING_DIR/repo.bundle" ]; then
      bundle_size=$(du -sh "$STAGING_DIR/repo.bundle" | cut -f1)
      echo "  repo.bundle created ($bundle_size)"
    fi
  fi

  # 3. Copy sessions
  SESSION_COUNT=0
  if [ -d "$SESSIONS_DIR" ]; then
    mkdir -p "$STAGING_DIR/claude-sessions"
    for f in "$SESSIONS_DIR"/*.jsonl; do
      if [ -f "$f" ]; then
        cp "$f" "$STAGING_DIR/claude-sessions/"
        SESSION_COUNT=$((SESSION_COUNT + 1))
      fi
    done
    if [ -d "$SESSIONS_DIR/memory" ]; then
      cp -r "$SESSIONS_DIR/memory" "$STAGING_DIR/claude-sessions/memory"
    fi
    echo "  $SESSION_COUNT session file(s) copied"
  fi

  # 4. Zip project files (excluding secrets, deps, .git)
  echo "Zipping project files..."
  cd "$PROJECT_DIR"

  # Build exclude args for zip
  zip -r -q "$ZIP_PATH" . \
    -x ".git/*" \
    -x ".env" \
    -x ".env.*" \
    -x "*.key" \
    -x "*.pem" \
    -x "*.p12" \
    -x "*.pfx" \
    -x ".aws/*" \
    -x ".ssh/*" \
    -x "node_modules/*" \
    -x "*/node_modules/*" \
    -x "venv/*" \
    -x ".venv/*" \
    -x "*/__pycache__/*" \
    -x "dist/*" \
    -x "build/*" \
    -x ".next/*" \
    -x ".nuxt/*" \
    -x "target/*" \
    -x "vendor/*" \
    -x ".tox/*" \
    -x ".eggs/*" \
    -x "*.egg-info/*" \
    -x "*.DS_Store" \
    -x "Thumbs.db" \
    -x "vibe-share-*.zip"

  # 5. Add staging files to zip
  cd "$STAGING_DIR"
  zip -r -q -g "$ZIP_PATH" . 2>/dev/null || true

  # 6. Report
  ZIP_SIZE=$(du -sh "$ZIP_PATH" | cut -f1)
  FILE_COUNT=$(unzip -l "$ZIP_PATH" 2>/dev/null | tail -1 | awk '{print $2}')

  echo ""
  echo "BUILD_COMPLETE"
  echo "ZIP_PATH=$ZIP_PATH"
  echo "ZIP_NAME=$ZIP_NAME"
  echo "ZIP_SIZE=$ZIP_SIZE"
  echo "FILE_COUNT=$FILE_COUNT"
  echo "SESSION_COUNT=$SESSION_COUNT"

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
  unzip -l "$ZIP_ARG" | grep -iE 'secret|key|token|password|credential|\.env|\.pem|\.pfx|\.p12|private' || echo "No suspect files found!"

else
  echo "Usage: vibe-share.sh [--scan|--list|--build|--review <zip>|--suspects <zip>]"
  exit 1
fi
