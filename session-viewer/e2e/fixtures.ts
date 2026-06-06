import os from 'node:os';
import path from 'node:path';

export const FIXTURE_HOME = path.join(os.tmpdir(), 'pw-plan-badge-fixture');
export const FIXTURE_PROJECTS_DIR = path.join(FIXTURE_HOME, '.claude', 'projects');

/** The fake project path embedded in session JSONL cwd fields and used in URLs. */
export const PROJECT_PATH = '/test-project';

// ADAPT: these two reproduce the reference impl's path-encoding conventions, used only to seed the
// fixture JSONL where the app looks and to build the URL the app serves the project at — neither is
// graded behaviour. Repoint each to the submission's scheme if it differs:
//   - ENCODED_PROJECT_DIR: how the on-disk $HOME/.claude/projects/<dir> name is derived from the
//     project path ("/" → "-"). Change so global-setup seeds into the dir the submission reads.
//   - PROJECT_ENCODED: how the project path is embedded in the URL (base64url). Repoint to the
//     submission's encoder so PROJECT_URL resolves.
/** encodeProjectPath('/test-project') — replaces every '/' with '-' */
export const ENCODED_PROJECT_DIR = '-test-project';

/** base64url('/test-project') — used as the URL path segment */
export const PROJECT_ENCODED = Buffer.from(PROJECT_PATH).toString('base64url');

/** Session A: plan reference at line 1, which is a user-type entry (directly rendered). */
export const SESSION_A_ID = 'a1b2c3d4-0000-0000-0000-000000000001';

/** Session B: plan reference at line 1, which is an assistant-type entry (inside a CollapsedGroup). */
export const SESSION_B_ID = 'a1b2c3d4-0000-0000-0000-000000000002';

// The two sessions carry deliberately-unique, non-substring ai-titles so a card can be located by
// its visible title text (see global-setup.ts). These are fixture data, NOT graded behaviour — the
// app renders whatever title the JSONL supplies. Keep them in sync with global-setup.ts.
export const SESSION_A_TITLE = 'AlphaPlanSession';
export const SESSION_B_TITLE = 'BravoCollapsedSession';

// The plan file the sessions reference. A REAL Claude Code plan file is a word-slug `.md` under
// `.claude/plans/` (e.g. `glowing-splashing-squirrel.md`), NOT a hex/uuid name — so a detector that
// only accepts hex plan names is genuinely too strict and SHOULD fail here. Keep this a realistic
// word-slug.
export const PLAN_FILE = '.claude/plans/crimson-hawk-plan.md';

// A distinctive substring of the plan-referencing message, rendered on BOTH sessions' detail pages.
// Used to locate the plan entry by its rendered CONTENT (mechanism-agnostic) rather than a DOM id.
export const PLAN_MESSAGE_TEXT = 'crimson-hawk-plan.md';

// Stable per-entry uuids for the plan-referencing message in each session. Real Claude Code JSONL
// entries always carry a top-level `uuid`; a submission that keys its deep-link on the message
// identity resolves against these. (Kept in sync with global-setup.ts.)
export const SESSION_A_PLAN_UUID = 'aaaaaaa1-0000-4000-8000-0000000000a1';
export const SESSION_B_PLAN_UUID = 'bbbbbbb1-0000-4000-8000-0000000000b2';
