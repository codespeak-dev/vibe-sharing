import path from "node:path";
import Link from "next/link";
import { discoverAllSessions } from "codespeak-vibe-share/sessions/discovery";
import { decodeFromUrl } from "@/lib/urls";
import { extractMetadata } from "@/lib/session-metadata";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SessionStats } from "@/components/session-stats";
import { SessionClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ projectPath: string; sessionId: string }>;
}) {
  const { projectPath: encodedPath, sessionId } = await params;
  const projectPath = decodeFromUrl(encodedPath);
  const projectName = path.basename(projectPath);
  const sessionHref = `/project/${encodedPath}/session/${sessionId}`;

  // Discover session info and metadata in parallel
  const [discoveryResult, metadata] = await Promise.all([
    discoverAllSessions({ worktreePaths: [projectPath], gitRemoteUrl: null }),
    extractMetadata(sessionId, projectPath),
  ]);

  const session = [...discoveryResult.byAgent.values()]
    .flatMap(({ sessions }) => sessions)
    .find((s) => s.sessionId === sessionId);

  const title = metadata.aiTitle || session?.summary || sessionId;
  const breadcrumbLabel = metadata.aiTitle
    ? metadata.aiTitle.length > 30 ? metadata.aiTitle.slice(0, 30) + "..." : metadata.aiTitle
    : sessionId.slice(0, 8) + "...";

  return (
    <div>
      <Breadcrumbs
        crumbs={[
          { label: "Projects", href: "/" },
          { label: projectName, href: `/project/${encodedPath}` },
          { label: breadcrumbLabel },
        ]}
      />
      <h1 className="text-lg font-semibold mb-2">{title}</h1>
      <div className="flex items-center gap-2 mb-2">
        {session && (
          <span className="text-xs text-neutral-500 bg-neutral-800 rounded px-1.5 py-0.5">
            {session.agentName}
          </span>
        )}
        {metadata.hasPlans && metadata.firstPlanLineIndex != null && (
          <Link
            href={`${sessionHref}#entry-${metadata.firstPlanLineIndex}`}
            className="text-xs text-purple-300 bg-purple-900/50 rounded px-1.5 py-0.5 hover:bg-purple-900/80 transition-colors"
          >
            plan
          </Link>
        )}
        <span className="text-xs text-neutral-600 font-mono">{sessionId}</span>
      </div>
      {session && (
        <div className="mb-6">
          <SessionStats
            messageCount={session.messageCount}
            userPromptCount={metadata.userPromptCount}
            created={session.created}
            modified={session.modified}
            sizeBytes={session.sizeBytes}
          />
        </div>
      )}
      <SessionClient sessionId={sessionId} encodedProjectPath={encodedPath} />
    </div>
  );
}
