# Test a Metric

You are testing the metric: **{{metric-name}}**

## Steps

1. Read the plan at `intent/vibe-personality/metrics/{{metric-file}}`
2. Run the metric computation against real session data on this machine
3. Verify:
   - The metric produces reasonable values
   - Edge cases are handled (empty sessions, missing data, etc.)
   - The output format matches what the plan specifies
4. Document any issues found and fix them
5. Update `intent/vibe-personality/TRACKING.md`:
   - Change status from 🔨 to 🧪
   - Update the "Next" link to point to `prompts/done.md`
