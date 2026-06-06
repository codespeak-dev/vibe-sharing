# Session Viewer: Block Display System

## Goal

Create a system of UI idioms for how blocks are displayed in the sessions view to help users navigate conversation history effectively.

## Core Principles

- All information should be viewable (nothing truly hidden).
  - For every message #N in the session, there must be a way to expand some blocks or groups to see it — no entry should be silently dropped by the grouping algorithm.
- Only important stuff should be visible by default
  - what's important should be configurable by the user
- Low-signal things shouldn't take much space on the screen by default

## Three Layers (computed in order)

### Layer 1: Individual Card State
Each entry gets a default **expanded** or **collapsed** state.

- Expanded by default: user prompts, assistant text responses, plans, agent questions + answers
- Collapsed by default: everything else

### Layer 2: Topical Grouping
Consecutive related cards are grouped into a collapsible unit with a summary header.

- **Tool call run** — consecutive tool_use + tool_result + system hooks + thinking-only entries
- **Noise run** — consecutive progress + queue-operation + file-history-snapshot + orphan system
- **Subagent** — Agent tool_use + hooks + result

Cards not in a topical group stay standalone (user prompts, assistant text, plans, questions, misc).

A topical group acts as a single unit in the layer above.

### Layer 3: Collapsing Intermediate Actions
Between any two **primary-interest** items, all non-primary items are collected into **at most one collapsed group**.

- Primary interest: user prompts, assistant text responses, plans, agent questions + answers, ExitPlanMode
- Non-primary: tool call groups, noise groups, subagent groups, misc, etc.

A collapsed group can contain a mix of individual cards and topical groups (from Layer 2). So the nesting is: **collapsed group → topical group → individual card**.

## Configurable Filter UI

A compact filter bar at the top of the session view. The filter mechanism controls which entries are treated as primary interest, expanded/collapsed by default, and in topical groups.

### Per-tag controls
- A row of toggle-able tag pills, one per entry type / segment kind
- Each pill controls the defaults for that tag across the layers:
  - **Card state** override: expanded ↔ collapsed (Layer 1)
  - **Primary interest** override: promote to primary or demote to non-primary (Layer 3)
- Exact interaction design TBD

### Global actions
- **Expand all** button — expands every block and group on the page
- **Re-apply filter** button — re-collapses everything back to the current filter settings
- **Reset to defaults** link — restores the default settings

### Persistence
- Filter state stored in URL search params — shareable, survives refresh
- Also persisted to `localStorage` (URL params take precedence)

## Critical Constraint: Preserve EntryCard

The existing `EntryCard` component has carefully crafted features that MUST be preserved:
- Expand/collapse toggle with triangle indicator
- Line number display
- Type badge (color-coded)
- Tool badges showing tool names and file paths / commands
- IDE tag badges
- Thinking preview
- Timestamp
- Rendered / JSON toggle (every block must have raw JSON view)
- Plan badge
- All existing header information

**Any new grouping system must use EntryCard as the block renderer.** New components should only add grouping wrappers around EntryCards, never replace them with stripped-down alternatives.
