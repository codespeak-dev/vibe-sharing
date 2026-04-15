=============

So, we'll are building a command line tool to help the users share their vibe coded projects with us along with the claude code sessions they built them with.

General flow:
- run the tool in the proj dir
- if the dir is under git
  - find any untracked files to ask the user about
  - list all gitignored files to be excluded
- locate claude code sessions (usually in ~/.claude/projects/<dir name derived from project path>)
  - how can we identify the relevant dir beyond hard-coding the algorithm for its name?
  - if not .claude or sessions not found, ask the user what agent they used, and locate its sessions instead
  - when we don't know the layout, it's ok to let the user pick the directories, but we need to be helpful and suggest relevant options, e.g. grep for files containing relevant paths etc
- show the user the list of files to be shared
- ask their confirmation
- zip everything up, report progress and result to the user
- upload the zip file to our S3
  - what's the best secure way to do that?

The system has to be robust overall: if we fail with an exception, the user will not make an effort to fix it, they will just give up. And we need them to share their data!

Future directions
- support sessions from different agents better
- detect possibly sensitive data like secrets and personal info and warn the user about sharing them

==========

[CLAUDE ASKED]:
**Non-git**
What should happen when the project directory is not a git repo?
  - Require git (Recommended): Refuse to run if not a git repo. Vibe-coded projects almost always use git, and git gives us tracked/untracked/ignored classification for free.
  - Include all files: Walk the directory tree and include everything (minus common excludes like node_modules). Riskier — may grab huge or sensitive files.
  - Let user pick files: Show directory contents and let user checkbox which files/dirs to include. More flexible but more friction.
**Backend**
For the upload backend, what's the situation?
  - CLI only, stub upload: Build just the CLI now. Stub the upload step so it saves a local zip. Wire up real upload later when the backend exists.
  - Build backend too: Build a small backend (e.g. a Lambda or simple Express server) that generates presigned S3 URLs. Ship both CLI and backend.
  - Just local zip for now: Skip upload entirely for MVP. The tool produces a zip file the user can share manually (email, Slack, etc.).
**Other agents**
How should we handle non-Claude-Code agents in the initial version?
  - Browse fallback (Recommended): If Claude Code sessions aren't found, tell the user and let them manually pick directories containing session files to include. No agent-specific logic yet.
  - Support Cursor too: Also implement Cursor session discovery (need to research its storage format). More useful but more work upfront.
  - Claude Code only: Only support Claude Code. If sessions aren't found, just proceed without them. Simplest but may lose data from other agents.
**Language**
Is TypeScript + Node.js the right choice, or do you prefer something else?
  - TypeScript/Node.js (Recommended): Natural fit for CLI tools, rich ecosystem (commander, inquirer, ora, chalk), easy npm distribution, same language as Claude Code itself.
  - Python: Also good for CLIs (click, rich), but packaging/distribution is messier (pip, pipx, pyinstaller).
  - Go: Produces a single static binary (great for distribution), but less interactive prompt support and slower to iterate on.

==========

[USER ANSWERED]: User has answered your questions: "What should happen when the project directory is not a git repo?"="Guess common files to exclude: .venv, node_modules, .env.local etc + let the user customise the list", "For the upload backend, what's the situation?"="Plan the backend but have an option to easily just use the zip if the back-end is not available/disabled", "How should we handle non-Claude-Code agents in the initial version?"="Support common agents with sessions in the file system: Codex, gemini, and other popular ones. Cursor keeps sessions in sqlite, let's leave that for later. If no supported one has been used, offer to browse the file system", "Is TypeScript + Node.js the right choice, or do you prefer something else?"="TypeScript/Node.js (Recommended)". You can now continue with the user's answers in mind.

==========

Some additional considerations:

Support mac linux and windows
Make installation very-very easy, preferably no installation at all, as little as possible in terms of dependencies
inform the user of what we are going to do with emphasis on protecting their privacy and getting explicit consent before sharing anything
Advanced feature for later: use a sever-side agent with no write or destructive operations allowed to find te necessary data and make a list of files to be uploaded
Another thing for the future: if there is a gh repo, offer to share it (grant access), if not push the current state to a new repo on github under our org (specified in server-side config), and upload the session to it
  - this will probably allow to later upload updates of the user's project and their sessions

Security: Make sure no secrets of ours are downloaded to the user's machine

What do you think?
