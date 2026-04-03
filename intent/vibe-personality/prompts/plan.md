# Plan a Metric

You are planning the metric: **{{metric-name}}**

## Steps

1. Read `intent/vibe-personality/vibe-personality.md` and find the entry for this metric to understand what it measures
2. Read `intent/vibe-personality/permissions.md` for session JSONL structure reference
3. Explore the existing codebase to understand what data is available:
   - `src/sessions/agents/claude.ts` — session parsing
   - `src/utils/fs-helpers.ts` — JSONL reading utilities
   - `session-viewer/src/lib/cache-db.ts` — cached session data
   - `session-viewer/src/lib/grouping.ts` — tool cycle grouping
4. Create `intent/vibe-personality/metrics/{{metric-file}}` with:
   - **What it measures**: plain-language description
   - **Data sources**: which JSONL fields, git commands, or project files are needed
   - **Algorithm**: how to compute the metric (pseudocode or description)
   - **Output**: what the metric produces (number, ratio, category, list, etc.)
   - **Code location**: where the implementation will go in `src/personality/`
   - **Test plan**: how to verify correctness against real session data
5. Update `intent/vibe-personality/TRACKING.md`:
   - Change status from ⬜ to 📋
   - Update the "Next" link to point to `prompts/implement.md`
