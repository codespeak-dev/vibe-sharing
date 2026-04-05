/**
 * Three-layer grouping pipeline for the session viewer.
 *
 * Layer 1: Classify each entry (expanded/collapsed, primary, topical group)
 * Layer 2: Merge consecutive entries with same topical group
 * Layer 3: Collect non-primary items between primary items into collapsed groups
 */

import {
  classifyTag,
  eType,
  getToolNames,
  type EntryTag,
  type ClassifyEntry,
} from "./classify";
import { DEFAULT_PRIMARY_TAGS, DEFAULT_EXPANDED_TAGS } from "./message-type-registry";

// Re-export so existing consumers don't need to change their import source
export type { EntryTag } from "./classify";
export { DEFAULT_PRIMARY_TAGS, DEFAULT_EXPANDED_TAGS };

// ── Types ──────────────────────────────────────────────────────────

export interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
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
  entryCount: number;
  summary: string;
  duration: string | null;
}

export type DisplayItem = ClassifiedEntry | CollapsedGroup;

// ── Helpers ────────────────────────────────────────────────────────

/** Adapt SessionEntry to the ClassifyEntry interface expected by classifyTag. */
function asClassifyEntry(entry: SessionEntry): ClassifyEntry {
  return { type: entry.type, raw: entry.raw };
}

// ── Layer 1: Classification ────────────────────────────────────────

/** Overrides that can be passed from the filter UI. */
export interface DisplayOverrides {
  primary?: Partial<Record<EntryTag, boolean>>;
  expanded?: Partial<Record<EntryTag, boolean>>;
}

/** Which tags participate in topical grouping, and what group type?
 *  Subagents are NOT grouped with tool calls — they stay standalone.
 *  Filler (thinking-only) does NOT join tool-call groups — thinking breaks the run.
 *  Only system hooks and noise can sit inside a tool-call group without breaking it. */
const TOPICAL_MAP: Partial<Record<EntryTag, TopicalGroupType>> = {
  "tool-call": "tool-call",
  "tool-result": "tool-call",
  "noise": "noise",
};

/** Tags that can sit inside an active tool-call group without breaking it.
 *  Thinking-only assistant entries ("filler") are NOT included — they break tool runs. */
const TOOL_GROUP_JOINERS = new Set<EntryTag>(["noise"]);

function classify(entry: SessionEntry, overrides?: DisplayOverrides): ClassifiedEntry {
  const tag = classifyTag(asClassifyEntry(entry));
  const isPrimary = overrides?.primary?.[tag] ?? DEFAULT_PRIMARY_TAGS.has(tag);
  const defaultExpanded = overrides?.expanded?.[tag] ?? DEFAULT_EXPANDED_TAGS.has(tag);
  return {
    kind: "entry",
    entry,
    isPrimary,
    defaultExpanded,
  };
}

/** Get the topical group type for an entry, or null if standalone. */
function topicalType(entry: SessionEntry): TopicalGroupType | null {
  return TOPICAL_MAP[classifyTag(asClassifyEntry(entry))] ?? null;
}

// ── Layer 2: Topical Grouping ──────────────────────────────────────

/** Topical group summary: e.g. "1 Read" or "3 Read, 2 Bash". */
function toolCallSummary(entries: SessionEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const name of getToolNames(asClassifyEntry(e))) {
      const label = name === "Agent" ? "Subagent" : name;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return `${entries.length} entries`;

  // For pure-TodoWrite groups, summarize the final todo state
  if (counts.size === 1 && counts.has("TodoWrite")) {
    const lastTodos = getLastTodoState(entries);
    if (lastTodos) return lastTodos;
  }

  return [...counts.entries()].map(([n, c]) => `${c} ${n}`).join(", ");
}

const TODO_ICONS: Record<string, string> = {
  pending: "·",
  in_progress: "▶",
  completed: "✓",
  cancelled: "✗",
};

/** Build a rich summary from the last TodoWrite call: [done/total] + per-status icon counts. */
function getLastTodoState(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: unknown[] = (entries[i]!.raw as any)?.message?.content ?? [];
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks as Array<Record<string, unknown>>) {
      if (b.type === "tool_use" && b.name === "TodoWrite") {
        const todos = (b.input as Record<string, unknown>)?.todos;
        if (!Array.isArray(todos) || todos.length === 0) continue;
        const typed = todos as Array<{ status?: string }>;
        const total = typed.length;
        const done = typed.filter((t) => t.status === "completed").length;
        const statusCounts: Record<string, number> = {};
        for (const t of typed) {
          const key = t.status ?? "pending";
          statusCounts[key] = (statusCounts[key] ?? 0) + 1;
        }
        const parts = Object.entries(statusCounts)
          .map(([k, v]) => `${TODO_ICONS[k] ?? k} ${v}`)
          .join("  ");
        return `Todos [${done}/${total}]  ${parts}`;
      }
    }
  }
  return null;
}

function noiseSummary(entries: SessionEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const t = eType(asClassifyEntry(e));
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([t, c]) => `${c} ${t}`).join(" + ");
}

function groupSummary(type: TopicalGroupType, entries: SessionEntry[]): string {
  return type === "tool-call" ? toolCallSummary(entries) : noiseSummary(entries);
}

function buildLayer2(entries: SessionEntry[], overrides?: DisplayOverrides): Layer2Item[] {
  const items: Layer2Item[] = [];
  let buf: SessionEntry[] = [];
  let bufType: TopicalGroupType | null = null;

  const flush = () => {
    if (buf.length > 0 && bufType !== null) {
      if (buf.length === 1) {
        // Single-entry group → just emit as a classified entry, no wrapper
        items.push(classify(buf[0]!, overrides));
      } else {
        items.push({ kind: "topical-group", groupType: bufType, entries: buf, summary: groupSummary(bufType, buf) });
      }
      buf = [];
      bufType = null;
    }
  };

  for (const entry of entries) {
    const tag = classifyTag(asClassifyEntry(entry));
    const tt = topicalType(entry);
    const cls = classify(entry, overrides);

    // Primary entries always standalone — flush any group first
    if (cls.isPrimary) {
      flush();
      items.push(cls);
      continue;
    }

    // Entry has an explicit topical group type (tool-call, tool-result, noise)
    if (tt !== null) {
      if (bufType === tt) {
        buf.push(entry);
      } else if (bufType === null) {
        bufType = tt;
        buf = [entry];
      } else {
        flush();
        bufType = tt;
        buf = [entry];
      }
      continue;
    }

    // System hooks (filler with type "system") can join an active tool-call group
    // but thinking-only entries break the group
    if (tag === "filler" && eType(asClassifyEntry(entry)) === "system" && bufType === "tool-call") {
      buf.push(entry);
      continue;
    }

    // Noise entries can sit inside an active tool-call group
    if (TOOL_GROUP_JOINERS.has(tag) && bufType === "tool-call") {
      buf.push(entry);
      continue;
    }

    // Everything else is standalone — flush and emit
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

/** Format a duration in ms to a human-readable string (e.g. "2m 13s", "450ms"). */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/** Compute the time span across all entries in a set of Layer2Items. */
function groupDuration(items: Layer2Item[]): string | null {
  let minTs: number | null = null;
  let maxTs: number | null = null;

  const consider = (entry: SessionEntry) => {
    const ts = entry.timestamp;
    if (!ts) return;
    try {
      const t = new Date(ts).getTime();
      if (isNaN(t)) return;
      if (minTs === null || t < minTs) minTs = t;
      if (maxTs === null || t > maxTs) maxTs = t;
    } catch { /* ignore */ }
  };

  for (const item of items) {
    if (item.kind === "entry") {
      consider(item.entry);
    } else {
      for (const e of item.entries) consider(e);
    }
  }

  if (minTs === null || maxTs === null || maxTs <= minTs) return null;
  return formatDurationMs(maxTs - minTs);
}

/** Aggregate tool breakdown across all items in a collapsed group. */
function toolBreakdown(items: Layer2Item[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const entries = item.kind === "entry" ? [item.entry] : item.entries;
    for (const e of entries) {
      for (const name of getToolNames(asClassifyEntry(e))) {
        const label = name === "Agent" ? "Subagent" : name;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return "";
  return [...counts.entries()].map(([n, c]) => `${c} ${n}`).join(", ");
}

function collapsedSummary(items: Layer2Item[]): string {
  const tools = toolBreakdown(items);
  const noiseItems = items.filter((i) => i.kind === "topical-group" && i.groupType === "noise");
  const noisePart = noiseItems.map((i) => (i as TopicalGroup).summary).join(", ");

  const parts: string[] = [];
  if (tools) parts.push(tools);
  if (noisePart) parts.push(noisePart);
  const standaloneCount = items.filter((i) => i.kind === "entry").length;
  if (standaloneCount > 0) parts.push(`${standaloneCount} other`);
  return parts.join(", ") || `${items.length} entries`;
}

function buildLayer3(layer2: Layer2Item[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let nonPrimaryBuf: Layer2Item[] = [];

  const countEntries = (items: Layer2Item[]): number => {
    let n = 0;
    for (const item of items) {
      n += item.kind === "entry" ? 1 : item.entries.length;
    }
    return n;
  };

  const flushBuf = () => {
    if (nonPrimaryBuf.length > 0) {
      result.push({
        kind: "collapsed-group",
        items: nonPrimaryBuf,
        entryCount: countEntries(nonPrimaryBuf),
        summary: collapsedSummary(nonPrimaryBuf),
        duration: groupDuration(nonPrimaryBuf),
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

export function buildDisplayItems(entries: SessionEntry[], overrides?: DisplayOverrides): DisplayItem[] {
  const layer2 = buildLayer2(entries, overrides);
  return buildLayer3(layer2);
}
