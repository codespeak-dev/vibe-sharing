"use client";

import { useState } from "react";
import { stripIdeTags, truncate } from "@/lib/format";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
  tool_use_id?: string;
  [key: string]: unknown;
}

interface MessageContent {
  role?: string;
  content?: ContentBlock[];
  model?: string;
  [key: string]: unknown;
}

interface EntryRaw {
  type?: string;
  subtype?: string;
  message?: MessageContent;
  operation?: string;
  data?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  lastPrompt?: string;
  hookCount?: number;
  hookInfos?: Array<{ command?: string; durationMs?: number }>;
  hookErrors?: string[];
  stopReason?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Known types that have a rendered view
const KNOWN_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "progress",
  "queue-operation",
  "file-history-snapshot",
  "last-prompt",
]);

export function hasRenderedView(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

export function MessageRenderer({ entry }: { entry: EntryRaw }) {
  const type = entry.type ?? "unknown";

  switch (type) {
    case "user":
      return <UserMessage entry={entry} />;
    case "assistant":
      return <AssistantMessage entry={entry} />;
    case "system":
      return <SystemMessage entry={entry} />;
    case "progress":
      return <ProgressMessage entry={entry} />;
    case "queue-operation":
      return <QueueOperation entry={entry} />;
    case "file-history-snapshot":
      return <FileSnapshot entry={entry} />;
    case "last-prompt":
      return <LastPrompt entry={entry} />;
    default:
      return <p className="text-neutral-500 text-sm italic">No rendered view for type &quot;{type}&quot;</p>;
  }
}

function UserMessage({ entry }: { entry: EntryRaw }) {
  const blocks = entry.message?.content ?? [];
  return (
    <div className="space-y-2">
      {entry.message?.role && entry.message.role !== "user" && (
        <div className="text-xs text-neutral-500">role: {entry.message.role}</div>
      )}
      {blocks.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

function AssistantMessage({ entry }: { entry: EntryRaw }) {
  const blocks = entry.message?.content ?? [];
  return (
    <div className="space-y-2">
      {entry.message?.model && (
        <div className="text-xs text-neutral-500">{String(entry.message.model)}</div>
      )}
      {blocks.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return <TextBlock text={block.text ?? ""} />;
    case "thinking":
      return <ThinkingBlock text={block.thinking ?? ""} />;
    case "tool_use":
      return <ToolUseBlock block={block} />;
    case "tool_result":
      return <ToolResultBlock block={block} />;
    default:
      return (
        <div className="text-xs text-neutral-500 border border-neutral-800 rounded p-2">
          <span className="font-mono">{block.type}</span> block
        </div>
      );
  }
}

function TextBlock({ text }: { text: string }) {
  const cleaned = stripIdeTags(text);
  if (!cleaned) return null;
  return (
    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed bg-neutral-900/30 rounded p-3 border border-neutral-800/50">
      {cleaned}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  return (
    <div className="border border-neutral-800 rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5 cursor-pointer"
      >
        <span>{expanded ? "v" : ">"}</span>
        <span className="italic">Thinking</span>
        {!expanded && (
          <span className="text-neutral-600 truncate">
            {truncate(text.split("\n")[0] ?? "", 80)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-xs text-neutral-400 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolUseBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = block.input ? JSON.stringify(block.input, null, 2) : "";
  const inputPreview = block.input
    ? truncate(JSON.stringify(block.input), 80)
    : "";

  return (
    <div className="border border-amber-900/50 rounded bg-amber-950/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-amber-950/30"
      >
        <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
        <span className="font-semibold text-amber-400">{block.name ?? "tool"}</span>
        {!expanded && (
          <span className="text-neutral-500 truncate font-mono">{inputPreview}</span>
        )}
      </button>
      {expanded && inputStr && (
        <pre className="px-3 pb-3 text-xs text-neutral-400 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
          {inputStr}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  let content = "";
  if (typeof block.content === "string") {
    content = block.content;
  } else if (Array.isArray(block.content)) {
    content = block.content
      .map((c) => (typeof c === "string" ? c : c.text ?? JSON.stringify(c)))
      .join("\n");
  }
  const preview = truncate(content.split("\n")[0] ?? "", 80);

  return (
    <div className="border border-neutral-800 rounded bg-neutral-950/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-neutral-900/50"
      >
        <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
        <span className="text-neutral-400">Tool Result</span>
        {block.tool_use_id && (
          <span className="text-neutral-600 font-mono text-[10px]">
            {block.tool_use_id.slice(0, 12)}...
          </span>
        )}
        {!expanded && <span className="text-neutral-500 truncate">{preview}</span>}
      </button>
      {expanded && content && (
        <pre className="px-3 pb-3 text-xs text-neutral-400 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

function SystemMessage({ entry }: { entry: EntryRaw }) {
  const subtype = entry.subtype ?? "";
  return (
    <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
      {subtype && (
        <div className="text-xs text-neutral-500 font-mono mb-1">{subtype}</div>
      )}
      {subtype === "stop_hook_summary" && entry.hookInfos && (
        <div className="text-xs text-neutral-400 mt-1 space-y-0.5">
          {entry.hookInfos.map((h, i) => (
            <div key={i}>
              <span className="font-mono">{h.command}</span>
              {h.durationMs != null && (
                <span className="text-neutral-600 ml-2">({h.durationMs}ms)</span>
              )}
            </div>
          ))}
          {entry.hookErrors && entry.hookErrors.length > 0 && (
            <div className="text-red-400 mt-1">
              Errors: {entry.hookErrors.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressMessage({ entry }: { entry: EntryRaw }) {
  const dataType = entry.data?.type as string | undefined;
  return (
    <div className="text-xs text-neutral-500 flex items-center gap-2">
      {dataType && <span className="font-mono">{dataType}</span>}
    </div>
  );
}

function QueueOperation({ entry }: { entry: EntryRaw }) {
  return (
    <div className="text-xs text-neutral-500 flex items-center gap-2">
      <span className="font-mono">{entry.operation ?? "unknown"}</span>
    </div>
  );
}

function FileSnapshot({ entry }: { entry: EntryRaw }) {
  const [expanded, setExpanded] = useState(false);
  const trackedFiles = entry.snapshot?.trackedFileBackups as Record<string, unknown> | undefined;
  const fileCount = trackedFiles ? Object.keys(trackedFiles).length : 0;

  return (
    <div className="border border-neutral-800 rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs text-neutral-500 flex items-center gap-2 cursor-pointer hover:text-neutral-300"
      >
        <span>{expanded ? "v" : ">"}</span>
        <span className="text-neutral-600">{fileCount} files tracked</span>
      </button>
      {expanded && trackedFiles && Object.keys(trackedFiles).length > 0 && (
        <div className="px-3 pb-2 text-xs text-neutral-500 font-mono space-y-0.5">
          {Object.keys(trackedFiles).map((f) => (
            <div key={f}>{f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function LastPrompt({ entry }: { entry: EntryRaw }) {
  return (
    <div className="border border-neutral-800 rounded p-3">
      <p className="text-sm whitespace-pre-wrap break-words">{entry.lastPrompt ?? ""}</p>
    </div>
  );
}
