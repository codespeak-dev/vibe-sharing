import path from "node:path";
import os from "node:os";

const home = os.homedir();

export const CLAUDE_DIR = path.join(home, ".claude");
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const CLAUDE_HISTORY_FILE = path.join(CLAUDE_DIR, "history.jsonl");

export const CODEX_DIR = path.join(home, ".codex");
export const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, "sessions");
export const CODEX_HISTORY_FILE = path.join(CODEX_DIR, "history.jsonl");

export const GEMINI_DIR = path.join(home, ".gemini");
export const GEMINI_CONVERSATIONS_DIR = path.join(
  GEMINI_DIR,
  "antigravity",
  "conversations",
);
export const GEMINI_BRAIN_DIR = path.join(GEMINI_DIR, "antigravity", "brain");
export const GEMINI_PROJECTS_FILE = path.join(GEMINI_DIR, "projects.json");
export const GEMINI_TMP_DIR = path.join(GEMINI_DIR, "tmp");
export const GEMINI_HISTORY_DIR = path.join(GEMINI_DIR, "history");

export const CURSOR_DIR = path.join(home, ".cursor");
export const CURSOR_CHATS_DIR = path.join(CURSOR_DIR, "chats");
export const CURSOR_PLANS_DIR = path.join(CURSOR_DIR, "plans");
export const CURSOR_PROJECTS_DIR = path.join(CURSOR_DIR, "projects");

// Platform-dependent Cursor Application Support directory
const cursorAppDataDir =
  process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Cursor")
    : process.platform === "win32"
      ? path.join(
          process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
          "Cursor",
        )
      : path.join(home, ".config", "Cursor");

export const CURSOR_GLOBAL_STATE_DB = path.join(
  cursorAppDataDir,
  "User",
  "globalStorage",
  "state.vscdb",
);
export const CURSOR_WORKSPACE_STORAGE_DIR = path.join(
  cursorAppDataDir,
  "User",
  "workspaceStorage",
);

export const OPENCODE_DATA_DIR = path.join(home, ".local", "share", "opencode");
export const OPENCODE_DB_PATH = path.join(OPENCODE_DATA_DIR, "opencode.db");

export const CLINE_DIR = path.join(home, ".cline");
export const CLINE_TASKS_DIR = path.join(CLINE_DIR, "data", "tasks");
export const CLINE_HISTORY_FILE = path.join(
  CLINE_DIR,
  "data",
  "state",
  "taskHistory.json",
);

const DEFAULT_API_URL = "https://vibe-share.codespeak.dev";

export const API_BASE_URL =
  process.env.VIBE_SHARING_API_URL ?? DEFAULT_API_URL;

export const isDefaultApiUrl =
  !process.env.VIBE_SHARING_API_URL || API_BASE_URL === DEFAULT_API_URL;

export const MAX_ARCHIVE_SIZE_MB = 500;

export const TOOL_VERSION = "0.1.0";

export const ORG_NAME = "Codespeak";
export const CONTACT_EMAIL = "support@codespeak.dev";

/** Enable session preview tabs in the review screen. Off by default. */
export const SESSION_PREVIEW_ENABLED =
  process.env.VIBE_SHARING_SESSION_PREVIEW === "true";
