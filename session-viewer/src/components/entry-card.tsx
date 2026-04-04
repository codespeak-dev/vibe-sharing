"use client";

import { useState, useEffect } from "react";
import { JsonViewer } from "./json-viewer";
import { MessageRenderer, hasRenderedView, getHeaderExtra, isHeaderOnly, getCollapsedPreview, getDisplayType, entryReferencesPlans, entryHasThinking, getThinkingPreview, getEntryIdeTags, type ToolUseInfo } from "./message-renderer";
import { truncate, foldCwd, shortenPath } from "@/lib/format";
import { formatDateTime } from "@/lib/format";

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

/** Extract a short file/path/pattern label from a tool_use input. */
function toolDetail(info: ToolUseInfo, cwd: string): string | null {
  const inp = info.input;
  if (!inp) return null;
  // Bash: show command, truncated from the end
  if (info.name === "Bash" && typeof inp.command === "string") {
    const cmd = inp.command.split("\n")[0] ?? "";
    return truncate(cmd, 80);
  }
  const raw =
    (typeof inp.file_path === "string" && inp.file_path) ||
    (typeof inp.path === "string" && inp.path) ||
    (typeof inp.pattern === "string" && inp.pattern) ||
    null;
  if (!raw) return null;
  let s = cwd ? foldCwd(raw, cwd) : raw;
  if (s.length > 50) s = shortenPath(s, 50);
  return s;
}

export function EntryCard({ entry, forceExpanded, projectPath, toolMap, defaultModel }: { entry: SessionEntry; forceExpanded?: boolean; projectPath?: string; toolMap?: Map<string, ToolUseInfo>; defaultModel?: string }) {
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
  const cwd = projectPath || (typeof entry.raw.cwd === "string" ? entry.raw.cwd : "");
  const ideTags = getEntryIdeTags(entry.raw);

  // Build tool badges + detail for the header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMsg = (entry.raw as any)?.message;
  const contentBlocks: Array<Record<string, unknown>> = Array.isArray(rawMsg?.content) ? rawMsg.content : [];
  const toolInfos: Array<{ name: string; detail: string | null }> = [];
  for (const b of contentBlocks) {
    if (b.type === "tool_use" && typeof b.name === "string") {
      toolInfos.push({ name: b.name, detail: toolDetail({ name: b.name, input: b.input as Record<string, unknown> | undefined }, cwd) });
    } else if (b.type === "tool_result" && typeof b.tool_use_id === "string" && toolMap) {
      const info = toolMap.get(b.tool_use_id);
      if (info) {
        toolInfos.push({ name: info.name, detail: toolDetail(info, cwd) });
      }
    }
  }

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
        {ideTags.map((tag, i) => (
          <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-neutral-800 text-neutral-400 font-mono">
            &lt;{tag.tagName}&gt;
          </span>
        ))}
        {headerExtra && (
          <span className="text-[10px] text-neutral-400 truncate">{headerExtra}</span>
        )}
        {toolInfos.map((t, i) => (
          <span key={`tool-${i}`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-amber-900/50 text-amber-300">
            {t.name}
          </span>
        ))}
        {toolInfos.length > 0 && (
          <span className="text-[10px] text-neutral-500 truncate font-mono">
            {toolInfos.map((t) => t.detail).filter(Boolean).join(", ")}
          </span>
        )}
        {toolInfos.length === 0 && preview && !headerExtra && (
          <span className="text-[10px] text-neutral-500 truncate">{truncate(preview, 120)}</span>
        )}
        {thinkingPreview && (
          <span className="text-[10px] text-sky-400/60 truncate italic">{truncate(thinkingPreview, 80)}</span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {expanded && canRender && (
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
          {expanded && (
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
          )}
          {entry.timestamp && (
            <span className="text-[10px] text-neutral-600 shrink-0">{formatDateTime(entry.timestamp)}</span>
          )}
        </div>
      </div>

      {/* Body */}
      {showBody && (
        <div className="p-3 border-t border-neutral-800">
          {view === "rendered" ? (
            <MessageRenderer entry={entry.raw} cwd={cwd} toolMap={toolMap} defaultModel={defaultModel} />
          ) : (
            <JsonViewer data={entry.raw} defaultCollapsed={false} />
          )}
        </div>
      )}
    </div>
  );
}
