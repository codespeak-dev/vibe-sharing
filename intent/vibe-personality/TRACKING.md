# Vibe Personality — Metric Tracking

Status legend: ⬜ Not started | 📋 Planning | 🔨 Implementing | 🧪 Testing | ✅ Done

## Ratios/Percentages

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Prompting Efficiency | Ratio of prompt size to code changes generated | [plan](metrics/prompting-efficiency.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Prompting%20Efficiency%20%28prompting-efficiency.md%29) |
| ⬜ | Autonomy | Time spent by agent after every prompt until blocking on user input | [plan](metrics/autonomy.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Autonomy%20%28autonomy.md%29) |
| ⬜ | Impatience | How often the user interrupts agent's actions (per time unit and per user messages) | [plan](metrics/impatience.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Impatience%20%28impatience.md%29) |
| ⬜ | Agent Efficiency | How often agents' solutions are rejected/corrected | [plan](metrics/agent-efficiency.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Agent%20Efficiency%20%28agent-efficiency.md%29) |
| ⬜ | Non-Default Choices | % of choosing not the first option on questions/permissions | [plan](metrics/non-default-choices.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Non-Default%20Choices%20%28non-default-choices.md%29) |
| ⬜ | Overnight Toil | How many sessions run into the night / are finished at end of day | [plan](metrics/overnight-toil.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Overnight%20Toil%20%28overnight-toil.md%29) |
| ⬜ | Vibe Purity | What percentage of your code is written by agent (purity of vibe coding / getting hands dirty) | [plan](metrics/vibe-purity.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Vibe%20Purity%20%28vibe-purity.md%29) |

## Counts

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Coding Schedule | What days of the week / time of day you vibe code (if timezone detectable) | [plan](metrics/coding-schedule.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Coding%20Schedule%20%28coding-schedule.md%29) |
| ⬜ | Subscription Limits | Maxed out on subscription limits; how much time waiting because of it | [plan](metrics/subscription-limits.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Subscription%20Limits%20%28subscription-limits.md%29) |
| ⬜ | Models Used | What models are used; were they latest at the time; subscription vs API key spend | [plan](metrics/models-used.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Models%20Used%20%28models-used.md%29) |
| ⬜ | Permission Style | Permission management style (skip all, confirm edits, etc); auto-approved settings; bravery (always click yes?) | [plan](metrics/permission-style.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Permission%20Style%20%28permission-style.md%29) |
| ⬜ | Initial Exploration | How much grepping/globs agent does at beginning of sessions; how much agents poke around in the code | [plan](metrics/initial-exploration.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Initial%20Exploration%20%28initial-exploration.md%29) |
| ⬜ | Multitasking | "ADHD index": how many sessions run in parallel (interleaving user messages); number of abandoned sessions | [plan](metrics/multitasking.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Multitasking%20%28multitasking.md%29) |
| ⬜ | Toolkit Usage | Features used and how often: AGENTS.md, plan mode, worktrees, MCP, skills, hooks, subagents; size of configs; skill hoarder ratio | [plan](metrics/toolkit-usage.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Toolkit%20Usage%20%28toolkit-usage.md%29) |
| ⬜ | Session Lengths | Session lengths in messages and time (measure of agentic autonomy) | [plan](metrics/session-lengths.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Session%20Lengths%20%28session-lengths.md%29) |
| ⬜ | Project Sizes | Project sizes | [plan](metrics/project-sizes.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Project%20Sizes%20%28project-sizes.md%29) |
| ⬜ | Prompt Sizes | Writing essays in your prompts? | [plan](metrics/prompt-sizes.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Prompt%20Sizes%20%28prompt-sizes.md%29) |
| ⬜ | Project Duration | How long working on each project: in activity days, in calendar days (first session to last) | [plan](metrics/project-duration.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Project%20Duration%20%28project-duration.md%29) |
| ⬜ | Agent Thinking | How much thinking does the agent do | [plan](metrics/agent-thinking.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Agent%20Thinking%20%28agent-thinking.md%29) |
| ⬜ | Politeness & Tone | Please/thank you/good job/swearwords; addressing agent as bro/bruh/dog; lol; rage quit detection | [plan](metrics/politeness.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Politeness%20%26%20Tone%20%28politeness.md%29) |
| ⬜ | Team vs Solo | Team vs solo (lone wolf / indy hacker) | [plan](metrics/team-vs-solo.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Team%20vs%20Solo%20%28team-vs-solo.md%29) |
| ⬜ | Agent Debugging | Does the agent debug for you? | [plan](metrics/agent-debugging.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Agent%20Debugging%20%28agent-debugging.md%29) |
| ⬜ | Power User | /compact and other commands usage | [plan](metrics/power-user.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Power%20User%20%28power-user.md%29) |
| ⬜ | Screenshot Usage | Paste a screenshot into the chat | [plan](metrics/screenshot-usage.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Screenshot%20Usage%20%28screenshot-usage.md%29) |
| ⬜ | /btw Usage | /btw command usage | [plan](metrics/btw-usage.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20btw%20Usage%20%28btw-usage.md%29) |
| ⬜ | Afterthoughts | Follow-up messages while the agent is still thinking | [plan](metrics/afterthoughts.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Afterthoughts%20%28afterthoughts.md%29) |
| ⬜ | IDE/Print Mode | IDE vs print mode usage | [plan](metrics/ide-mode.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20IDE%20Print%20Mode%20%28ide-mode.md%29) |
| ⬜ | Git Usage | Do you use git at all? Do you have a remote on GitHub? | [plan](metrics/git-usage.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Git%20Usage%20%28git-usage.md%29) |

## Token Counting

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Context Fill | How much you fill in your context | [plan](metrics/context-fill.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Context%20Fill%20%28context-fill.md%29) |
| ⬜ | Tokens Burnt | Number of tokens burnt | [plan](metrics/tokens-burnt.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Tokens%20Burnt%20%28tokens-burnt.md%29) |

## Answering Agent's Questions

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Responsiveness | Time to answer AskUserQuestion or ExitPlanMode | [plan](metrics/responsiveness.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Responsiveness%20%28responsiveness.md%29) |
| ⬜ | Review Diligence | How often the user makes any comment on agents' plans | [plan](metrics/review-diligence.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Review%20Diligence%20%28review-diligence.md%29) |
| ⬜ | Originality | How often the user types custom responses to AskUserQuestion/ExitPlanMode | [plan](metrics/originality.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Originality%20%28originality.md%29) |

## Regex-like Heuristics

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Security Mindset | Secrets in agent sessions | [plan](metrics/security-mindset.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Security%20Mindset%20%28security-mindset.md%29) |
| ⬜ | Best Practices | Do the agents run tests, linters, etc | [plan](metrics/best-practices.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Best%20Practices%20%28best-practices.md%29) |
| ⬜ | Languages | What languages your projects are in | [plan](metrics/languages.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Languages%20%28languages.md%29) |
| ⬜ | Commit Frequency | How often you commit; do you commit yourself or ask Claude? | [plan](metrics/commit-frequency.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Commit%20Frequency%20%28commit-frequency.md%29) |
| ⬜ | Prompt Injection | Have you tried to prompt-inject the agent | [plan](metrics/prompt-injection.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Prompt%20Injection%20%28prompt-injection.md%29) |
| ⬜ | Ultrathink Phrases | "make no mistakes", "think extra hard", "ultrathink" | [plan](metrics/ultrathink.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Ultrathink%20Phrases%20%28ultrathink.md%29) |
| ⬜ | Famous Instructions | Are you using Boris Cherny's instructions, or Karpathy's? | [plan](metrics/famous-instructions.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Famous%20Instructions%20%28famous-instructions.md%29) |
| ⬜ | Received "Absolutely Right" | Agent told you "you are absolutely right" | [plan](metrics/received-absolutely-right.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Received%20Absolutely%20Right%20%28received-absolutely-right.md%29) |
| ⬜ | Told "Absolutely Right" | You told the agent "you are absolutely right" | [plan](metrics/told-absolutely-right.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Told%20Absolutely%20Right%20%28told-absolutely-right.md%29) |

## Qualitative Analysis

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | Message Style | Style of messages: more requirements-oriented or "micromanaging" | [plan](metrics/message-style.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Message%20Style%20%28message-style.md%29) |
| ⬜ | Prompts vs Commands | Are your prompts longer than the actual commands the agent runs? | [plan](metrics/prompts-vs-commands.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Prompts%20vs%20Commands%20%28prompts-vs-commands.md%29) |
| ⬜ | Task Mixing | How often unrelated tasks are mixed in the same session | [plan](metrics/task-mixing.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Task%20Mixing%20%28task-mixing.md%29) |
| ⬜ | Agent Guidance | How often agents need guidance to discover bugs | [plan](metrics/agent-guidance.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Agent%20Guidance%20%28agent-guidance.md%29) |
| ⬜ | Routine Delegation | Routine tasks delegated: tests, merge conflicts, setup, "manual" testing, research, etc | [plan](metrics/routine-delegation.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Routine%20Delegation%20%28routine-delegation.md%29) |
| ⬜ | Refactoring Requests | Asked agent to refactor, clean up vibe code, remove duplication | [plan](metrics/refactoring-requests.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Refactoring%20Requests%20%28refactoring-requests.md%29) |
| ⬜ | Delivery | Have you deployed anything? | [plan](metrics/delivery.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Delivery%20%28delivery.md%29) |
| ⬜ | OCD Typo Corrections | Correcting typos that don't change anything | [plan](metrics/ocd-typos.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20OCD%20Typo%20Corrections%20%28ocd-typos.md%29) |
| ⬜ | Non-Code Topics | Life advice, or non-work stuff | [plan](metrics/non-code-topics.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Non-Code%20Topics%20%28non-code-topics.md%29) |
| ⬜ | Own Code Screenshots | Paste screenshots of your own code | [plan](metrics/own-code-screenshots.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Own%20Code%20Screenshots%20%28own-code-screenshots.md%29) |
| ⬜ | Reasoning with Model | Tried to convince the model by reasoning, asking rhetorical questions, etc | [plan](metrics/reasoning-with-model.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Reasoning%20with%20Model%20%28reasoning-with-model.md%29) |
| ⬜ | Guardrail Refusals | Been refused a request because of guardrails | [plan](metrics/guardrail-refusals.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Guardrail%20Refusals%20%28guardrail-refusals.md%29) |
| ⬜ | Could Have Googled | "You could have googled that" | [plan](metrics/could-have-googled.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Could%20Have%20Googled%20%28could-have-googled.md%29) |
| ⬜ | Spelling & Grammar | Spelling mistakes, grammar mistakes in user prompts | [plan](metrics/spelling-grammar.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Spelling%20%26%20Grammar%20%28spelling-grammar.md%29) |
| ⬜ | Started Over | Another session with a very similar prompt (started over) | [plan](metrics/started-over.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Started%20Over%20%28started-over.md%29) |
| ⬜ | Ultra-Viber | Almost no intent, all comes from model | [plan](metrics/ultra-viber.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Ultra-Viber%20%28ultra-viber.md%29) |
| ⬜ | Difficult Parts | Which parts of the project were difficult to get right | [plan](metrics/difficult-parts.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20Difficult%20Parts%20%28difficult-parts.md%29) |

## Not So Clear Signals

| Status | Metric | Description | Plan | Next |
|--------|--------|-------------|------|------|
| ⬜ | User Wait Time | How long agents wait for user input (or may be tool calls?) | [plan](metrics/user-wait-time.md) | [▶ Plan](cursor://anthropic.claude-code/open?prompt=Read%20and%20follow%20intent%2Fvibe-personality%2Fprompts%2Fplan.md%20for%20metric%3A%20User%20Wait%20Time%20%28user-wait-time.md%29) |
