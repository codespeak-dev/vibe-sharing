# Implement a Metric

You are implementing the metric: **{{metric-name}}**

## Steps

1. Read the plan at `intent/vibe-personality/metrics/{{metric-file}}`
2. Read `intent/vibe-personality/CLAUDE.md` for project context
3. Implement the metric in `src/personality/` following the plan:
   - Reuse existing utilities (`readJsonl`, `encodeProjectPath`, etc.)
   - Follow existing code patterns in the project
   - Keep the implementation focused — don't over-engineer
4. Update `intent/vibe-personality/TRACKING.md`:
   - Change status from 📋 to 🔨
   - Update the "Next" link to point to `prompts/test.md`
