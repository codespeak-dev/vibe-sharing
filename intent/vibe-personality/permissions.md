Permissions in Claude Session JSONL
====================================

Research into how permission events are recorded in `~/.claude/projects/<project>/<session-id>.jsonl` files.

# Session JSONL structure

Each line is a JSON object. Key types: `queue-operation`, `file-history-snapshot`, `user`, `assistant`, `system`, `ai-title`, `progress`, `last-prompt`.

Tool invocations are a pair:
1. **`assistant`** message with `"type": "tool_use"` in `message.content[]`
2. **`user`** message with `"type": "tool_result"` in `message.content[]`

# Permission modes

Every `user`-type message has a `"permissionMode"` field. Values:

| `permissionMode` value | UI label | Edits auto-approved? | Bash auto-approved? |
|---|---|---|---|
| `"default"` | Normal (ask for each tool) | No (unless in allow-list) | No (unless in allow-list) |
| `"acceptEdits"` | Auto-edit | **Yes** | No |
| `"auto"` | Auto mode | **Yes** | **Yes** |
| `"bypassPermissions"` | Bypass all permissions | **Yes** | **Yes** |
| `"plan"` | Plan mode | **Yes** (for plan files) | **Yes** (read-only tools) |

Mode switches are detected by comparing `permissionMode` between consecutive user messages — there is no dedicated "mode switch" event.

Additionally, `permissions.allow` in `~/.claude/settings.json` lists tool patterns that are always auto-approved even in `default` mode (e.g. `Bash(npm run build:*)`).

# Can we detect when the agent didn't ask permission?

**No.** There is no explicit `"autoApproved": true` or `"permissionAsked": false` flag on either `tool_use` or `tool_result` events. The JSON structure is identical whether the user clicked "Allow", or the tool was auto-approved by the mode or the allow-list.

### What you CAN infer

- **`permissionMode`** on user messages tells you the active mode
- **`permissions.allow`** in settings tells you what's auto-approved in default mode
- **Timing heuristic (unreliable):** delay between `tool_use` and `tool_result` timestamps — but this includes execution time, so a slow Bash command in auto mode looks like a user-approved command in default mode

### What you CAN definitively detect

- **User declined** — `tool_result` with `"is_error": true`
- **User declined with instructions** — same, plus user's reason in the content string
- **Mode was switched** — `permissionMode` changes between consecutive user messages
- **Tool was invoked and succeeded** — `tool_result` without `is_error`

# JSON examples

## User accepts a tool use (Edit)

Assistant proposes:
```json
{
  "type": "assistant",
  "timestamp": "2026-03-12T16:43:19.514Z",
  "message": {
    "role": "assistant",
    "content": [{
      "type": "tool_use",
      "id": "toolu_016ns3HnoZvBJM9yXyeu94kK",
      "name": "Edit",
      "input": {
        "file_path": "/path/to/file.ts",
        "old_string": "import { selectSessions } from \"./ui/prompts.js\";",
        "new_string": "import { selectUntrackedFiles, selectSessions } from \"./ui/prompts.js\";"
      },
      "caller": { "type": "direct" }
    }]
  }
}
```

User accepts (success result):
```json
{
  "type": "user",
  "timestamp": "2026-03-12T16:43:24.903Z",
  "permissionMode": "default",
  "toolUseResult": {
    "filePath": "/path/to/file.ts",
    "oldString": "...",
    "newString": "...",
    "originalFile": "..."
  },
  "message": {
    "role": "user",
    "content": [{
      "tool_use_id": "toolu_016ns3HnoZvBJM9yXyeu94kK",
      "type": "tool_result",
      "content": "The file /path/to/file.ts has been updated successfully."
    }]
  }
}
```

## User declines (no reason)

```json
{
  "type": "user",
  "toolUseResult": "User rejected tool use",
  "message": {
    "role": "user",
    "content": [{
      "type": "tool_result",
      "content": "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
      "is_error": true,
      "tool_use_id": "toolu_01Ld1Lq3GQ4yrEDQDGERx8Am"
    }]
  }
}
```

## User declines with alternative instructions

```json
{
  "type": "user",
  "toolUseResult": "Error: The user doesn't want to proceed with this tool use. The tool use was rejected ... The user provided the following reason for the rejection:  Drop the vibe-share, it's not useful",
  "message": {
    "role": "user",
    "content": [{
      "type": "tool_result",
      "content": "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection:  Drop the vibe-share, it's not useful",
      "is_error": true,
      "tool_use_id": "toolu_01AzAmzkKuJKofAiM4Dr42KP"
    }]
  }
}
```

## User stays in plan mode and comments on the plan

```json
{
  "type": "user",
  "toolUseResult": "Error: User chose to stay in plan mode and continue planning\n\nComments on the plan:\n[Re: \"If not logged in → saves the return URL in sessionStorage...\"] is the session storage the best practice here, any alternatives?\n[Re: \"A SlackThreadsTable maps...\"] Add viewing interface for this table in web-ui",
  "message": {
    "role": "user",
    "content": [{
      "type": "tool_result",
      "content": "User chose to stay in plan mode and continue planning\n\nComments on the plan:\n[Re: \"...\"] is the session storage the best practice here?...",
      "is_error": true,
      "tool_use_id": "toolu_016umhxQ1aSN71Vi5hoSuTCV"
    }]
  }
}
```

## Permission mode switch

There is no dedicated event. The `permissionMode` field simply changes between consecutive user messages:

```json
{ "type": "user", "permissionMode": "default",           "timestamp": "2026-03-12T13:50:28.066Z", "..." : "..." }
{ "type": "user", "permissionMode": "acceptEdits",       "timestamp": "2026-03-12T13:53:11.217Z", "..." : "..." }
{ "type": "user", "permissionMode": "bypassPermissions", "timestamp": "2026-03-12T16:29:11.164Z", "..." : "..." }
{ "type": "user", "permissionMode": "default",           "timestamp": "2026-03-12T16:36:47.058Z", "..." : "..." }
```

# Detection logic summary

| What | How to detect | Reliable? |
|---|---|---|
| Permission asked & accepted | `tool_result` without `is_error` | Can't distinguish from auto-approved |
| Permission asked & declined | `tool_result` with `is_error: true`, content starts with `"The user doesn't want to proceed..."` | **Yes** |
| Declined with reason | Same as above, content includes `"The user provided the following reason for the rejection: <reason>"` | **Yes** |
| Plan mode comments | `tool_result` with `is_error: true`, content starts with `"User chose to stay in plan mode..."` | **Yes** |
| Auto-approved (no prompt) | No structural signal; infer from `permissionMode` + `settings.json` allow-list | **Approximate only** |
| Mode switch | `permissionMode` changes between consecutive user messages | **Yes** |
