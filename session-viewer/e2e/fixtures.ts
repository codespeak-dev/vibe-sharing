import os from "node:os";
import path from "node:path";

// A dedicated $HOME so the seeded ~/.claude/projects/… never touches the real home. The Next.js
// server is started with HOME pointing here (see playwright.config.ts), so config.ts's
// `os.homedir()`-derived CLAUDE_DIR / CLAUDE_PROJECTS_DIR resolve under this fixture root.
export const FIXTURE_HOME = path.join(os.tmpdir(), "pw-registry-fixture");
export const FIXTURE_PROJECTS_DIR = path.join(FIXTURE_HOME, ".claude", "projects");

/** The fake project path embedded in every seeded entry's cwd, and used to seed + ingest. */
export const PROJECT_PATH = "/registry-test-project";

// ADAPT: how the on-disk $HOME/.claude/projects/<dir> name is derived from the project path. The
// base repo's `encodeProjectPath` (session-viewer imports it via codespeak-vibe-share/utils/paths)
// replaces every "/" with "-". This is the same across every submission (inherited from the base
// repo's session-discovery), and the base `/api/session-entries` route additionally FALLS BACK to
// scanning every project dir for `<sessionId>.jsonl`, so the exact dir name is not load-bearing —
// the seed is discoverable as long as it is SOME dir under projects/. Repoint only if a submission
// rewrote the discovery encoding.
export const ENCODED_PROJECT_DIR = PROJECT_PATH.replace(/\//g, "-");

/** base64url(PROJECT_PATH) — the `projectPath` query param the base /api/session-entries expects. */
export const PROJECT_ENCODED = Buffer.from(PROJECT_PATH).toString("base64url");

// Three visibly-distinct message kinds the viewer discerns, each in its own single-entry session so
// the registry attributes exactly one example to each. Each carries a DISTINCTIVE marker planted in
// its rendered text so THAT type's real example can be proven present in the registry UI, regardless
// of the submission's taxonomy labels, card component, or example-fetch mechanism.
export interface SeededType {
  /** session id / .jsonl basename */
  sessionId: string;
  /** distinctive text proving this type's example rendered */
  marker: string;
  /** the JSONL entry (one per session) */
  entry: Record<string, unknown>;
}

/** A user text prompt → the "user prompt" kind. */
export const USER_MARKER = "ZZUSERPROMPTMARKERZZ";
/** An assistant text reply with no tool calls → the "assistant text" kind. */
export const ASSISTANT_MARKER = "ZZASSISTANTTEXTMARKERZZ";
/** An assistant tool call (Bash) → the "tool call" kind. */
export const TOOL_MARKER = "ZZTOOLCALLMARKERZZ";

export const SESSION_USER_ID = "11110000-0000-4000-8000-000000000001";
export const SESSION_ASSISTANT_ID = "22220000-0000-4000-8000-000000000002";
export const SESSION_TOOL_ID = "33330000-0000-4000-8000-000000000003";

export const SEEDED_TYPES: SeededType[] = [
  {
    sessionId: SESSION_USER_ID,
    marker: USER_MARKER,
    entry: {
      type: "user",
      uuid: "11110000-0000-4000-8000-0000000000a1",
      parentUuid: null,
      cwd: PROJECT_PATH,
      sessionId: SESSION_USER_ID,
      timestamp: "2024-01-01T10:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `${USER_MARKER} please implement the feature.` }],
      },
    },
  },
  {
    sessionId: SESSION_ASSISTANT_ID,
    marker: ASSISTANT_MARKER,
    entry: {
      type: "assistant",
      uuid: "22220000-0000-4000-8000-0000000000a2",
      parentUuid: null,
      cwd: PROJECT_PATH,
      sessionId: SESSION_ASSISTANT_ID,
      timestamp: "2024-01-01T11:00:00.000Z",
      message: {
        id: "msg_assistant_text",
        role: "assistant",
        content: [{ type: "text", text: `${ASSISTANT_MARKER} here is my reply with no tool calls.` }],
      },
    },
  },
  {
    sessionId: SESSION_TOOL_ID,
    marker: TOOL_MARKER,
    entry: {
      type: "assistant",
      uuid: "33330000-0000-4000-8000-0000000000a3",
      parentUuid: null,
      cwd: PROJECT_PATH,
      sessionId: SESSION_TOOL_ID,
      timestamp: "2024-01-01T12:00:00.000Z",
      message: {
        id: "msg_tool_call",
        role: "assistant",
        content: [
          { type: "text", text: `${TOOL_MARKER} running a command:` },
          {
            type: "tool_use",
            id: "toolu_bash1",
            name: "Bash",
            input: { command: `echo ${TOOL_MARKER}` },
          },
        ],
      },
    },
  },
];
