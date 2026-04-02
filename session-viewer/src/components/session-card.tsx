"use client";

import { useRouter } from "next/navigation";
import { truncate, stripIdeTags } from "@/lib/format";
import { SessionStats } from "./session-stats";

interface SessionCardProps {
  sessionId: string;
  projectHref: string;
  agentName: string;
  aiTitle: string | null;
  summary: string | null;
  firstPrompt: string | null;
  messageCount: number | null;
  created: string | null;
  modified: string | null;
  sizeBytes: number;
  hasPlans?: boolean;
  firstPlanLineIndex?: number | null;
  userPromptCount?: number;
}

export function SessionCard({
  sessionId,
  projectHref,
  agentName,
  aiTitle,
  summary,
  firstPrompt,
  messageCount,
  created,
  modified,
  sizeBytes,
  hasPlans,
  firstPlanLineIndex,
  userPromptCount,
}: SessionCardProps) {
  const router = useRouter();
  const description = aiTitle || summary || (firstPrompt ? stripIdeTags(firstPrompt) : null);
  const displayText = description ? truncate(description, 120) : sessionId.slice(0, 20) + "...";
  const sessionHref = `${projectHref}/session/${sessionId}`;

  return (
    <div
      onClick={() => router.push(sessionHref)}
      className="block border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 hover:bg-neutral-900/50 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-relaxed line-clamp-2 min-w-0">{displayText}</p>
        <div className="flex items-center gap-1 shrink-0">
          {hasPlans && firstPlanLineIndex != null && (
            <a
              href={`${sessionHref}#entry-${firstPlanLineIndex}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-purple-300 bg-purple-900/50 rounded px-1.5 py-0.5 hover:bg-purple-900/80 transition-colors"
            >
              plan
            </a>
          )}
          <span className="text-xs text-neutral-500 bg-neutral-800 rounded px-1.5 py-0.5">
            {agentName}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <SessionStats
          messageCount={messageCount}
          userPromptCount={userPromptCount}
          created={created}
          modified={modified}
          sizeBytes={sizeBytes}
        />
      </div>
    </div>
  );
}
