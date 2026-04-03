Vibe Personality
================

Your vibe-coding personality test

# Raw metrics

A good metric is
- computable from available inputs
  - agent sessions & plans
  - code
  - git history
- either deterministic & numeric OR if it's not deterministic then it's qualitative
- interpretable: a given value can give the user a clear idea what it represents

## Candidate metrics

### Ratios/percentages

* Prompting Efficiency: ratio of prompts size to code changes generated
* Autonomy: time spent by agent after every prompt until blocking on waiting for user's input
* Impatience: how often does the user interrupt agent's actions (instances per time unit and per user messages)
* Agent Efficiency: how often agents' solutions are rejected/corrected
* % of choosing not the first option on questions/permissions
* overnight toil: how many sessions run into the night/are finished at the end of the day
* Purity of vibe coding/Getting hands dirty: what percentage of your code is written by agent

### Counts

* what days of the week you are vibe coding
  * what time of day (if time zone detectable)
* maxed out on your subscription limits
  * and how much time did you have to wait because of it
* what models are used
  * were they the latest at the time?
  * spend: what models, subscription/API key
* what style of permission management: skip all, confirm edits, etc
  * what permissions are auto-approved in settings.json (permissions.allow)
  * bravery: how you deal with permissions (always click yes?)
* how much grepping/globs does the agent do at the beginning of sessions
  * how much agents poke around in the code
* Multitasking/"ADHD index": how many sessions run in parallel (with interleaving user messages)
  * number of abandoned sessions (agent is still waiting for input)
* Toolkit: what features are used and how often: AGENTS.md, plan mode, worktrees, MCP, RAG, skills, hooks, subagents, etc
 - size of AGENTS.md
 - number of MCP servers and tools, utilisation per tool/server
 - number of skills and how often they are used
   * skill hoarder: how many of your tools/skills you are actually using
 - number of hooks and invocation counts
 - number of plugins, commands, subagents
 - inspect your configs and see what you are using
* session lengths in messages and time (measure of agentic autonomy)
* project sizes
* prompts size: writing essays in your prompts?
* how long have you been working on each project: in activity days, in calendar days (between first session and last)
* how much thinking does the agent do
* please/thank you/good job/swearwords/...
  * do you swear at the agent? do you say good job or thank you? do you address the agent as bro, bruh or dog? do you say lol? are you dumb? can we detect a rage quit?
* team vs solo (lone wolf/indy hacker)
* does the agent debug for you?
* power user: /compact, and other commands, etc
* paste a screenshot into the chat
* /btw
* afterthoughts: follow-up messages while the agent is still thinking
* IDE/print mode
* do you use git at all? do you have a remote on github


### Token counting

* how much you fill in your context
* number of tokens burnt

### Answering Agent's Questions

* Responsiveness: time to answer the AskUserQuestion or ExitPlanMode
* Review Diligence/thoughfulness: how often the user makes any comment on agents' plans
* Unpredictability/Originality: How often the user types custom responses to AskUserQuestion/ExitPlanMode

### Regex-like heuristics

* security mindset: secrets in agent sessions
* best practices: do the agents run tests, linters etc
* what languages your projects are in
* how often you commit? do you commit yourself or ask claude?
* have you tried to prompt-inject the agent
* "make no mistakes", "think extra hard", "ultrathink"
* are you using Boris Cherny's instructions, or Karpathy's?
* received "you are absolutely right"
* told the agent "you are absolutely right"


# Not so clear signals

* how long are agents waiting for the user's input (or it may be tool calls?)

# Qualitative analysis

* style of messages: more requirements-oriented or "micromanaging"
* are your prompts longer than the actual commands the agent runs?
* how often unrelated tasks are mixed in the same session
* how often the agents need guidance to discover bugs
* what routine tasks the user delegates to agents: generating tests, resolving merge conflicts, setup tasks, "manual" testing, research, etc
* asked agent to refactor, clean up vibe code, remove duplication
* delivery: have you deployed anything?
* OCD: correcting typos that don't change anything
* non-code topics: life advice, or non-work stuff
* paste screenshots of you own code
* have you tried to convince the model by reasoning with it, asking rhetorical questions, etc
* have you been refused a request because of guardrails
* have you tried to prompt-inject the agent
* "you could have googled that"
* spelling mistakes, grammar mistakes
* started over sessions: another session with a very similar prompt
* ultra-viber: almost no intent, all comes from model
* which parts of the project were difficult to get right


# --------

Achievements/badges


Misc
- names: 
  - vibe-caudit
  - Personality Vibes
  - vibe-soul