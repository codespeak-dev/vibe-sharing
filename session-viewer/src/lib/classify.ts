/**
 * Pure entry classification logic.
 *
 * Shared between client (grouping pipeline) and server (computeTags in cache-db).
 * MUST NOT import React or Node.js APIs.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface ClassifyEntry {
  type: string;
  raw: Record<string, unknown>;
}

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
  [key: string]: unknown;
}

// ── Entry tags ─────────────────────────────────────────────────────

export type EntryTag =
  | "user-prompt"
  | "assistant-text"
  | "plan"
  | "agent-question"
  | "exit-plan-mode"
  | "tool-call"
  | "tool-result"
  | "subagent"
  | "noise"
  | "filler"
  | "misc"
  | "unclassified";

// ── Helpers ────────────────────────────────────────────────────────

const PLANS_PATH = ".claude/plans/";
const NOISE_TYPES = new Set(["progress", "queue-operation", "file-history-snapshot"]);

function getBlocks(entry: ClassifyEntry): ContentBlock[] {
  const msg = entry.raw.message as MessageContent | undefined;
  return Array.isArray(msg?.content) ? msg.content : [];
}

function eType(entry: ClassifyEntry): string {
  return (entry.raw.type as string) ?? entry.type ?? "unknown";
}

function hasToolUse(entry: ClassifyEntry): boolean {
  return getBlocks(entry).some((b) => b.type === "tool_use");
}

function hasText(entry: ClassifyEntry): boolean {
  return getBlocks(entry).some((b) => b.type === "text" && (b.text ?? "").trim().length > 0);
}

function isToolResultOnly(entry: ClassifyEntry): boolean {
  const blocks = getBlocks(entry);
  return eType(entry) === "user" && blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
}

function toolNameIs(entry: ClassifyEntry, name: string): boolean {
  return getBlocks(entry).some((b) => b.type === "tool_use" && b.name === name);
}

function isPlanEntry(entry: ClassifyEntry): boolean {
  return getBlocks(entry).some(
    (b) => b.type === "tool_use" && typeof b.input?.file_path === "string" && (b.input.file_path as string).includes(PLANS_PATH),
  );
}

// ── Classification ─────────────────────────────────────────────────

const KNOWN_ENTRY_TYPES = new Set([
  "user", "assistant", "system",
  "progress", "queue-operation", "file-history-snapshot",
  "last-prompt", "ai-title",
]);

export function classifyTag(entry: ClassifyEntry): EntryTag {
  const t = eType(entry);

  if (t === "user") {
    if (isToolResultOnly(entry)) return "tool-result";
    return "user-prompt";
  }

  if (t === "assistant") {
    if (hasToolUse(entry)) {
      if (isPlanEntry(entry)) return "plan";
      if (toolNameIs(entry, "AskUserQuestion")) return "agent-question";
      if (toolNameIs(entry, "ExitPlanMode")) return "exit-plan-mode";
      if (toolNameIs(entry, "Agent")) return "subagent";
      return "tool-call";
    }
    if (hasText(entry)) return "assistant-text";
    return "filler";
  }

  if (t === "system") return "filler";
  if (NOISE_TYPES.has(t)) return "noise";

  // Known types that don't have special handling go to misc
  if (t === "last-prompt" || t === "ai-title") return "misc";

  // Truly unknown entry types
  if (!KNOWN_ENTRY_TYPES.has(t)) return "unclassified";

  return "misc";
}

// ── Re-exported helpers used by grouping.ts ────────────────────────

export { getBlocks, eType, hasToolUse, hasText, isToolResultOnly, toolNameIs, isPlanEntry, NOISE_TYPES };

export function getToolNames(entry: ClassifyEntry): string[] {
  return getBlocks(entry).filter((b) => b.type === "tool_use" && b.name).map((b) => b.name!);
}

// ── Exhaustive check helper ────────────────────────────────────────

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
