#!/usr/bin/env bash
# Build the browser bundle and copy it to the website repo.
# Usage: ./scripts/bundle-browser.sh [--website-dir <path>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BROWSER_DIR="$ROOT_DIR/browser"

# Default: website repo lives next to vibe-sharing
WEBSITE_DIR="$ROOT_DIR/../alpha2-demo-website"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --website-dir) WEBSITE_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ ! -d "$WEBSITE_DIR" ]]; then
  echo "Website directory not found: $WEBSITE_DIR"
  echo "Pass --website-dir <path> to specify the correct location."
  exit 1
fi

LIB_DIR="$WEBSITE_DIR/src/lib"
mkdir -p "$LIB_DIR"

echo "==> Installing browser package dependencies..."
cd "$BROWSER_DIR"
npm install

echo "==> Building browser bundle..."
npm run build

echo "==> Copying bundle to website..."
cp "$BROWSER_DIR/dist/vibe-sharing-browser.mjs"      "$LIB_DIR/vibe-sharing-browser.mjs"
cp "$BROWSER_DIR/dist/vibe-sharing-browser.mjs.map"  "$LIB_DIR/vibe-sharing-browser.mjs.map" 2>/dev/null || true
cp "$BROWSER_DIR/dist/vibe-sharing-browser.d.mts"    "$LIB_DIR/vibe-sharing-browser.d.ts"    2>/dev/null || true

echo ""
echo "Done. Bundle written to: $LIB_DIR/vibe-sharing-browser.mjs"
echo "sql.js WASM is loaded from jsDelivr CDN at runtime — no extra file to copy."
