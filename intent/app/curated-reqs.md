We're building a command line tool to help the users share their vibe coded projects with us along with the claude code sessions they built them with.

General flow:
- run the tool in the proj dir
- inform the user of what we are going to do with emphasis on protecting their privacy and getting explicit consent before sharing anything

- if the dir is under git, here's what we should share from the project dir:
  - git status > text file
  - git diff > text file
  - list of all files and directories (recursive) > text file
  - untracked files (excluding gitignored ones) -> untracked/ dir
  - git bundle --all

- locate claude code sessions (usually in ~/.claude/projects/<dir name derived from project path>)
  - finding the right dir
    - how can we identify the relevant dir beyond hard-coding the algorithm for its name?
  - when we don't know the layout, it's ok to let the user pick the directories, but we need to be helpful and suggest relevant options, e.g. grep for files containing relevant paths etc

- show the user the list of files to be shared
- ask their confirmation

- zip everything up, report progress and result to the user

- upload the zip file to our S3
  - what's the best secure way to do that?

The system has to be robust overall: if we fail with an exception, the user will not make an effort to fix it, they will just give up. And we need them to share their data!




- detect possibly sensitive data like secrets and personal info and warn the user about sharing them




- Guess common files to exclude: .venv, node_modules, .env.local etc + let the user customise the list
- Plan the backend but have an option to easily just use the zip if the back-end is not available/disabled
- Support common agents with sessions in the file system: Codex, gemini, and other popular ones. Cursor keeps sessions in sqlite, let's leave that for later. If no supported one has been used, offer to browse the file system
- TypeScript/Node.js (Recommended)



Some additional considerations:

Support mac linux and windows
Make installation very-very easy, preferably no installation at all, as little as possible in terms of dependencies
Advanced feature for later: use a sever-side agent with no write or destructive operations allowed to find te necessary data and make a list of files to be uploaded
Another thing for the future: if there is a gh repo, offer to share it (grant access), if not push the current state to a new repo on github under our org (specified in server-side config), and upload the session to it
  - this will probably allow to later upload updates of the user's project and their sessions

Security: Make sure no secrets of ours are downloaded to the user's machine

What do you think?




Change command to codespeak-vibe-share



- if no .claude or sessions not found, ask the user what agent they used, and locate its sessions instead
- support sessions from different agents better
