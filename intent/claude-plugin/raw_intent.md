==========

I need people to share their vibe coded projects with me alongside the claude code sessions they used to build the projects.

I want to build a plugin (or skill?) for claude code that people can easily install to help them with

- locating Claude Code sessions for the current project (in the ~/.claude folder usually)
- zipping them up along with the .git dir from the project and the full tree of all files + a git status file
- the point is to avoid zipping up anything that can contain user secrets and also not include things like node_modules or venv
- if the user has too many untracked/changed files, zip them up alongside the rest

What's the best way to make this and also how will people install it?

==========

[CLAUDE ASKED]:
**GitHub org**
What GitHub org/username should the plugin use in plugin.json and README install instructions?
  - codespeak: github.com/codespeak/vibe-sharing
  - abreslav: github.com/abreslav/vibe-sharing
**.git format**
The `.git` directory can be very large for repos with long history. Should we include it as-is, or use `git bundle` (a compact single-file representation of the full repo history)?
  - Full .git directory (Recommended): Exact copy - recipient can use the project as a normal git repo immediately
  - git bundle: Single file, more compact, but recipient needs to run `git clone repo.bundle` to restore
  - Both: Include .git dir AND a bundle file for flexibility
**Sessions**
Should the command include ALL sessions for the project, or let users pick specific ones?
  - All sessions (Recommended): Simpler - just grab everything for this project
  - Let user choose: Show a list of sessions with timestamps and let the user select which to include

==========

[USER ANSWERED]: User has answered your questions: "What GitHub org/username should the plugin use in plugin.json and README install instructions?"="org: github.com/codespeak-dev", "The `.git` directory can be very large for repos with long history. Should we include it as-is, or use `git bundle` (a compact single-file representation of the full repo history)?"="git bundle", "Should the command include ALL sessions for the project, or let users pick specific ones?"="All sessions (Recommended)". You can now continue with the user's answers in mind.
