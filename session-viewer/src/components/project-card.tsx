import Link from "next/link";
import path from "node:path";
import { encodeForUrl } from "@/lib/urls";

interface ProjectCardProps {
  projectPath: string;
  agents: string[];
  sessionCounts: Record<string, number>;
}

export function ProjectCard({ projectPath, agents, sessionCounts }: ProjectCardProps) {
  const total = Object.values(sessionCounts).reduce((sum, n) => sum + n, 0);
  const basename = path.basename(projectPath);
  const encoded = encodeForUrl(projectPath);

  return (
    <Link
      href={`/project/${encoded}`}
      className="block border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 hover:bg-neutral-900/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-base truncate">{basename}</h2>
          <p className="text-xs text-neutral-500 truncate mt-0.5" title={projectPath}>
            {projectPath}
          </p>
        </div>
        <span className="shrink-0 text-sm text-neutral-400 bg-neutral-800 rounded-full px-2.5 py-0.5">
          {total} {total === 1 ? "session" : "sessions"}
        </span>
      </div>
      <div className="flex gap-1.5 mt-3 flex-wrap">
        {agents.map((agent) => (
          <span
            key={agent}
            className="text-xs px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800/50"
          >
            {agent}
          </span>
        ))}
      </div>
    </Link>
  );
}
