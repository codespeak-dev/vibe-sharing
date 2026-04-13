# Impatience

## What it measures

How often the user interrupts the agent's autonomous work flow. This captures the user's willingness (or lack thereof) to let the agent finish its tool-calling sequence before jumping in. A high impatience score means the user frequently cuts the agent short — either by sending a new prompt mid-sequence, rejecting tool calls, or stopping the agent before it finishes.

## Data sources

### From session JSONL entries

- **Entry types**: `user`, `assistant`
- **Key fields**:
  - `type` — entry type (`user` / `assistant`)
  - `timestamp` — for timing and rate calculations
  - `message.content[]` — array of content blocks
    - `tool_use` blocks (on assistant entries): `id`, `name`
    - `tool_result` blocks (on user entries): `tool_use_id`, `is_error`, `content`
    - `text` blocks (on user entries): indicates a user prompt (not a tool result)
  - `toolUseResult` — string field on user entries; contains `"User rejected tool use"` on rejections

### From the segment model (grouping.ts)

The `buildSegments()` function produces a segment sequence we can analyze. Key segment kinds:
- `user-prompt` — a user text message
- `tool-cycle-group` — a batch of autonomous tool calls
- `assistant-text` — the agent's text response
- `agent-question` / `exit-plan-mode` — agent asks the user something (not an interruption)

## Algorithm

### Signal 1: Sequence interruptions

Walk the segment array. Count cases where a `user-prompt` immediately follows a segment that is NOT `assistant-text`, `agent-question`, or `exit-plan-mode`. In the normal flow the agent finishes its tool calls, emits an `assistant-text`, and then the user responds. When the user jumps in before the agent's text response, that's an interruption.

```
for i in 1..segments.length:
  if segments[i].kind == "user-prompt":
    prev = segments[i-1] (skipping noise-group and misc)
    if prev.kind in {"tool-cycle-group", "subagent", "plan"}:
      sequenceInterruptions++
```

### Signal 2: Tool rejections

Scan all `user` entries for tool_result blocks where:
- `is_error === true` AND
- `content` contains "doesn't want to proceed" or `toolUseResult` contains "User rejected"

Each such entry is an explicit interruption.

```
for entry in entries where type == "user":
  for block in entry.message.content where block.type == "tool_result":
    if block.is_error && isRejection(block.content):
      toolRejections++
```

### Signal 3: Orphan tool_uses

Build a set of all `tool_use_id`s from assistant entries. Build a set of all `tool_use_id`s from tool_result user entries. The difference is orphan tool calls that were never resolved (agent was stopped mid-flight).

```
allToolUseIds = set of block.id from assistant tool_use blocks
allToolResultIds = set of block.tool_use_id from user tool_result blocks
orphans = allToolUseIds - allToolResultIds
```

### Normalization

- `interruptionsPerUserMessage = totalInterruptions / userPromptCount`
- `interruptionsPerMinute = totalInterruptions / sessionDurationMinutes`
- `toolRejectionRate = toolRejections / totalToolCycles`

### Aggregation across sessions

For a project or user-level score, compute per-session values and report:
- Median and mean interruption rate
- Total interruptions across all sessions
- Sessions with zero interruptions vs high-interruption sessions

## Output

```typescript
interface ImpatienceMetrics {
  // Raw counts
  sequenceInterruptions: number;   // user-prompt after tool-cycle-group
  toolRejections: number;          // explicit "User rejected tool use"
  orphanToolUses: number;          // tool_use with no tool_result
  totalInterruptions: number;      // sum of above

  // Normalized rates
  interruptionsPerUserMessage: number;  // totalInterruptions / userPromptCount
  interruptionsPerMinute: number;       // totalInterruptions / durationMinutes
  toolRejectionRate: number;            // toolRejections / totalToolCycles

  // Context
  userPromptCount: number;
  totalToolCycles: number;
  sessionDurationMinutes: number;
}
```

## Code location

`src/personality/impatience.ts`

- Export `computeImpatience(entries: SessionEntry[]): ImpatienceMetrics`
- Reuse `buildSegments` from `session-viewer/src/lib/grouping.ts` for segment-level analysis
- Reuse `readJsonl` from `src/utils/fs-helpers.ts` for raw JSONL reading

## Test plan

1. **Unit test with synthetic entries**: Construct minimal JSONL-like entry arrays with known interruption patterns (user-prompt after tool-cycle-group, tool rejections, orphans) and verify counts match expected values.

2. **Real session validation**: Run against 2-3 real session files.
   - Manually inspect the session in the session-viewer to count interruptions
   - Compare with computed metric values
   - Check that "normal" sessions (user waits for agent to finish) produce low/zero scores
   - Check that sessions where the user is known to have interrupted produce higher scores

3. **Edge cases**:
   - Session with only one user message (no interruption possible)
   - Session where every tool call is rejected (high impatience)
   - Session in auto mode with long autonomous runs (likely low impatience)
   - Empty session / session with no tool calls
