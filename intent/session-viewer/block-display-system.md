# Session Viewer: Block Display System

## Goal

Create a system of UI idioms for how blocks are displayed in the sessions view to help users navigate conversation history effectively.

## Core Principles

- All information should be viewable (nothing truly hidden). 
  - For every message #N in the session, there must be a way to expand some blocks or groups to see it — no entry should be silently dropped by the grouping algorithm.
- Only important stuff should be visible by default
  - what's important should be configurable by the user
- Low-signal things shouldn't take much space on the screen by default

## Three Independent Dimensions

Every card (entry) has three independent properties. Each is controlled separately.

### 1. Logical Grouping

A card is either **standalone** (shown on its own at the top level) or **bunched** with logically related consecutive cards into a group.

Groups:
- **Tool call cycle** — a `tool_use` (assistant entry) + hooks (system entries) + `tool_result` (user entry). Multiple consecutive cycles form one group.
- **Progress run** — consecutive progress entries merged into ONE group, not many tiny ones. Should merge aggressively regardless of what other low-signal entries appear between them.
- **Queue operations** — similar low-signal grouping
- **File-history-snapshot** — similar low-signal grouping
- **Subagent call** — Agent tool_use + hooks + result, embedded as an expandable section or link to its own page

Standalone:
- User prompts
- Agent questions (AskUserQuestion) + answers
- Plans (Write/Edit to .claude/plans/)
- Assistant text responses
- Completion reports
- ExitPlanMode (separator/badge)

### 2. Card State (expanded / collapsed)

Each individual card can be **expanded** (showing full body with Rendered/JSON toggle) or **collapsed** (showing only the header line).

This is independent of grouping — a card inside a group can be expanded or collapsed.

Default card state depends on type:
- User prompts → expanded
- Plans → expanded
- Agent questions/answers → expanded
- Assistant text responses → expanded
- Everything else → collapsed

### 3. Card Visibility (top-level / inside collapsed group)

A card is either:
- **Top-level** — directly visible in the scroll
- **Inside a collapsed group** — only visible when the user expands the group

This applies only to grouped cards. The group itself has a collapsed/expanded state:
- Group collapsed → shows a summary line (e.g., "23 tool calls: Read(3) Bash(8)..."), cards inside are hidden
- Group expanded → cards inside become visible (each in their own expanded/collapsed state)

### Defaults by entry type

| Entry type | Grouping | Card state | Visibility |
|---|---|---|---|
| User prompt | standalone | expanded | top-level |
| Agent question + answer | standalone | expanded | top-level |
| Plan (Write/Edit) | standalone | expanded | top-level |
| Assistant text response | standalone | expanded | top-level |
| Completion report | standalone | expanded | top-level |
| ExitPlanMode | standalone (badge) | n/a | top-level |
| Tool call cycle | grouped | collapsed | inside collapsed group |
| Subagent call | grouped | collapsed | inside collapsed group |
| Progress | grouped | collapsed | inside collapsed group |
| Queue operation | grouped | collapsed | inside collapsed group |
| File-history-snapshot | grouped | collapsed | inside collapsed group |
| System/hooks | grouped (with tool cycle) | collapsed | inside collapsed group |
| Thinking-only assistant | grouped (with tool cycle) | collapsed | inside collapsed group |
| ai-title, last-prompt, misc | standalone | collapsed | top-level |

## Configurable Filter UI

A compact filter bar at the top of the session view.

### Per-tag controls
- A row of toggle-able tag pills, one per entry type / segment kind
- Each pill controls the defaults for that tag across the three dimensions:
  - **Card state** override: expanded ↔ collapsed
  - **Visibility** override: promote grouped cards to top-level, or demote standalone cards into their group
- Exact interaction design TBD — needs to be simple enough to use without explanation

### Global actions
- **Expand all** button — expands every block and group on the page
- **Re-apply filter** button — re-collapses everything back to the current filter settings (undoes manual expansions and "Expand all")
- **Reset to defaults** link — restores the default visibility tiers (undoes any per-tag overrides)

### Persistence
- Filter state stored in URL search params (e.g. `?show=user-prompt,plan&collapse=tool-cycle-group`) so it's shareable and survives refresh
- Also persisted to `localStorage` as the user's preference for next visit (URL params take precedence)

## Critical Constraint: Preserve EntryCard

The existing `EntryCard` component has carefully crafted features that MUST be preserved:
- Expand/collapse toggle with triangle indicator
- Line number display
- Type badge (color-coded: blue for user, green for assistant, amber for tool-result, etc.)
- Tool badges showing tool names and file paths / commands
- IDE tag badges
- Thinking preview
- Timestamp
- Rendered / JSON toggle (every block must have raw JSON view)
- Plan badge
- All existing header information

**Any new grouping system must use EntryCard as the block renderer.** New components should only add grouping wrappers around EntryCards, never replace them with stripped-down alternatives.
