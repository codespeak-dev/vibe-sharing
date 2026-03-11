import { TOOL_VERSION } from "../config.js";
import type { DiscoveredSession } from "../sessions/types.js";

export interface ArchiveManifest {
  version: 1;
  createdAt: string;
  toolVersion: string;
  project: {
    name: string;
    path: string;
    isGitRepo: boolean;
    gitBranch?: string;
    gitCommit?: string;
  };
  agents: Record<
    string,
    {
      sessionCount: number;
      sessions: {
        id: string;
        summary?: string;
        messageCount?: number;
      }[];
    }
  >;
  files: {
    projectFileCount: number;
    sessionFileCount: number;
    totalSizeBytes: number;
  };
}

export function buildManifest(opts: {
  projectName: string;
  projectPath: string;
  isGitRepo: boolean;
  gitBranch?: string | null;
  gitCommit?: string | null;
  projectFileCount: number;
  sessionFileCount: number;
  totalSizeBytes: number;
  sessionsByAgent: Map<string, { sessions: DiscoveredSession[] }>;
}): ArchiveManifest {
  const agents: ArchiveManifest["agents"] = {};

  for (const [agentName, { sessions }] of opts.sessionsByAgent) {
    agents[agentName] = {
      sessionCount: sessions.length,
      sessions: sessions.map((s) => ({
        id: s.sessionId,
        ...(s.summary && { summary: s.summary }),
        ...(s.messageCount != null && { messageCount: s.messageCount }),
      })),
    };
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    project: {
      name: opts.projectName,
      path: opts.projectPath,
      isGitRepo: opts.isGitRepo,
      ...(opts.gitBranch && { gitBranch: opts.gitBranch }),
      ...(opts.gitCommit && { gitCommit: opts.gitCommit }),
    },
    agents,
    files: {
      projectFileCount: opts.projectFileCount,
      sessionFileCount: opts.sessionFileCount,
      totalSizeBytes: opts.totalSizeBytes,
    },
  };
}
