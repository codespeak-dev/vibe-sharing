"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripIdeTags, parseIdeTags, foldCwd, shortenPath, type IdeTag, truncate } from "@/lib/format";

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

const PLANS_PATH_MARKER = ".claude/plans/";

/** Check if a tool_use block targets a plan file. */
function isPlanToolUse(block: ContentBlock): boolean {
  if (block.type !== "tool_use") return false;
  const filePath = block.input?.file_path;
  return typeof filePath === "string" && filePath.includes(PLANS_PATH_MARKER);
}

/** Check if a tool_result block contains plan file content (from a Read). */
function isPlanToolResult(block: ContentBlock): boolean {
  if (block.type !== "tool_result") return false;
  const raw = typeof block.content === "string"
    ? block.content
    : Array.isArray(block.content)
      ? block.content.map((c) => (typeof c === "string" ? c : c.text ?? "")).join("")
      : "";
  return raw.includes(PLANS_PATH_MARKER);
}

/** Check if any content block in an entry references a plan file. */
export function entryReferencesPlans(entry: EntryRaw): boolean {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  return blocks.some((b) => isPlanToolUse(b) || isPlanToolResult(b));
}

/** Check if any content block in an entry is a thinking block. */
export function entryHasThinking(entry: EntryRaw): boolean {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  return blocks.some((b) => b.type === "thinking" && !!b.thinking);
}

/** Get IDE tags from text blocks in an entry. */
export function getEntryIdeTags(entry: EntryRaw): IdeTag[] {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  const tags: IdeTag[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      tags.push(...parseIdeTags(b.text).tags);
    }
  }
  return tags;
}

/** Get a short preview of the first thinking block in an entry. */
export function getThinkingPreview(entry: EntryRaw): string | null {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  const thinking = blocks.find((b) => b.type === "thinking" && !!b.thinking);
  if (!thinking?.thinking) return null;
  return thinking.thinking.split("\n")[0] ?? null;
}

/** Extract a human-readable plan name from a file path. */
function getPlanName(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  const name = idx >= 0 ? filePath.slice(idx + 1) : filePath;
  return name.replace(/\.md$/, "");
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
  "ai-title",
]);

export function hasRenderedView(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

/** Returns a display label for the badge — e.g. "tool-result" for user messages carrying tool results. */
export function getDisplayType(entry: EntryRaw): string {
  if (entry.type === "user") {
    const blocks = entry.message?.content;
    if (Array.isArray(blocks) && blocks.length > 0 && blocks.every((b) => b.type === "tool_result")) {
      return "tool-result";
    }
  }
  return entry.type ?? "unknown";
}

/** Extra text to display in the card header for certain entry types. */
export function getHeaderExtra(entry: EntryRaw): string | null {
  if (entry.type === "ai-title" && typeof entry.aiTitle === "string") {
    return entry.aiTitle;
  }
  if (entry.type === "file-history-snapshot") {
    const tracked = entry.snapshot as Record<string, unknown> | undefined;
    const backups = tracked?.trackedFileBackups as Record<string, unknown> | undefined;
    const count = backups ? Object.keys(backups).length : 0;
    if (count === 0) return "no files tracked";
  }
  return null;
}

/** Short preview text for collapsed card headers. */
export function getCollapsedPreview(entry: EntryRaw): string | null {
  switch (entry.type) {
    case "user": {
      const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
      const text = blocks.find((b) => b.type === "text")?.text;
      if (text) return stripIdeTags(text).split("\n")[0] ?? null;
      return null;
    }
    case "assistant": {
      const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
      const text = blocks.find((b) => b.type === "text")?.text;
      if (text) return text.split("\n")[0] ?? null;
      const tools = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => b.name ?? "tool");
      if (tools.length > 0) return tools.join(", ");
      return null;
    }
    case "system":
      return entry.subtype ?? null;
    case "progress":
      return (entry.data?.type as string) ?? null;
    case "queue-operation":
      return entry.operation ?? null;
    case "file-history-snapshot": {
      const tracked = entry.snapshot as Record<string, unknown> | undefined;
      const backups = tracked?.trackedFileBackups as Record<string, unknown> | undefined;
      const count = backups ? Object.keys(backups).length : 0;
      return count === 0 ? "no files tracked" : `${count} files tracked`;
    }
    case "last-prompt":
      return entry.lastPrompt?.split("\n")[0] ?? null;
    case "ai-title":
      return (entry.aiTitle as string) ?? null;
    default:
      return null;
  }
}

/** Whether the rendered body should be hidden (header-only display). */
export function isHeaderOnly(entry: EntryRaw): boolean {
  if (entry.type === "ai-title") return true;
  if (entry.type === "file-history-snapshot") {
    const tracked = entry.snapshot as Record<string, unknown> | undefined;
    const backups = tracked?.trackedFileBackups as Record<string, unknown> | undefined;
    const count = backups ? Object.keys(backups).length : 0;
    return count === 0;
  }
  return false;
}

export interface ToolUseInfo {
  name: string;
  input?: Record<string, unknown>;
}

/** Extract a meaningful detail string (file path, pattern, command) from tool input. */
function toolDetailStr(name: string, input: Record<string, unknown> | undefined, cwd: string): string | null {
  if (!input) return null;
  if (name === "Bash" && typeof input.command === "string") {
    return truncate(input.command.split("\n")[0] ?? "", 80);
  }
  const raw =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.path === "string" && input.path) ||
    (typeof input.pattern === "string" && input.pattern) ||
    null;
  if (!raw) return null;
  let s = cwd ? foldCwd(raw, cwd) : raw;
  if (s.length > 60) s = shortenPath(s, 60);
  return s;
}

export function MessageRenderer({ entry, cwd, toolMap, toolResultMap, defaultModel }: { entry: EntryRaw; cwd?: string; toolMap?: Map<string, ToolUseInfo>; toolResultMap?: Map<string, string>; defaultModel?: string }) {
  const type = entry.type ?? "unknown";

  switch (type) {
    case "user":
      return <UserMessage entry={entry} cwd={cwd ?? ""} toolMap={toolMap} toolResultMap={toolResultMap} />;
    case "assistant":
      return <AssistantMessage entry={entry} cwd={cwd ?? ""} toolResultMap={toolResultMap} defaultModel={defaultModel} />;
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
    case "ai-title":
      return null;
    default:
      return <p className="text-neutral-500 text-sm italic">No rendered view for type &quot;{type}&quot;</p>;
  }
}

function UserMessage({ entry, cwd, toolMap, toolResultMap }: { entry: EntryRaw; cwd: string; toolMap?: Map<string, ToolUseInfo>; toolResultMap?: Map<string, string> }) {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  return (
    <div className="space-y-2">
      {entry.message?.role && entry.message.role !== "user" && (
        <div className="text-xs text-neutral-500">role: {entry.message.role}</div>
      )}
      {blocks.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} cwd={cwd} toolMap={toolMap} toolResultMap={toolResultMap} />
      ))}
    </div>
  );
}

function AssistantMessage({ entry, cwd, toolResultMap, defaultModel }: { entry: EntryRaw; cwd: string; toolResultMap?: Map<string, string>; defaultModel?: string }) {
  const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []);
  const model = entry.message?.model ? String(entry.message.model) : null;
  const showModel = model && model !== defaultModel;
  return (
    <div className="space-y-2">
      {showModel && (
        <div className="text-xs text-neutral-500">{model}</div>
      )}
      {blocks.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} cwd={cwd} toolResultMap={toolResultMap} markdown />
      ))}
    </div>
  );
}

function ContentBlockRenderer({ block, cwd, toolMap, toolResultMap, markdown }: { block: ContentBlock; cwd: string; toolMap?: Map<string, ToolUseInfo>; toolResultMap?: Map<string, string>; markdown?: boolean }) {
  switch (block.type) {
    case "text":
      return <TextBlock text={block.text ?? ""} cwd={cwd} markdown={markdown} />;
    case "thinking":
      return <ThinkingBlock text={block.thinking ?? ""} />;
    case "tool_use":
      if (isPlanToolUse(block)) return <PlanToolUseBlock block={block} />;
      if (block.name === "AskUserQuestion") return <AskUserQuestionBlock block={block} toolResultMap={toolResultMap} />;
      return <ToolUseBlock block={block} cwd={cwd} />;
    case "tool_result":
      return <ToolResultBlock block={block} cwd={cwd} toolMap={toolMap} />;
    default:
      return (
        <div className="text-xs text-neutral-500 border border-neutral-800 rounded p-2">
          <span className="font-mono">{block.type}</span> block
        </div>
      );
  }
}

function foldAndShortenPreview(text: string, cwd: string, maxLen: number): string {
  let folded = foldCwd(text, cwd);
  // Shorten any remaining long paths (sequences of /word/word/...)
  folded = folded.replace(/(?:\/[\w._-]+){3,}/g, (match) => shortenPath(match, 40));
  return truncate(folded, maxLen);
}

function IdeTagBlock({ tagName, content, cwd }: { tagName: string; content: string; cwd: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = foldAndShortenPreview(content.split("\n")[0] ?? "", cwd, 60);
  const displayContent = foldCwd(content, cwd);

  return (
    <span className="inline-flex flex-col align-top">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 cursor-pointer transition-colors"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span className="font-mono">&lt;{tagName}&gt;</span>
        {!expanded && (
          <span className="font-normal text-neutral-500 max-w-[250px] truncate">{preview}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 text-xs text-neutral-400 whitespace-pre-wrap break-words leading-relaxed bg-neutral-900/50 border border-neutral-700 rounded p-2 max-h-96 overflow-y-auto">
          {displayContent}
        </div>
      )}
    </span>
  );
}

function TextBlock({ text, cwd, markdown }: { text: string; cwd: string; markdown?: boolean }) {
  const { segments, tags } = parseIdeTags(text);
  const hasIdeContent = tags.length > 0;

  // Check if there's any non-IDE text content
  const plainText = segments
    .filter((s) => s.type === "text")
    .map((s) => s.text ?? "")
    .join("")
    .trim();

  if (!plainText && !hasIdeContent) return null;

  return (
    <div className="space-y-2">
      {plainText && (markdown ? (
        <div className="text-sm leading-relaxed bg-neutral-900/30 rounded p-3 border border-neutral-800/50 prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-li:my-0 prose-pre:bg-neutral-950/50 prose-code:text-emerald-300">
          <Markdown remarkPlugins={[remarkGfm]}>{plainText}</Markdown>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed bg-neutral-900/30 rounded p-3 border border-neutral-800/50">
          {plainText}
        </div>
      ))}
      {hasIdeContent && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <IdeTagBlock key={i} tagName={tag.tagName} content={tag.content} cwd={cwd} />
          ))}
        </div>
      )}
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

function ToolUseBlock({ block, cwd }: { block: ContentBlock; cwd: string }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = block.input ? JSON.stringify(block.input, null, 2) : "";
  const name = block.name ?? "tool";
  const detail = toolDetailStr(name, block.input, cwd);

  return (
    <div className="border border-amber-900/50 rounded bg-amber-950/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-amber-950/30"
      >
        <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
        <span className="font-semibold text-amber-400">{name}</span>
        {detail && <span className="text-neutral-500 truncate font-mono">{detail}</span>}
      </button>
      {expanded && inputStr && (
        <pre className="px-3 pb-3 text-xs text-neutral-400 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
          {inputStr}
        </pre>
      )}
    </div>
  );
}

function PlanToolUseBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(true);
  const filePath = block.input?.file_path as string;
  const planName = getPlanName(filePath);
  const toolName = block.name ?? "tool";

  // Write: show rendered markdown content
  if (toolName === "Write") {
    const content = (block.input?.content as string) ?? "";
    return (
      <div className="border border-purple-900/50 rounded bg-purple-950/20">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-purple-950/30"
        >
          <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
          <span className="font-semibold text-purple-300">Plan: {planName}</span>
          <span className="text-purple-400/60">write</span>
        </button>
        {expanded && content && (
          <div className="px-3 pb-3 max-h-[600px] overflow-y-auto prose prose-invert prose-sm prose-purple max-w-none prose-headings:text-purple-200 prose-p:text-neutral-300 prose-li:text-neutral-300 prose-strong:text-neutral-200 prose-code:text-purple-300 prose-pre:bg-neutral-900/50">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}
      </div>
    );
  }

  // Edit: show old → new
  if (toolName === "Edit") {
    const oldStr = (block.input?.old_string as string) ?? "";
    const newStr = (block.input?.new_string as string) ?? "";
    return (
      <div className="border border-purple-900/50 rounded bg-purple-950/20">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-purple-950/30"
        >
          <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
          <span className="font-semibold text-purple-300">Plan: {planName}</span>
          <span className="text-purple-400/60">edit</span>
        </button>
        {expanded && (
          <div className="px-3 pb-3 space-y-2">
            {oldStr && (
              <div className="text-xs">
                <div className="text-red-400/70 font-mono mb-0.5">- old</div>
                <pre className="text-red-300/50 font-mono whitespace-pre-wrap break-words bg-red-950/20 rounded p-2 max-h-48 overflow-y-auto">{oldStr}</pre>
              </div>
            )}
            {newStr && (
              <div className="text-xs">
                <div className="text-green-400/70 font-mono mb-0.5">+ new</div>
                <pre className="text-green-300/50 font-mono whitespace-pre-wrap break-words bg-green-950/20 rounded p-2 max-h-48 overflow-y-auto">{newStr}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Read or other: just show plan name + action
  return (
    <div className="border border-purple-900/50 rounded bg-purple-950/20">
      <div className="px-3 py-1.5 text-xs flex items-center gap-2">
        <span className="font-semibold text-purple-300">Plan: {planName}</span>
        <span className="text-purple-400/60">{toolName.toLowerCase()}</span>
      </div>
    </div>
  );
}

interface QuestionDef {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string; preview?: string }>;
  multiSelect?: boolean;
}

/** Parse the structured answer string returned by AskUserQuestion tool results. */
function parseAnswerString(content: string): Map<string, string> {
  const answers = new Map<string, string>();
  let body = content;
  const prefix = "User has answered your questions: ";
  if (body.startsWith(prefix)) body = body.slice(prefix.length);
  const suffixIdx = body.lastIndexOf(". You can now continue");
  if (suffixIdx >= 0) body = body.slice(0, suffixIdx);
  const regex = /"([^"]*)"="([^"]*)"/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    answers.set(match[1]!, match[2]!);
  }
  return answers;
}

function AskUserQuestionBlock({ block, toolResultMap }: { block: ContentBlock; toolResultMap?: Map<string, string> }) {
  // Extract questions — support both `questions[]` array and single-question fallback
  const questions: QuestionDef[] = [];
  const rawQuestions = block.input?.questions;
  if (Array.isArray(rawQuestions)) {
    for (const q of rawQuestions) {
      questions.push({
        question: (q as Record<string, unknown>).question as string ?? "",
        header: (q as Record<string, unknown>).header as string | undefined,
        options: Array.isArray((q as Record<string, unknown>).options) ? (q as Record<string, unknown>).options as QuestionDef["options"] : [],
        multiSelect: (q as Record<string, unknown>).multiSelect as boolean | undefined,
      });
    }
  } else if (typeof block.input?.question === "string") {
    questions.push({
      question: block.input.question as string,
      header: block.input.header as string | undefined,
      options: Array.isArray(block.input.options) ? block.input.options as QuestionDef["options"] : [],
      multiSelect: block.input.multiSelect as boolean | undefined,
    });
  }

  // Parse the answer string from the tool result
  const rawAnswer = block.id && toolResultMap ? toolResultMap.get(block.id) : undefined;
  const answerMap = rawAnswer ? parseAnswerString(rawAnswer) : new Map<string, string>();

  return (
    <div className="border border-teal-900/50 rounded bg-teal-950/20">
      {questions.map((q, qi) => {
        const answer = answerMap.get(q.question);
        const selections = answer != null && q.multiSelect
          ? new Set(answer.split(", "))
          : null;
        const isOptionSelected = (label: string) =>
          answer != null && (selections ? selections.has(label) : answer === label);
        const allSelectionsMatchOptions = answer != null && (
          selections
            ? [...selections].every((s) => q.options.some((o) => o.label === s))
            : q.options.some((o) => o.label === answer)
        );
        // For multiSelect, find any selection that didn't match an option
        const otherText = answer != null && !allSelectionsMatchOptions
          ? (selections
              ? [...selections].filter((s) => !q.options.some((o) => o.label === s)).join(", ")
              : answer)
          : null;

        return (
          <div key={qi} className={`px-3 py-2 ${qi > 0 ? "border-t border-teal-900/30" : ""}`}>
            {q.header && (
              <div className="text-xs font-semibold text-teal-400 mb-1">{q.header}</div>
            )}
            <p className="text-sm text-neutral-200 mb-2">{q.question}</p>
            {q.options.length > 0 && (
              <div className="space-y-0.5">
                {q.options.map((opt, oi) => {
                  const isSelected = isOptionSelected(opt.label);
                  const indicator = q.multiSelect
                    ? (isSelected ? "\u2611" : "\u2610")
                    : (isSelected ? "\u25C9" : "\u25CB");
                  return (
                    <div
                      key={oi}
                      className={`flex items-start gap-2 rounded px-2 py-1 text-sm ${
                        isSelected ? "bg-teal-900/30" : ""
                      }`}
                    >
                      <span className={`shrink-0 mt-0.5 ${isSelected ? "text-teal-300" : "text-neutral-600"}`}>
                        {indicator}
                      </span>
                      <div className="min-w-0">
                        <span className={isSelected ? "text-teal-200 font-medium" : "text-neutral-400"}>
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="block text-xs text-neutral-500">{opt.description}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {otherText != null && (
              <div className={`flex items-start gap-2 rounded px-2 py-1 text-sm bg-teal-900/30 ${q.options.length > 0 ? "" : "mt-0"}`}>
                <span className="shrink-0 mt-0.5 text-teal-300">
                  {q.multiSelect ? "\u2611" : "\u25C9"}
                </span>
                <div className="min-w-0">
                  <span className="text-teal-200 font-medium">Other</span>
                  <span className="block text-xs text-neutral-500 mt-0.5">User commented:</span>
                  <span className="block text-xs text-teal-300/80 whitespace-pre-wrap break-words">{otherText}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolResultBlock({ block, cwd, toolMap }: { block: ContentBlock; cwd: string; toolMap?: Map<string, ToolUseInfo> }) {
  const [expanded, setExpanded] = useState(true);
  let content = "";
  if (typeof block.content === "string") {
    content = block.content;
  } else if (Array.isArray(block.content)) {
    content = block.content
      .map((c) => (typeof c === "string" ? c : c.text ?? JSON.stringify(c)))
      .join("\n");
  }

  // Resolve tool name + detail from the matching tool_use block
  const resolved = block.tool_use_id && toolMap ? toolMap.get(block.tool_use_id) : undefined;
  const toolName = resolved?.name ?? null;
  const detail = resolved ? toolDetailStr(resolved.name, resolved.input, cwd) : null;

  return (
    <div className="border border-neutral-800 rounded bg-neutral-950/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-neutral-900/50"
      >
        <span className="text-neutral-500">{expanded ? "v" : ">"}</span>
        <span className="text-neutral-400">{toolName ? `${toolName} result` : "Tool Result"}</span>
        {detail && <span className="text-neutral-500 truncate font-mono">{detail}</span>}
        {!detail && block.tool_use_id && (
          <span className="text-neutral-600 font-mono text-[10px]">
            {block.tool_use_id.slice(0, 12)}...
          </span>
        )}
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
