# Sync Metrics

Sync new metrics from `intent/vibe-personality/vibe-personality.md` into `intent/vibe-personality/TRACKING.md`.

## Steps

1. Read `intent/vibe-personality/vibe-personality.md` — the source of truth for metric ideas
2. Read `intent/vibe-personality/TRACKING.md` — the current tracking state
3. Compare: find any bullet points in vibe-personality.md that don't have a corresponding row in TRACKING.md
4. For each new metric:
   - Pick a short name and kebab-case filename
   - Add it to the correct section in TRACKING.md with ⬜ status, the description from vibe-personality.md, and a `▶ Plan` cursor link following the same URL pattern as existing rows
5. Also check for metrics in TRACKING.md whose descriptions no longer match vibe-personality.md and update them
6. Report what was added/changed
