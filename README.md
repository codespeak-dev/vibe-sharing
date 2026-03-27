# codespeak-vibe-share

A CLI tool for sharing a vibe-coded project and its AI coding sessions with [CodeSpeak](https://codespeak.dev).
It packages the current Git repository (history, staged/unstaged diffs, and untracked files) together with sessions
from whichever AI coding tools it finds on the machine — Claude Code, Cursor, Gemini CLI, Codex, and Cline.
The result is a single zip archive uploaded to CodeSpeak's backend (AWS S3 via `vibe-share.codespeak.dev`).

**Usage:** `npx codespeak-vibe-share@latest`

Before scanning, the tool displays a privacy notice and asks for explicit consent twice:
* once before reading anything from disk
* once before uploading, showing the exact file count and size.

Agent session data is scanned for secrets (API keys, tokens, passwords, and similar patterns)
and those lines are stripped before packaging.

The collected metadata — file name, size, git remote URL, and optionally your name
and email — is stored in DynamoDB alongside the S3 object.

To request deletion of your data, contact [support@codespeak.dev](mailto:support@codespeak.dev)
