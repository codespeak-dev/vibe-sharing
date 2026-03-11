---
description: Package project files and Claude Code sessions into a shareable zip
allowed-tools: [Bash, AskUserQuestion]
---

# Vibe Share

You are packaging this project and its Claude Code sessions into a zip file for sharing.

## Context

Script location: !`find "$HOME/.claude/plugins" -path "*/vibe-sharing/scripts/vibe-share.sh" -print -quit 2>/dev/null`

Scan results: !`bash "$(find "$HOME/.claude/plugins" -path "*/vibe-sharing/scripts/vibe-share.sh" -print -quit 2>/dev/null)" --scan`

## Instructions

Follow this 3-step interactive flow. Use the scan results above to populate the previews.

### Step 1: Preview & Consent

Use AskUserQuestion to present a preview of what will be packaged. Parse the JSON scan results above and create a beautiful preview.

The question should be: "Ready to package your project for sharing?"
The header should be: "Vibe Share"

Create two options:

**Option 1: "Create zip"** with a preview showing:
```
PROJECT: <project_name>

WHAT'S GOING IN:
  Source files ............ <file_count> files
  Claude sessions ........ <session_count> transcripts
  Git history ............ 1 bundle (full repo history)
  Git status + diff ...... 2 snapshots

WHAT'S BEING EXCLUDED:
  <for each excluded dir with count > 0, show:>
  <dir_name>/ ............. <count> files skipped
  <for each secret file found, show:>
  <filename> .............. EXCLUDED (secret)

ESTIMATED SIZE: ~<estimated_size>
```

**Option 2: "Show full file list first"** with a preview showing:
```
I'll show you every file that would be
included before creating the zip.
```

If the user picks "Show full file list first":
1. Run the script with `--list` to get the full file list
2. Show them the list
3. Then ask the same question again (without the "Show full file list" option)

If the user picks "Create zip", proceed to Step 2.

### Step 2: Build

Run the script with `--build`:
```
bash "<script_path>" --build
```

Parse the output to find ZIP_PATH, ZIP_SIZE, SESSION_COUNT, FILE_COUNT.

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
  <file_count> files total
  <session_count> Claude Code sessions
  1 git bundle (full history)
  2 git snapshots (status + diff)

TO RESTORE GIT HISTORY:
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
exclusions and try again.
```

Handle each choice:
- "Looks good!" - Done! Tell the user where the zip is.
- "Show me suspect files" - Run the script with `--suspects <zip_path>`. Show the results. Then ask again with just "Looks good!" and "Delete zip" options.
- "Delete zip and start over" - Delete the zip file and tell the user they can run `/vibe-share` again.
