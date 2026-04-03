# Vibe Personality Metrics

## Project structure
- `TRACKING.md` — master status of all metrics (emoji status + cursor links for next action)
- `metrics/` — one plan file per metric (created during planning phase)
- `prompts/` — prompt templates for each workflow state transition
- `vibe-personality.md` — raw metric ideas and candidates
- `permissions.md` — research on permission detection in session JSONL

## Workflow

Each metric progresses through these states:

| Emoji | State | What happens |
|-------|-------|-------------|
| ⬜ | Not started | Nothing yet |
| 📋 | Planning | Create `metrics/<name>.md` with: what it measures, data sources, algorithm, code location, test plan |
| 🔨 | Implementing | Write code in `src/personality/`. Follow the plan in `metrics/<name>.md` |
| 🧪 | Testing | Verify the metric computes correctly against real session data |
| ✅ | Done | Metric is implemented and tested |

When working on a metric:
1. Read the prompt template from `prompts/` for the current transition
2. Do the work described in the template
3. Update TRACKING.md: change the status emoji AND update the "Next" link to point to the next transition's prompt

## Updating TRACKING.md links

When advancing a metric's status, update both the emoji and the cursor link. The link format is:
```
cursor://anthropic.claude-code/open?prompt=<url-encoded prompt>
```
Where the prompt is: `Read and follow intent/vibe-personality/prompts/<next-state>.md for metric: <Metric Name> (<metric-file>.md)`

## Key references
- Session JSONL format: see `permissions.md` for structure details
- Existing parsing: `src/sessions/agents/claude.ts`
- Utilities: `src/utils/fs-helpers.ts` (readJsonl), `src/utils/paths.ts` (encodeProjectPath)
- Cache DB: `session-viewer/src/lib/cache-db.ts`
- Grouping: `session-viewer/src/lib/grouping.ts`

## Implementation location
Code goes in `src/personality/`. Each metric gets its own extraction logic.
