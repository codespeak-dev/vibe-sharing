I need people to share their vibe coded projects with me alongside the claude code sessions they used to build the projects.

I want to build a plugin (or skill?) for claude code that people can easily install to help them with

- locating Claude Code sessions for the current project (in the ~/.claude folder usually)
- zipping them up along with the .git dir from the project and the full tree of all files + a git status file
- the point is to avoid zipping up anything that can contain user secrets and also not include things like node_modules or venv
- if the user has too many untracked/changed files, zip them up alongside the rest

What's the best way to make this and also how will people install it?


- org: github.com/codespeak-dev
- git bundle
- All sessions (Recommended)


Add a beautiful message for the user at the beginning exlpaining what's going to happen and emphasising that we are trying to avoid sharing their secrets and they can review everything. At the end, make it very easy for them to review what's zipped

Make messages look really nice. Can we use built-in tools for that? Maybe ask user consent with AskUserQuesiton?


!!! file-tree.txt: I see where the confusion is coming from. What I mean was adding a text file with the full recursive tree of all files in the projects, not the files themselves

- untracked/changed files + yes, but only copies of files that don't contain secrets

There's no nice message in the beginning explaining to the user that we care about their secrets

Can we scan the sessions for secrets?


It's suspicious that I'm not seeing any subagent sessions. are you actually bundling up the entire .claude/project/<...> folder? I think you aren't and this is not what I asked you to do

Also, let's make sure we copy all the plans from .claude/plans that are mentioned ANYWHERE in the sessions for this project (including subagents). 

Can we also pick up the debug sessions?


Do sessions refer to debug files?


- report user name (from git config, i think)