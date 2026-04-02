"use client";

import { useState } from "react";
import { JsonViewer } from "./json-viewer";
import { MessageRenderer, hasRenderedView } from "./message-renderer";
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
};

export function EntryCard({ entry }: { entry: SessionEntry }) {
  const canRender = hasRenderedView(entry.type);
  const [view, setView] = useState<"rendered" | "raw">(canRender ? "rendered" : "raw");
  const colorClass = TYPE_COLORS[entry.type] ?? "bg-neutral-800/50 text-neutral-400";

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-900/50 border-b border-neutral-800">
        <span className="text-[10px] text-neutral-600 font-mono w-8 text-right shrink-0">
          #{entry.lineIndex}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>
          {entry.type}
        </span>
        {entry.timestamp && (
          <span className="text-[10px] text-neutral-600">{formatDate(entry.timestamp)}</span>
        )}
        <div className="ml-auto flex gap-1">
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
      </div>

      {/* Body */}
      <div className="p-3">
        {view === "rendered" ? (
          <MessageRenderer entry={entry.raw} />
        ) : (
          <JsonViewer data={entry.raw} defaultCollapsed={false} />
        )}
      </div>
    </div>
  );
}
