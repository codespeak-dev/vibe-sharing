export interface DiscoveredSession {
  /** Agent that created this session */
  agentName: string;
  /** Unique session identifier */
  sessionId: string;
  /** Short summary of the session (if available) */
  summary: string | null;
  /** First user prompt (if available) */
  firstPrompt: string | null;
  /** Number of messages (if available) */
  messageCount: number | null;
  /** When the session was created (ISO string) */
  created: string | null;
  /** When the session was last modified (ISO string) */
  modified: string | null;
  /** Total size of all session files in bytes */
  sizeBytes: number;
}

export interface AgentProvider {
  /** Display name for this agent (e.g. "Claude Code") */
  readonly name: string;
  /** Short identifier for directory naming (e.g. "claude-code") */
  readonly slug: string;

  /** Check if this agent is installed / has data on the system */
  detect(): Promise<boolean>;

  /**
   * Find sessions associated with the given project path.
   * Returns empty array if none found (never throws).
   */
  findSessions(projectPath: string): Promise<DiscoveredSession[]>;

  /**
   * Get the absolute paths of all files that should be collected for a session.
   */
  getSessionFiles(session: DiscoveredSession): Promise<string[]>;
}
