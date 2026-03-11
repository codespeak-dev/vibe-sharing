# vibe-sharing

A Claude Code plugin that packages your project and Claude Code session transcripts into a shareable zip file.

Built for sharing vibe-coded projects — includes your code, full git history, and the Claude conversations that built it.

## Install

```bash
claude plugin install --from-github codespeak-dev/vibe-sharing
```

## Usage

In any project directory:

```
/vibe-share
```

The plugin walks you through an interactive flow:
1. **Preview** — shows what will be included/excluded and asks for your consent
2. **Build** — creates the zip
3. **Review** — lets you inspect the result, search for suspect files, or start over

## What's in the zip

| Content | Details |
|---------|---------|
| Source files | Full project tree (all tracked and untracked files) |
| Git history | `repo.bundle` — compact single-file repo clone |
| Git snapshots | `git-status.txt` and `git-diff.txt` at time of export |
| Claude sessions | All `.jsonl` session transcripts + memory for this project |

## What's excluded

| Category | Patterns |
|----------|----------|
| Secrets | `.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx` |
| Secret dirs | `.aws/`, `.ssh/` |
| Dependencies | `node_modules/`, `venv/`, `.venv/`, `__pycache__/` |
| Build output | `dist/`, `build/`, `.next/`, `.nuxt/`, `target/`, `vendor/` |
| OS junk | `.DS_Store`, `Thumbs.db` |

## Restoring a shared project

```bash
unzip vibe-share-my-project-20260311-143022.zip
cd my-project
git clone repo.bundle .
```

Session transcripts are in the `claude-sessions/` directory as `.jsonl` files.

## Security

Session transcripts (`.jsonl` files) may contain API keys, tokens, or credentials that were pasted during Claude Code conversations. The plugin warns you about this and lets you scan for suspect files before sharing.
