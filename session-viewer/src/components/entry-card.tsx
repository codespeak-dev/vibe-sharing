"use client";

import { useState, useEffect } from "react";
import { JsonViewer } from "./json-viewer";
import { MessageRenderer, hasRenderedView, getHeaderExtra, isHeaderOnly, getCollapsedPreview, getDisplayType, entryReferencesPlans, entryHasThinking, getThinkingPreview } from "./message-renderer";
import { truncate } from "@/lib/format";
import { formatDate } from "@/lib/format";

interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

const TYPE_COLORS: Record<string, string> = {
  user: "bg-blue-900/50 text-blue-300",
  assistant: "bg-green-900/50 text-green-300",
  system: "bg-neutral-800 text-neutral-300",
  progress: "bg-neutral-800/50 text-neutral-400",
  "queue-operation": "bg-neutral-800/50 text-neutral-400",
  "file-history-snapshot": "bg-neutral-800/50 text-neutral-400",
  "last-prompt": "bg-purple-900/50 text-purple-300",
  "ai-title": "bg-cyan-900/50 text-cyan-300",
  "tool-result": "bg-amber-900/50 text-amber-300",
};

export function EntryCard({ entry, forceExpanded }: { entry: SessionEntry; forceExpanded?: boolean }) {
  const canRender = hasRenderedView(entry.type);
  const headerOnly = isHeaderOnly(entry.raw);
  const displayType = getDisplayType(entry.raw);
  const defaultExpanded = displayType === "user" || !!forceExpanded;
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (forceExpanded && !expanded) setExpanded(true);
  }, [forceExpanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<"rendered" | "raw">(canRender ? "rendered" : "raw");
  const colorClass = TYPE_COLORS[displayType] ?? "bg-neutral-800/50 text-neutral-400";
  const headerExtra = getHeaderExtra(entry.raw);
  const preview = getCollapsedPreview(entry.raw);
  const hasPlan = entryReferencesPlans(entry.raw);
  const hasThinking = entryHasThinking(entry.raw);
  const thinkingPreview = hasThinking ? getThinkingPreview(entry.raw) : null;
  const showBody = expanded && !(view === "rendered" && headerOnly);

  return (
    <div id={`entry-${entry.lineIndex}`} className="border border-neutral-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-neutral-900/50 cursor-pointer hover:bg-neutral-900/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-neutral-600 shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="text-[10px] text-neutral-600 font-mono w-8 text-right shrink-0">
          #{entry.lineIndex}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${colorClass}`}>
          {displayType}
        </span>
        {hasPlan && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-purple-900/50 text-purple-300">
            plan
          </span>
        )}
        {hasThinking && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-sky-900/50 text-sky-300">
            thinking
          </span>
        )}
        {entry.timestamp && (
          <span className="text-[10px] text-neutral-600 shrink-0">{formatDate(entry.timestamp)}</span>
        )}
        {headerExtra && (
          <span className="text-[10px] text-neutral-400 truncate">{headerExtra}</span>
        )}
        {!expanded && preview && !headerExtra && (
          <span className="text-[10px] text-neutral-500 truncate">{truncate(preview, 120)}</span>
        )}
        {!expanded && thinkingPreview && (
          <span className="text-[10px] text-sky-400/60 truncate italic">{truncate(thinkingPreview, 80)}</span>
        )}
        {expanded && (
          <div className="ml-auto flex gap-1" onClick={(e) => e.stopPropagation()}>
            {canRender && (
              <button
                onClick={() => setView("rendered")}
                className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  view === "rendered"
                    ? "bg-neutral-700 text-neutral-200"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Rendered
              </button>
            )}
            <button
              onClick={() => setView("raw")}
              className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                view === "raw"
                  ? "bg-neutral-700 text-neutral-200"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              JSON
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {showBody && (
        <div className="p-3 border-t border-neutral-800">
          {view === "rendered" ? (
            <MessageRenderer entry={entry.raw} />
          ) : (
            <JsonViewer data={entry.raw} defaultCollapsed={false} />
          )}
        </div>
      )}
    </div>
  );
}
