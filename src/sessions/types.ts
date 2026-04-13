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

export interface ProjectContext {
  projectPath: string;
  gitRemoteUrl: string | null;
  allWorktreePaths: string[];
}

export interface DiscoveredProject {
  /** Absolute project path */
  path: string;
  /** Agent display names that have sessions for this project */
  agents: string[];
  /** Agent slugs, parallel to agents[] */
  agentSlugs: string[];
  /** Agent slug → session count */
  sessionCounts: Record<string, number>;
}

export interface AgentProvider {
  /** Display name for this agent (e.g. "Claude Code") */
  readonly name: string;
  /** Short identifier for directory naming (e.g. "claude-code") */
  readonly slug: string;

  /** Check if this agent is installed / has data on the system */
  detect(): Promise<boolean>;

  /**
   * Discover all project paths that have sessions for this agent.
   * Returns a map from absolute project path → approximate session count.
   */
  discoverProjects(): Promise<Map<string, number>>;

  /**
   * Find sessions associated with the given project context.
   * Returns empty array if none found (never throws).
   */
  findSessions(context: ProjectContext): Promise<DiscoveredSession[]>;

  /**
   * Get the absolute paths of all files that should be collected for a session.
   * For providers that use getProviderFiles(), this may return empty.
   */
  getSessionFiles(session: DiscoveredSession): Promise<string[]>;

  /**
   * Optional: return all files for this provider (entire project session directory
   * + referenced external files like plans/debug).
   */
  getProviderFiles?(): Promise<string[]>;

  /**
   * Optional: return the base directory for session/provider files.
   * When provided, the archiver preserves relative paths within this directory.
   */
  getSessionDir?(): string | null;

  /**
   * Optional: base directory for archive path computation. All provider files
   * under this directory are archived with their relative paths preserved under
   * sessions/{basename}/. E.g. ~/.claude → sessions/.claude/projects/...
   */
  getArchiveRoot?(): string;

  /**
   * Optional: return virtual files whose content is generated/filtered
   * rather than read from disk. These are added to the archive at the
   * given paths (relative to sessions/{archiveRootBasename}/).
   */
  getVirtualFiles?(): Promise<Array<{ relativePath: string; content: string }>>;
}
