import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import {
  FIXTURE_PROJECTS_DIR,
  ENCODED_PROJECT_DIR,
  PROJECT_PATH,
  PROJECT_ENCODED,
  PLAN_FILE,
  SESSION_A_ID,
  SESSION_B_ID,
  SESSION_A_TITLE,
  SESSION_B_TITLE,
  SESSION_A_PLAN_UUID,
  SESSION_B_PLAN_UUID,
} from './fixtures';

// The fixtures seed REALISTIC Claude Code session JSONL: every entry carries a top-level `uuid`
// (and `parentUuid` chain) as real sessions do, and the plan is referenced the way real sessions
// express it — a `.claude/plans/<word-slug>.md` path, and in Session B a canonical assistant
// `ExitPlanMode` tool_use. This lets any reasonable plan-detector (loose `.claude/plans/` substring,
// a plan-filename match, an `ExitPlanMode`/tool_use scan, or a message-`uuid` key) resolve the SAME
// plan message, instead of the grade depending on which detector style the submission happened to
// pick. The two sessions exercise the two rendering positions:
//   - Session A: plan referenced by a USER message → rendered directly (T02/T03/T04/T06).
//   - Session B: plan presented by an ASSISTANT `ExitPlanMode` inside a collapsed group (T05).
export default async function globalSetup(_config: FullConfig) {
  const sessionDir = path.join(FIXTURE_PROJECTS_DIR, ENCODED_PROJECT_DIR);
  await mkdir(sessionDir, { recursive: true });

  // Session A: the plan is referenced in a user message at line 1 (directly rendered).
  const sessionALines = [
    JSON.stringify({
      type: 'user',
      uuid: 'aaaaaaa0-0000-4000-8000-0000000000a0',
      parentUuid: null,
      cwd: PROJECT_PATH,
      sessionId: SESSION_A_ID,
      timestamp: '2024-01-01T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
    }),
    JSON.stringify({
      type: 'user',
      uuid: SESSION_A_PLAN_UUID,
      parentUuid: 'aaaaaaa0-0000-4000-8000-0000000000a0',
      cwd: PROJECT_PATH,
      sessionId: SESSION_A_ID,
      timestamp: '2024-01-01T10:00:01.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: `Please follow the implementation plan I saved at ${PLAN_FILE}` },
        ],
      },
    }),
    JSON.stringify({
      type: 'ai-title',
      uuid: 'aaaaaaa2-0000-4000-8000-0000000000a2',
      parentUuid: SESSION_A_PLAN_UUID,
      timestamp: '2024-01-01T10:00:02.000Z',
      aiTitle: SESSION_A_TITLE,
    }),
  ];
  await writeFile(path.join(sessionDir, `${SESSION_A_ID}.jsonl`), sessionALines.join('\n'));

  // Session B: the plan is presented by an assistant ExitPlanMode tool_use at line 2, inside a run
  // of non-user messages (lines 1-3) that the viewer collapses into a group by default.
  const sessionBLines = [
    JSON.stringify({
      type: 'user',
      uuid: 'bbbbbbb0-0000-4000-8000-0000000000b0',
      parentUuid: null,
      cwd: PROJECT_PATH,
      sessionId: SESSION_B_ID,
      timestamp: '2024-01-01T11:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Start the task' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'bbbbbbb1-0000-4000-8000-0000000000b1',
      parentUuid: 'bbbbbbb0-0000-4000-8000-0000000000b0',
      sessionId: SESSION_B_ID,
      timestamp: '2024-01-01T11:00:01.000Z',
      message: {
        id: 'msg_b1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me work out an approach first.' }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: SESSION_B_PLAN_UUID,
      parentUuid: 'bbbbbbb1-0000-4000-8000-0000000000b1',
      sessionId: SESSION_B_ID,
      timestamp: '2024-01-01T11:00:02.000Z',
      message: {
        id: 'msg_b2plan',
        role: 'assistant',
        content: [
          { type: 'text', text: `Here is the implementation plan (saved to ${PLAN_FILE}):` },
          {
            type: 'tool_use',
            id: 'toolu_b2plan',
            name: 'ExitPlanMode',
            input: {
              plan: `# Implementation Plan\n\nSaved to ${PLAN_FILE}\n\n1. Add the plan badge to the session card\n2. Make it navigate to the plan message\n3. Scroll and highlight the target on arrival`,
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'bbbbbbb3-0000-4000-8000-0000000000b3',
      parentUuid: SESSION_B_PLAN_UUID,
      sessionId: SESSION_B_ID,
      timestamp: '2024-01-01T11:00:03.000Z',
      message: {
        id: 'msg_b3',
        role: 'assistant',
        content: [{ type: 'text', text: 'Proceeding with the implementation now.' }],
      },
    }),
    JSON.stringify({
      type: 'ai-title',
      uuid: 'bbbbbbb4-0000-4000-8000-0000000000b4',
      parentUuid: 'bbbbbbb3-0000-4000-8000-0000000000b3',
      timestamp: '2024-01-01T11:00:04.000Z',
      aiTitle: SESSION_B_TITLE,
    }),
  ];
  await writeFile(path.join(sessionDir, `${SESSION_B_ID}.jsonl`), sessionBLines.join('\n'));

  // Referenced so a submission that URL-encodes the project path differently still has the seed at a
  // discoverable location; PROJECT_ENCODED is exercised by the spec's PROJECT_URL.
  void PROJECT_ENCODED;
}
