/**
 * Three-layer grouping pipeline for the session viewer.
 *
 * Layer 1: Classify each entry (expanded/collapsed, primary, topical group)
 * Layer 2: Pair each tool_use with its adjacent tool_result; group consecutive progress entries
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

export type TopicalGroupType = "tool-call" | "progress" | "noise";

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

// ── Layer 2: Topical Grouping ──────────────────────────────────────

/**
 * Light noise: entries that can sit between a tool_use and its tool_result
 * without breaking the pair. Progress is explicitly excluded — it breaks
 * pairing (critical for the subagent case where hundreds of progress entries
 * separate an Agent call from its result).
 */
const LIGHT_NOISE_TYPES = new Set([
  "file-history-snapshot",
  "queue-operation",
  "saved_hook_context",
  "progress",
]);

function isLightNoise(entry: SessionEntry): boolean {
  const t = eType(asClassifyEntry(entry));
  if (LIGHT_NOISE_TYPES.has(t)) return true;
  if (t === "system") return true;
  return false;
}

/** Tags that represent a tool_use entry (should be paired with tool_result). */
const TOOL_USE_TAGS = new Set<EntryTag>(["tool-call", "subagent"]);

/**
 * Pre-scan to identify entries that are part of parallel tool call batches.
 * A parallel batch is 2+ consecutive tool-call entries (skipping light noise)
 * followed by their tool-result entries. All such entries stay standalone.
 */
function findParallelIndices(entries: SessionEntry[]): Set<number> {
  const parallel = new Set<number>();
  let i = 0;
  while (i < entries.length) {
    const tag = classifyTag(asClassifyEntry(entries[i]!));
    if (!TOOL_USE_TAGS.has(tag)) { i++; continue; }

    // Collect consecutive tool-call entries (skipping light noise)
    const callIndices: number[] = [i];
    let j = i + 1;
    while (j < entries.length) {
      if (isLightNoise(entries[j]!)) { j++; continue; }
      if (TOOL_USE_TAGS.has(classifyTag(asClassifyEntry(entries[j]!)))) {
        callIndices.push(j);
        j++;
        continue;
      }
      break;
    }

    if (callIndices.length >= 2) {
      // Mark all call indices as parallel
      for (const idx of callIndices) parallel.add(idx);
      // Mark the corresponding tool-result entries that follow
      let resultsNeeded = callIndices.length;
      while (j < entries.length && resultsNeeded > 0) {
        const t2 = classifyTag(asClassifyEntry(entries[j]!));
        if (t2 === "tool-result") {
          parallel.add(j);
          resultsNeeded--;
          j++;
        } else if (isLightNoise(entries[j]!)) {
          j++;
        } else {
          break;
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return parallel;
}

/** Summary for a tool-call pair: tool name(s). */
function toolCallPairSummary(toolUseEntry: SessionEntry): string {
  const names = getToolNames(asClassifyEntry(toolUseEntry));
  if (names.length === 0) return "tool call";
  return names.map((n) => (n === "Agent" ? "Subagent" : n)).join(", ");
}

/** Summary for a progress group. */
function progressSummary(entries: SessionEntry[]): string {
  return `${entries.length} progress`;
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

/** Summary for a noise group (non-progress): counts by entry type. */
function noiseSummary(entries: SessionEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const t = eType(asClassifyEntry(e));
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([t, c]) => `${c} ${t}`).join(" + ");
}

function buildLayer2(entries: SessionEntry[], overrides?: DisplayOverrides): Layer2Item[] {
  const parallelSet = findParallelIndices(entries);
  const items: Layer2Item[] = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i]!;
    const tag = classifyTag(asClassifyEntry(entry));
    const cls = classify(entry, overrides);

    // 1. Primary entries always standalone
    if (cls.isPrimary) {
      items.push(cls);
      i++;
      continue;
    }

    // 2. Parallel entries always standalone
    if (parallelSet.has(i)) {
      items.push(cls);
      i++;
      continue;
    }

    // 3. Progress runs → collect consecutive progress into a group
    if (eType(asClassifyEntry(entry)) === "progress") {
      const buf: SessionEntry[] = [entry];
      let j = i + 1;
      while (j < entries.length && eType(asClassifyEntry(entries[j]!)) === "progress") {
        buf.push(entries[j]!);
        j++;
      }
      if (buf.length === 1) {
        items.push(cls);
      } else {
        items.push({
          kind: "topical-group",
          groupType: "progress",
          entries: buf,
          summary: progressSummary(buf),
        });
      }
      i = j;
      continue;
    }

    // 4. Sequential tool_use → try to pair with adjacent tool_result
    if (TOOL_USE_TAGS.has(tag)) {
      let j = i + 1;
      const noiseBuf: SessionEntry[] = [];
      while (j < entries.length && isLightNoise(entries[j]!)) {
        noiseBuf.push(entries[j]!);
        j++;
      }
      const nextTag = j < entries.length ? classifyTag(asClassifyEntry(entries[j]!)) : null;
      if (nextTag === "tool-result" && !parallelSet.has(j)) {
        // Sequential pair: tool_use + light noise + tool_result
        const groupEntries = [entry, ...noiseBuf, entries[j]!];
        // Use TodoWrite summary if applicable
        let summary = toolCallPairSummary(entry);
        if (summary === "TodoWrite") {
          const todoState = getLastTodoState(groupEntries);
          if (todoState) summary = todoState;
        }
        items.push({
          kind: "topical-group",
          groupType: "tool-call",
          entries: groupEntries,
          summary,
        });
        i = j + 1;
        continue;
      }
      // No adjacent result → standalone
      items.push(cls);
      i++;
      continue;
    }

    // 5. Orphaned tool_result → standalone
    if (tag === "tool-result") {
      items.push(cls);
      i++;
      continue;
    }

    // 6. Non-progress noise → collect consecutive into noise group
    if (tag === "noise") {
      const buf: SessionEntry[] = [entry];
      let j = i + 1;
      while (j < entries.length) {
        const nextTag = classifyTag(asClassifyEntry(entries[j]!));
        if (nextTag !== "noise" || eType(asClassifyEntry(entries[j]!)) === "progress") break;
        buf.push(entries[j]!);
        j++;
      }
      if (buf.length === 1) {
        items.push(cls);
      } else {
        items.push({
          kind: "topical-group",
          groupType: "noise",
          entries: buf,
          summary: noiseSummary(buf),
        });
      }
      i = j;
      continue;
    }

    // 7. Everything else (filler, subagent, misc, unclassified) → standalone
    items.push(cls);
    i++;
  }

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

/** Compute the time span across entries in a TopicalGroup. */
export function topicalGroupDuration(entries: SessionEntry[]): string | null {
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const entry of entries) {
    const ts = entry.timestamp;
    if (!ts) continue;
    try {
      const t = new Date(ts).getTime();
      if (isNaN(t)) continue;
      if (minTs === null || t < minTs) minTs = t;
      if (maxTs === null || t > maxTs) maxTs = t;
    } catch { /* ignore */ }
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
  const progressItems = items.filter((i) => i.kind === "topical-group" && i.groupType === "progress");
  const noisePart = noiseItems.map((i) => (i as TopicalGroup).summary).join(", ");
  const progressPart = progressItems.map((i) => (i as TopicalGroup).summary).join(", ");

  const parts: string[] = [];
  if (tools) parts.push(tools);
  if (progressPart) parts.push(progressPart);
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
