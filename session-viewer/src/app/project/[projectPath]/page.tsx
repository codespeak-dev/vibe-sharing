import path from "node:path";
import { discoverAllSessions } from "codespeak-vibe-share/sessions/discovery";
import { decodeFromUrl } from "@/lib/urls";
import { extractAllSessionMetadata } from "@/lib/session-metadata";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SessionCard } from "@/components/session-card";

export const dynamic = "force-dynamic";

export default async function SessionListPage({
  params,
}: {
  params: Promise<{ projectPath: string }>;
}) {
  const { projectPath: encodedPath } = await params;
  const projectPath = decodeFromUrl(encodedPath);
  const projectName = path.basename(projectPath);
  const projectHref = `/project/${encodedPath}`;

  const result = await discoverAllSessions({
    worktreePaths: [projectPath],
    gitRemoteUrl: null,
  });

  // Flatten all sessions across agents, sorted by modified date desc
  const allSessions = [...result.byAgent.values()]
    .flatMap(({ sessions }) => sessions)
    .sort((a, b) => {
      const ta = a.modified ? new Date(a.modified).getTime() : 0;
      const tb = b.modified ? new Date(b.modified).getTime() : 0;
      return tb - ta;
    });

  // Extract metadata (ai-titles, plans, prompt counts) from Claude Code sessions
  const sessionMetadata = await extractAllSessionMetadata(allSessions, projectPath);

  return (
    <div>
      <Breadcrumbs
        crumbs={[
          { label: "Projects", href: "/" },
          { label: projectName },
        ]}
      />
      <h1 className="text-xl font-semibold mb-1">{projectName}</h1>
      <p className="text-xs text-neutral-500 mb-1" title={projectPath}>
        {projectPath}
      </p>
      <p className="text-sm text-neutral-500 mb-6">
        {allSessions.length} {allSessions.length === 1 ? "session" : "sessions"}
      </p>

      {allSessions.length === 0 ? (
        <p className="text-neutral-500">No sessions found for this project.</p>
      ) : (
        <div className="grid gap-3 grid-cols-1">
          {allSessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              sessionId={s.sessionId}
              projectHref={projectHref}
              agentName={s.agentName}
              aiTitle={sessionMetadata.get(s.sessionId)?.aiTitle ?? null}
              summary={s.summary}
              firstPrompt={s.firstPrompt}
              messageCount={s.messageCount}
              created={s.created}
              modified={s.modified}
              sizeBytes={s.sizeBytes}
              hasPlans={sessionMetadata.get(s.sessionId)?.hasPlans}
              firstPlanLineIndex={sessionMetadata.get(s.sessionId)?.firstPlanLineIndex}
              userPromptCount={sessionMetadata.get(s.sessionId)?.userPromptCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}
