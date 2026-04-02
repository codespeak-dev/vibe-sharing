"use client";

import Link from "next/link";
import { formatDate, formatBytes, truncate, stripIdeTags } from "@/lib/format";

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
}: SessionCardProps) {
  const description = aiTitle || summary || (firstPrompt ? stripIdeTags(firstPrompt) : null);
  const displayText = description ? truncate(description, 120) : sessionId.slice(0, 20) + "...";

  return (
    <Link
      href={`${projectHref}/session/${sessionId}`}
      className="block border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 hover:bg-neutral-900/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-relaxed line-clamp-2 min-w-0">{displayText}</p>
        <div className="flex items-center gap-1 shrink-0">
          {hasPlans && (
            <span className="text-xs text-purple-300 bg-purple-900/50 rounded px-1.5 py-0.5">
              plan
            </span>
          )}
          <span className="text-xs text-neutral-500 bg-neutral-800 rounded px-1.5 py-0.5">
            {agentName}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-neutral-500">
        {messageCount != null && (
          <span>{messageCount} {messageCount === 1 ? "msg" : "msgs"}</span>
        )}
        {modified && <span>{formatDate(modified)}</span>}
        <span>{formatBytes(sizeBytes)}</span>
      </div>
    </Link>
  );
}
