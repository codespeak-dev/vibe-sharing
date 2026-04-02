import path from "node:path";
import { decodeFromUrl } from "@/lib/urls";
import { extractMetadata } from "@/lib/session-metadata";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PlanBadge } from "@/components/plan-badge";
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

  const metadata = await extractMetadata(sessionId, projectPath);

  const title = metadata.aiTitle || sessionId;
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
        <span className="text-xs text-neutral-500 bg-neutral-800 rounded px-1.5 py-0.5">
          Claude Code
        </span>
        {metadata.hasPlans && metadata.firstPlanLineIndex != null && (
          <PlanBadge entryIndex={metadata.firstPlanLineIndex} />
        )}
        <span className="text-xs text-neutral-600 font-mono">{sessionId}</span>
      </div>
      <div className="mb-6">
        <SessionStats
          messageCount={metadata.messageCount}
          userPromptCount={metadata.userPromptCount}
          created={metadata.created}
          modified={metadata.modified}
          sizeBytes={metadata.sizeBytes}
        />
      </div>
      <SessionClient sessionId={sessionId} encodedProjectPath={encodedPath} />
    </div>
  );
}
