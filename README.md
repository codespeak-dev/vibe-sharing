# vibe-sharing

A Claude Code plugin that packages your project and Claude Code session transcripts into a shareable zip file.

Built for sharing vibe-coded projects — includes your git history, the Claude conversations that built it, and any uncommitted work.

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
| `repo.bundle` | Git bundle — full repo history. Restore with `git clone repo.bundle .` |
| `file-tree.txt` | Text listing of ALL files on disk (including deps like node_modules) |
| `git-status.txt` | `git status` output at time of export |
| `git-diff.txt` | `git diff` (staged + unstaged) at time of export |
| `claude-sessions/` | Full project sessions directory: main transcripts, subagent transcripts, tool results, and memory |
| `claude-plans/` | Plan files from `~/.claude/plans/` referenced in the session transcripts |
| `untracked-files/` | Actual copies of untracked/changed files only (stuff git doesn't have) |

Source files are **not** copied directly — they're all in the git bundle. Only files that git doesn't have (untracked, modified) are copied as actual files.

## What's excluded

Secret files are never copied into the zip:

`.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`

Gitignored files (node_modules, venv, build output, etc.) are excluded automatically — they only appear in `file-tree.txt` as a listing.

## Restoring a shared project

```bash
unzip vibe-share-my-project-20260311-143022.zip
git clone repo.bundle my-project
cd my-project
# Untracked files are in untracked-files/ if you need them
```

Session transcripts are in the `claude-sessions/` directory — main sessions are top-level `.jsonl` files, subagent sessions are in `<session-id>/subagents/`. Plan files are in `claude-plans/`.

## Security

Session transcripts (`.jsonl` files) may contain API keys, tokens, or credentials that were pasted during Claude Code conversations. The plugin warns you about this and lets you scan for suspect files before sharing.
