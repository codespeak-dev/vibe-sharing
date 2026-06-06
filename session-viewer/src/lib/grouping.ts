/**
 * Three-layer grouping pipeline for the session viewer.
 *
 * Layer 1: Classify each entry (expanded/collapsed, primary, topical group)
 * Layer 2: Merge consecutive entries with same topical group
 * Layer 3: Collect non-primary items between primary items into collapsed groups
 */

// ── Types ──────────────────────────────────────────────────────────

export interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
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

// ── Layer output types ─────────────────────────────────────────────

export interface ClassifiedEntry {
  kind: "entry";
  entry: SessionEntry;
  isPrimary: boolean;
  defaultExpanded: boolean;
}

export type TopicalGroupType = "tool-call" | "noise";

export interface TopicalGroup {
  kind: "topical-group";
  groupType: TopicalGroupType;
  entries: SessionEntry[];
  summary: string;
}

export type Layer2Item = TopicalGroup | ClassifiedEntry;

export interface CollapsedGroup {
  kind: "collapsed-group";
  items: Layer2Item[];
  summary: string;
}

export type DisplayItem = ClassifiedEntry | CollapsedGroup;

// ── Helpers ────────────────────────────────────────────────────────

const PLANS_PATH = ".claude/plans/";
const NOISE_TYPES = new Set(["progress", "queue-operation", "file-history-snapshot"]);

function getBlocks(entry: SessionEntry): ContentBlock[] {
  const msg = entry.raw.message as MessageContent | undefined;
  return Array.isArray(msg?.content) ? msg.content : [];
}

function eType(entry: SessionEntry): string {
  return (entry.raw.type as string) ?? entry.type ?? "unknown";
}

function hasToolUse(entry: SessionEntry): boolean {
  return getBlocks(entry).some((b) => b.type === "tool_use");
}

function hasText(entry: SessionEntry): boolean {
  return getBlocks(entry).some((b) => b.type === "text" && (b.text ?? "").trim().length > 0);
}

function isToolResultOnly(entry: SessionEntry): boolean {
  const blocks = getBlocks(entry);
  return eType(entry) === "user" && blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
}

function getToolNames(entry: SessionEntry): string[] {
  return getBlocks(entry).filter((b) => b.type === "tool_use" && b.name).map((b) => b.name!);
}

function toolNameIs(entry: SessionEntry, name: string): boolean {
  return getBlocks(entry).some((b) => b.type === "tool_use" && b.name === name);
}

function isPlanEntry(entry: SessionEntry): boolean {
  return getBlocks(entry).some(
    (b) => b.type === "tool_use" && typeof b.input?.file_path === "string" && (b.input.file_path as string).includes(PLANS_PATH),
  );
}

// ── Layer 1: Classification ────────────────────────────────────────

export type EntryTag =
  | "user-prompt"
  | "assistant-text"
  | "plan"
  | "agent-question"
  | "exit-plan-mode"
  | "tool-call"
  | "tool-result"
  | "agent-answer"   // tool_result answering an AskUserQuestion/ExitPlanMode — visible by default
  | "subagent"
  | "noise"
  | "filler"   // thinking-only assistant, system hooks
  | "misc";

// Ids of AskUserQuestion/ExitPlanMode tool_use blocks across the session — used to recognise
// the user entries that ANSWER them, which the spec wants visible by default.
function answerToolUseIds(entries: SessionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    for (const b of getBlocks(e)) {
      if (b.type === "tool_use" && (b.name === "AskUserQuestion" || b.name === "ExitPlanMode") && typeof b.id === "string") {
        ids.add(b.id);
      }
    }
  }
  return ids;
}

function isAgentAnswer(entry: SessionEntry, answerIds: Set<string>): boolean {
  if (!isToolResultOnly(entry)) return false;
  return getBlocks(entry).some(
    (b) => b.type === "tool_result" && typeof b.tool_use_id === "string" && answerIds.has(b.tool_use_id),
  );
}

function classifyTag(entry: SessionEntry, answerIds: Set<string>): EntryTag {
  const t = eType(entry);

  if (t === "user") {
    if (isToolResultOnly(entry)) return isAgentAnswer(entry, answerIds) ? "agent-answer" : "tool-result";
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
  return "misc";
}

/** Which tags are primary interest by default? */
const PRIMARY_TAGS = new Set<EntryTag>([
  "user-prompt", "assistant-text", "plan", "agent-question", "exit-plan-mode", "agent-answer",
]);

/** Which tags default to expanded cards? */
const EXPANDED_TAGS = new Set<EntryTag>([
  "user-prompt", "assistant-text", "plan", "agent-question", "agent-answer",
]);

/** Which tags participate in topical grouping, and what group type? */
const TOPICAL_MAP: Partial<Record<EntryTag, TopicalGroupType>> = {
  "tool-call": "tool-call",
  "tool-result": "tool-call",
  "subagent": "tool-call",
  "filler": "tool-call",   // filler joins whatever group surrounds it
  "noise": "noise",
};

function classify(entry: SessionEntry, answerIds: Set<string>): ClassifiedEntry {
  const tag = classifyTag(entry, answerIds);
  return {
    kind: "entry",
    entry,
    isPrimary: PRIMARY_TAGS.has(tag),
    defaultExpanded: EXPANDED_TAGS.has(tag),
  };
}

/** Get the topical group type for an entry, or null if standalone. */
function topicalType(entry: SessionEntry, answerIds: Set<string>): TopicalGroupType | null {
  return TOPICAL_MAP[classifyTag(entry, answerIds)] ?? null;
}

// ── Layer 2: Topical Grouping ──────────────────────────────────────

function toolCallSummary(entries: SessionEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const name of getToolNames(e)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return `${entries.length} entries`;
  const breakdown = [...counts.entries()].map(([n, c]) => `${n}(${c})`).join(" ");
  return `${total} tool call${total === 1 ? "" : "s"}  ${breakdown}`;
}

function noiseSummary(entries: SessionEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const t = eType(e);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([t, c]) => `${c} ${t}`).join(" + ");
}

function groupSummary(type: TopicalGroupType, entries: SessionEntry[]): string {
  return type === "tool-call" ? toolCallSummary(entries) : noiseSummary(entries);
}

function buildLayer2(entries: SessionEntry[], answerIds: Set<string>): Layer2Item[] {
  const items: Layer2Item[] = [];
  let buf: SessionEntry[] = [];
  let bufType: TopicalGroupType | null = null;

  const flush = () => {
    if (buf.length > 0 && bufType !== null) {
      if (buf.length === 1) {
        // Single-entry group → just emit as a classified entry, no wrapper
        items.push(classify(buf[0]!, answerIds));
      } else {
        items.push({ kind: "topical-group", groupType: bufType, entries: buf, summary: groupSummary(bufType, buf) });
      }
      buf = [];
      bufType = null;
    }
  };

  for (const entry of entries) {
    const tt = topicalType(entry, answerIds);
    const cls = classify(entry, answerIds);

    // Primary entries always standalone — flush any group first
    if (cls.isPrimary) {
      flush();
      items.push(cls);
      continue;
    }

    // Entry wants to join a topical group
    if (tt !== null) {
      // Filler is special: it joins whatever group is active, or starts noise
      const effectiveType: TopicalGroupType | null =
        (tt === "tool-call" && classifyTag(entry, answerIds) === "filler" && bufType === "noise")
          ? "noise"
          : (tt === "tool-call" && classifyTag(entry, answerIds) === "filler" && bufType === null)
          ? null  // standalone filler when no group active → treat as standalone
          : tt;

      if (effectiveType === null) {
        // No active group and filler can't start one → standalone
        flush();
        items.push(cls);
        continue;
      }

      if (bufType === effectiveType) {
        // Same group type — accumulate
        buf.push(entry);
      } else if (bufType === null) {
        // Start new group
        bufType = effectiveType;
        buf = [entry];
      } else {
        // Different group type — flush old, start new
        flush();
        bufType = effectiveType;
        buf = [entry];
      }
      continue;
    }

    // No topical group → standalone
    flush();
    items.push(cls);
  }
  flush();

  return items;
}

// ── Layer 3: Collapse Intermediate Actions ─────────────────────────

function isPrimaryItem(item: Layer2Item): boolean {
  return item.kind === "entry" && item.isPrimary;
}

function collapsedSummary(items: Layer2Item[]): string {
  let entryCount = 0;
  let topicalCount = 0;
  for (const item of items) {
    if (item.kind === "topical-group") {
      topicalCount++;
      entryCount += item.entries.length;
    } else {
      entryCount++;
    }
  }
  // Show summary of what's inside
  const parts: string[] = [];
  for (const item of items) {
    if (item.kind === "topical-group") {
      parts.push(item.summary);
    }
  }
  const standaloneCount = items.filter((i) => i.kind === "entry").length;
  if (standaloneCount > 0) {
    parts.push(`${standaloneCount} other`);
  }
  return parts.join(", ") || `${entryCount} entries`;
}

function buildLayer3(layer2: Layer2Item[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let nonPrimaryBuf: Layer2Item[] = [];

  const flushBuf = () => {
    if (nonPrimaryBuf.length > 0) {
      result.push({
        kind: "collapsed-group",
        items: nonPrimaryBuf,
        summary: collapsedSummary(nonPrimaryBuf),
      });
      nonPrimaryBuf = [];
    }
  };

  for (const item of layer2) {
    if (isPrimaryItem(item)) {
      flushBuf();
      result.push(item as ClassifiedEntry);
    } else {
      nonPrimaryBuf.push(item);
    }
  }
  flushBuf();

  return result;
}

// ── Public API ─────────────────────────────────────────────────────

export function buildDisplayItems(entries: SessionEntry[]): DisplayItem[] {
  const answerIds = answerToolUseIds(entries);
  const layer2 = buildLayer2(entries, answerIds);
  return buildLayer3(layer2);
}
