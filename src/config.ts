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
