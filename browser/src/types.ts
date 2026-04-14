/** A single AI coding session. */
export interface DiscoveredSession {
  agentName: string;
  agentSlug: string;
  sessionId: string;
  summary: string | null;
  firstPrompt: string | null;
  messageCount: number | null;
  created: string | null;
  modified: string | null;
  sizeBytes: number;
}

/** A project with sessions from one or more agents. */
export interface DiscoveredProject {
  /** Absolute path on the user's machine. */
  path: string;
  agents: string[];
  agentSlugs: string[];
  /** slug → session count */
  sessionCounts: Record<string, number>;
}

/** A directory handle granted by the user for a particular agent. */
export interface AgentHandle {
  slug: "claude" | "claude-project" | "cursor" | "cursor-work-profile" | "codex";
  /** Display name, e.g. "Claude Code" */
  name: string;
  /** The top-level directory handle (e.g. ~/.claude or ~/Library/.../Cursor/User) */
  handle: FileSystemDirectoryHandle;
  /** For Cursor: separate ~/.cursor handle for transcripts (optional) */
  dotCursorHandle?: FileSystemDirectoryHandle;
}
