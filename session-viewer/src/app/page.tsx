import { discoverAllProjects } from "codespeak-vibe-share/sessions/global-discovery";
import { ProjectCard } from "@/components/project-card";

export const dynamic = "force-dynamic";

export default async function ProjectListPage() {
  const { projects } = await discoverAllProjects();

  if (projects.length === 0) {
    return (
      <div className="text-center py-20 text-neutral-500">
        <p className="text-lg">No projects with AI sessions found.</p>
        <p className="text-sm mt-2">
          Make sure you have Claude Code (or another supported agent) sessions on this machine.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Projects</h1>
      <p className="text-sm text-neutral-500 mb-6">
        {projects.length} {projects.length === 1 ? "project" : "projects"} with AI sessions
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <ProjectCard
            key={p.path}
            projectPath={p.path}
            agents={p.agents}
            sessionCounts={p.sessionCounts}
          />
        ))}
      </div>
    </div>
  );
}
