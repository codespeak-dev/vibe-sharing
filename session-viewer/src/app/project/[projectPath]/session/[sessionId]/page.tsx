import path from "node:path";
import { decodeFromUrl } from "@/lib/urls";
import { Breadcrumbs } from "@/components/breadcrumbs";
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

  return (
    <div>
      <Breadcrumbs
        crumbs={[
          { label: "Projects", href: "/" },
          { label: projectName, href: `/project/${encodedPath}` },
          { label: sessionId.slice(0, 8) + "..." },
        ]}
      />
      <h1 className="text-lg font-semibold mb-1 font-mono">{sessionId}</h1>
      <p className="text-xs text-neutral-500 mb-6">{projectPath}</p>
      <SessionClient sessionId={sessionId} encodedProjectPath={encodedPath} />
    </div>
  );
}
