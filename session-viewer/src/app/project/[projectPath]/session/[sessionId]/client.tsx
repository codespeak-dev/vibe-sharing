"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { EntryCard, type SubagentLinks } from "@/components/entry-card";
import { FilterBar } from "@/components/filter-bar";
import { type ToolUseInfo, type TodoItem, type TodoWriteDiff, computeTodoWriteDiff } from "@/components/message-renderer";
import {
  buildDisplayItems,
  topicalGroupDuration,
  type SessionEntry,
  type DisplayItem,
  type ClassifiedEntry,
  type CollapsedGroup,
  type TopicalGroup,
  type Layer2Item,
  type DisplayOverrides,
} from "@/lib/grouping";
import { type FilterState, initFilter, saveFilter } from "@/lib/filter-state";

// ── Rendering components ───────────────────────────────────────────

/** Check if a Layer2Item contains a given entry lineIndex. */
function layer2Contains(item: Layer2Item, lineIndex: number): boolean {
  if (item.kind === "entry") return item.entry.lineIndex === lineIndex;
  return item.entries.some((e) => e.lineIndex === lineIndex);
}

/** Check if a CollapsedGroup contains a given entry lineIndex. */
function collapsedGroupContains(group: CollapsedGroup, lineIndex: number): boolean {
  return group.items.some((item) => layer2Contains(item, lineIndex));
}

function DisplayItemView({
  item,
  projectPath,
  toolMap,
  toolResultMap,
  toolTimestamps,
  reapplyKey,
  expandAll,
  defaultModel,
  subagentLinks,
  highlightEntry,
  todoWriteDiffs,
}: {
  item: DisplayItem;
  projectPath: string;
  toolMap: Map<string, ToolUseInfo>;
  toolResultMap: Map<string, string>;
  toolTimestamps: Map<string, { useTs: string | null; resultTs: string | null }>;
  reapplyKey: number;
  expandAll: boolean;
  defaultModel?: string;
  subagentLinks?: SubagentLinks;
  highlightEntry?: number | null;
  todoWriteDiffs?: Map<string, TodoWriteDiff>;
}) {
  if (item.kind === "entry") {
    return (
      <EntryCard
        entry={item.entry}
        forceExpanded={expandAll || item.defaultExpanded || item.entry.lineIndex === highlightEntry}
        projectPath={projectPath}
        toolMap={toolMap}
        toolResultMap={toolResultMap}
        toolTimestamps={toolTimestamps}
        defaultModel={defaultModel}
        subagentLinks={subagentLinks}
        todoWriteDiffs={todoWriteDiffs}
      />
    );
  }
  return (
    <CollapsedGroupView
      group={item}
      projectPath={projectPath}
      toolMap={toolMap}
      toolResultMap={toolResultMap}
      toolTimestamps={toolTimestamps}
      reapplyKey={reapplyKey}
      expandAll={expandAll}
      defaultModel={defaultModel}
      subagentLinks={subagentLinks}
      highlightEntry={highlightEntry}
      todoWriteDiffs={todoWriteDiffs}
    />
  );
}

function CollapsedGroupView({
  group,
  projectPath,
  toolMap,
  toolResultMap,
  toolTimestamps,
  reapplyKey,
  expandAll,
  defaultModel,
  subagentLinks,
  highlightEntry,
  todoWriteDiffs,
}: {
  group: CollapsedGroup;
  projectPath: string;
  toolMap: Map<string, ToolUseInfo>;
  toolResultMap: Map<string, string>;
  toolTimestamps: Map<string, { useTs: string | null; resultTs: string | null }>;
  reapplyKey: number;
  expandAll: boolean;
  defaultModel?: string;
  subagentLinks?: SubagentLinks;
  highlightEntry?: number | null;
  todoWriteDiffs?: Map<string, TodoWriteDiff>;
}) {
  const containsHighlight = highlightEntry != null && collapsedGroupContains(group, highlightEntry);
  const [expanded, setExpanded] = useState(expandAll || containsHighlight);
  const reapplyRef = useRef(reapplyKey);

  // React to expandAll / reapply / highlight
  useEffect(() => { if (expandAll || containsHighlight) setExpanded(true); }, [expandAll, containsHighlight]);
  useEffect(() => {
    if (reapplyRef.current !== reapplyKey) {
      reapplyRef.current = reapplyKey;
      setExpanded(containsHighlight);
    }
  }, [reapplyKey, containsHighlight]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 text-[11px] text-neutral-600 hover:text-neutral-400 py-1.5 px-3 cursor-pointer transition-colors border border-neutral-800/50 rounded-lg hover:border-neutral-700"
      >
        <span className="text-[10px] text-neutral-600 font-mono shrink-0">▸ {group.entryCount} cards</span>
        <span className="flex-1">{group.summary}</span>
        {group.duration && (
          <span className="text-[10px] text-neutral-600 shrink-0">{group.duration}</span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2 bg-blue-950/20 border border-blue-900/30 rounded-lg p-2">
      <button
        onClick={() => setExpanded(false)}
        className="w-full flex items-center gap-2 text-[11px] text-neutral-500 hover:text-neutral-300 py-1 px-1 cursor-pointer transition-colors"
      >
        <span className="text-[10px] text-neutral-500 font-mono shrink-0">▾ {group.entryCount} cards</span>
        <span className="flex-1">{group.summary}</span>
        {group.duration && (
          <span className="text-[10px] text-neutral-600 shrink-0">{group.duration}</span>
        )}
      </button>
      {group.items.map((item, i) => (
        <Layer2ItemView
          key={layer2Key(item, i)}
          item={item}
          projectPath={projectPath}
          toolMap={toolMap}
          toolResultMap={toolResultMap}
          toolTimestamps={toolTimestamps}
          reapplyKey={reapplyKey}
          expandAll={expandAll}
          autoExpand={group.items.length === 1 && item.kind === "topical-group"}
          defaultModel={defaultModel}
          subagentLinks={subagentLinks}
          highlightEntry={highlightEntry}
          todoWriteDiffs={todoWriteDiffs}
        />
      ))}
    </div>
  );
}

function Layer2ItemView({
  item,
  projectPath,
  toolMap,
  toolResultMap,
  toolTimestamps,
  reapplyKey,
  expandAll,
  autoExpand,
  defaultModel,
  subagentLinks,
  highlightEntry,
  todoWriteDiffs,
}: {
  item: Layer2Item;
  projectPath: string;
  toolMap: Map<string, ToolUseInfo>;
  toolResultMap: Map<string, string>;
  toolTimestamps: Map<string, { useTs: string | null; resultTs: string | null }>;
  reapplyKey: number;
  expandAll: boolean;
  autoExpand?: boolean;
  defaultModel?: string;
  subagentLinks?: SubagentLinks;
  highlightEntry?: number | null;
  todoWriteDiffs?: Map<string, TodoWriteDiff>;
}) {
  if (item.kind === "entry") {
    return (
      <EntryCard
        entry={item.entry}
        forceExpanded={expandAll || item.defaultExpanded || item.entry.lineIndex === highlightEntry}
        projectPath={projectPath}
        toolMap={toolMap}
        toolResultMap={toolResultMap}
        toolTimestamps={toolTimestamps}
        defaultModel={defaultModel}
        subagentLinks={subagentLinks}
        todoWriteDiffs={todoWriteDiffs}
      />
    );
  }
  return (
    <TopicalGroupView
      group={item}
      projectPath={projectPath}
      toolMap={toolMap}
      toolResultMap={toolResultMap}
      toolTimestamps={toolTimestamps}
      reapplyKey={reapplyKey}
      expandAll={expandAll}
      autoExpand={autoExpand}
      defaultModel={defaultModel}
      subagentLinks={subagentLinks}
      highlightEntry={highlightEntry}
      todoWriteDiffs={todoWriteDiffs}
    />
  );
}

/** Common props for all topical group view variants. */
interface TopicalGroupViewProps {
  group: TopicalGroup;
  projectPath: string;
  toolMap: Map<string, ToolUseInfo>;
  toolResultMap: Map<string, string>;
  toolTimestamps: Map<string, { useTs: string | null; resultTs: string | null }>;
  reapplyKey: number;
  expandAll: boolean;
  autoExpand?: boolean;
  defaultModel?: string;
  subagentLinks?: SubagentLinks;
  highlightEntry?: number | null;
  todoWriteDiffs?: Map<string, TodoWriteDiff>;
}

function TopicalGroupView(props: TopicalGroupViewProps) {
  if (props.group.groupType === "tool-call") return <ToolCallGroupView {...props} />;
  if (props.group.groupType === "progress") return <ProgressGroupView {...props} />;
  return <NoiseGroupView {...props} />;
}

/** Tool-call pair: collapsed shows the tool_use entry as a card; expanded reveals all entries. */
function ToolCallGroupView({
  group, projectPath, toolMap, toolResultMap, toolTimestamps,
  reapplyKey, expandAll, autoExpand, defaultModel, subagentLinks, highlightEntry, todoWriteDiffs,
}: TopicalGroupViewProps) {
  const containsHighlight = highlightEntry != null && group.entries.some((e) => e.lineIndex === highlightEntry);
  const [expanded, setExpanded] = useState(expandAll || !!autoExpand || containsHighlight);
  const reapplyRef = useRef(reapplyKey);

  useEffect(() => { if (expandAll || containsHighlight) setExpanded(true); }, [expandAll, containsHighlight]);
  useEffect(() => {
    if (reapplyRef.current !== reapplyKey) {
      reapplyRef.current = reapplyKey;
      setExpanded(!!autoExpand || containsHighlight);
    }
  }, [reapplyKey, autoExpand, containsHighlight]);

  const primaryEntry = group.entries[0]!;
  const extraCount = group.entries.length - 1;

  // Sub-group consecutive progress entries within the expanded view
  const chunks = useMemo(() => {
    const result: Array<{ kind: "entry"; entry: SessionEntry; isLast: boolean } | { kind: "progress-run"; entries: SessionEntry[] }> = [];
    let i = 0;
    const entries = group.entries;
    while (i < entries.length) {
      const e = entries[i]!;
      if ((e.raw.type ?? e.type) === "progress") {
        const buf: SessionEntry[] = [e];
        let j = i + 1;
        while (j < entries.length && ((entries[j]!.raw.type ?? entries[j]!.type) === "progress")) {
          buf.push(entries[j]!);
          j++;
        }
        if (buf.length >= 2) {
          result.push({ kind: "progress-run", entries: buf });
        } else {
          result.push({ kind: "entry", entry: e, isLast: i === entries.length - 1 });
        }
        i = j;
      } else {
        result.push({ kind: "entry", entry: e, isLast: i === entries.length - 1 });
        i++;
      }
    }
    return result;
  }, [group.entries]);

  if (!expanded) {
    return (
      <div
        className="relative cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <EntryCard
          entry={primaryEntry}
          forceExpanded={false}
          projectPath={projectPath}
          toolMap={toolMap}
          toolResultMap={toolResultMap}
          toolTimestamps={toolTimestamps}
          defaultModel={defaultModel}
          subagentLinks={subagentLinks}
          todoWriteDiffs={todoWriteDiffs}
          disableToggle
        />
        {extraCount > 0 && (
          <span className="absolute top-2 right-2 text-[9px] bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded-full pointer-events-none">
            +{extraCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-neutral-800/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(false)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors"
      >
        ▾ {group.summary}
      </button>
      <div className="space-y-2 p-2 border-t border-indigo-900/30 bg-indigo-950/15">
        {chunks.map((chunk, ci) =>
          chunk.kind === "entry" ? (
            <EntryCard
              key={chunk.entry.lineIndex}
              entry={chunk.entry}
              forceExpanded={chunk.entry.lineIndex === highlightEntry || chunk.isLast}
              projectPath={projectPath}
              toolMap={toolMap}
              toolResultMap={toolResultMap}
              toolTimestamps={toolTimestamps}
              defaultModel={defaultModel}
              subagentLinks={subagentLinks}
              todoWriteDiffs={todoWriteDiffs}
            />
          ) : (
            <InlineProgressGroup
              key={`pg-${chunk.entries[0]!.lineIndex}`}
              entries={chunk.entries}
              expandAll={expandAll}
              reapplyKey={reapplyKey}
              highlightEntry={highlightEntry}
              projectPath={projectPath}
              toolMap={toolMap}
              toolResultMap={toolResultMap}
              toolTimestamps={toolTimestamps}
              defaultModel={defaultModel}
              subagentLinks={subagentLinks}
              todoWriteDiffs={todoWriteDiffs}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** Collapsible progress run nested inside a tool-call topical group. */
function InlineProgressGroup({
  entries, expandAll, reapplyKey, highlightEntry,
  projectPath, toolMap, toolResultMap, toolTimestamps, defaultModel, subagentLinks, todoWriteDiffs,
}: {
  entries: SessionEntry[];
  expandAll: boolean;
  reapplyKey: number;
  highlightEntry?: number | null;
  projectPath: string;
  toolMap: Map<string, ToolUseInfo>;
  toolResultMap: Map<string, string>;
  toolTimestamps: Map<string, { useTs: string | null; resultTs: string | null }>;
  defaultModel?: string;
  subagentLinks?: SubagentLinks;
  todoWriteDiffs?: Map<string, TodoWriteDiff>;
}) {
  const containsHighlight = highlightEntry != null && entries.some((e) => e.lineIndex === highlightEntry);
  const [expanded, setExpanded] = useState(expandAll || containsHighlight);
  const reapplyRef = useRef(reapplyKey);
  const duration = useMemo(() => topicalGroupDuration(entries), [entries]);

  useEffect(() => { if (expandAll || containsHighlight) setExpanded(true); }, [expandAll, containsHighlight]);
  useEffect(() => {
    if (reapplyRef.current !== reapplyKey) {
      reapplyRef.current = reapplyKey;
      setExpanded(containsHighlight);
    }
  }, [reapplyKey, containsHighlight]);

  const label = `${entries.length} progress${duration ? ` (${duration})` : ""}`;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors border border-neutral-800/30 rounded-lg hover:border-neutral-700"
      >
        ▸ {label}
      </button>
    );
  }

  return (
    <div className="border border-neutral-800/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(false)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors"
      >
        ▾ {label}
      </button>
      <div className="space-y-2 p-2 border-t border-neutral-800/30 bg-neutral-950/30">
        {entries.map((entry) => (
          <EntryCard
            key={entry.lineIndex}
            entry={entry}
            forceExpanded={entry.lineIndex === highlightEntry}
            projectPath={projectPath}
            toolMap={toolMap}
            toolResultMap={toolResultMap}
            toolTimestamps={toolTimestamps}
            defaultModel={defaultModel}
            subagentLinks={subagentLinks}
            todoWriteDiffs={todoWriteDiffs}
          />
        ))}
      </div>
    </div>
  );
}

/** Progress group: collapsed shows count + duration; expanded shows all progress entries. */
function ProgressGroupView({
  group, projectPath, toolMap, toolResultMap, toolTimestamps,
  reapplyKey, expandAll, autoExpand, defaultModel, subagentLinks, highlightEntry, todoWriteDiffs,
}: TopicalGroupViewProps) {
  const containsHighlight = highlightEntry != null && group.entries.some((e) => e.lineIndex === highlightEntry);
  const [expanded, setExpanded] = useState(expandAll || !!autoExpand || containsHighlight);
  const reapplyRef = useRef(reapplyKey);
  const duration = useMemo(() => topicalGroupDuration(group.entries), [group.entries]);

  useEffect(() => { if (expandAll || containsHighlight) setExpanded(true); }, [expandAll, containsHighlight]);
  useEffect(() => {
    if (reapplyRef.current !== reapplyKey) {
      reapplyRef.current = reapplyKey;
      setExpanded(!!autoExpand || containsHighlight);
    }
  }, [reapplyKey, autoExpand, containsHighlight]);

  const label = `${group.entries.length} progress${duration ? ` (${duration})` : ""}`;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors border border-neutral-800/30 rounded-lg hover:border-neutral-700"
      >
        ▸ {label}
      </button>
    );
  }

  return (
    <div className="border border-neutral-800/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(false)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors"
      >
        ▾ {label}
      </button>
      <div className="space-y-2 p-2 border-t border-neutral-800/30 bg-neutral-950/30">
        {group.entries.map((entry) => (
          <EntryCard
            key={entry.lineIndex}
            entry={entry}
            forceExpanded={entry.lineIndex === highlightEntry}
            projectPath={projectPath}
            toolMap={toolMap}
            toolResultMap={toolResultMap}
            toolTimestamps={toolTimestamps}
            defaultModel={defaultModel}
            subagentLinks={subagentLinks}
            todoWriteDiffs={todoWriteDiffs}
          />
        ))}
      </div>
    </div>
  );
}

/** Noise group (non-progress): simple toggle with summary text. */
function NoiseGroupView({
  group, projectPath, toolMap, toolResultMap, toolTimestamps,
  reapplyKey, expandAll, autoExpand, defaultModel, subagentLinks, highlightEntry, todoWriteDiffs,
}: TopicalGroupViewProps) {
  const containsHighlight = highlightEntry != null && group.entries.some((e) => e.lineIndex === highlightEntry);
  const [expanded, setExpanded] = useState(expandAll || !!autoExpand || containsHighlight);
  const reapplyRef = useRef(reapplyKey);

  useEffect(() => { if (expandAll || containsHighlight) setExpanded(true); }, [expandAll, containsHighlight]);
  useEffect(() => {
    if (reapplyRef.current !== reapplyKey) {
      reapplyRef.current = reapplyKey;
      setExpanded(!!autoExpand || containsHighlight);
    }
  }, [reapplyKey, autoExpand, containsHighlight]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors border border-neutral-800/30 rounded-lg hover:border-neutral-700"
      >
        ▸ {group.summary}
      </button>
    );
  }

  return (
    <div className="border border-neutral-800/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(false)}
        className="w-full text-left text-[11px] text-neutral-500 hover:text-neutral-300 py-1.5 px-3 cursor-pointer transition-colors"
      >
        ▾ {group.summary}
      </button>
      <div className="space-y-2 p-2 border-t border-indigo-900/30 bg-indigo-950/15">
        {group.entries.map((entry) => (
          <EntryCard
            key={entry.lineIndex}
            entry={entry}
            forceExpanded={entry.lineIndex === highlightEntry}
            projectPath={projectPath}
            toolMap={toolMap}
            toolResultMap={toolResultMap}
            toolTimestamps={toolTimestamps}
            defaultModel={defaultModel}
            subagentLinks={subagentLinks}
            todoWriteDiffs={todoWriteDiffs}
          />
        ))}
      </div>
    </div>
  );
}

function layer2Key(item: Layer2Item, index: number): string {
  if (item.kind === "entry") return `e-${item.entry.lineIndex}`;
  return `tg-${item.entries[0]?.lineIndex ?? index}`;
}

// ── Main client ────────────────────────────────────────────────────

interface ApiResponse {
  entries: SessionEntry[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 500;

export function SessionClient({
  sessionId,
  encodedProjectPath,
  projectPath,
}: {
  sessionId: string;
  encodedProjectPath: string;
  projectPath: string;
}) {
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = `/api/session-entries?sessionId=${encodeURIComponent(sessionId)}&projectPath=${encodeURIComponent(encodedProjectPath)}&offset=0&limit=10000`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [sessionId, encodedProjectPath]);

  const [expandAll, setExpandAll] = useState(false);
  const [reapplyKey, setReapplyKey] = useState(0);
  const [filterState, setFilterState] = useState<FilterState>(() => initFilter());

  const handleFilterChange = useCallback((next: FilterState) => {
    setFilterState(next);
    saveFilter(next);
    setReapplyKey((k) => k + 1);
  }, []);

  // Convert FilterState to DisplayOverrides for the grouping pipeline
  const displayOverrides = useMemo((): DisplayOverrides | undefined => {
    const entries = Object.entries(filterState);
    if (entries.length === 0) return undefined;
    const primary: Record<string, boolean> = {};
    const expanded: Record<string, boolean> = {};
    for (const [tag, ovr] of entries) {
      if (ovr.primary !== undefined) primary[tag] = ovr.primary;
      if (ovr.expanded !== undefined) expanded[tag] = ovr.expanded;
    }
    return {
      primary: Object.keys(primary).length > 0 ? primary : undefined,
      expanded: Object.keys(expanded).length > 0 ? expanded : undefined,
    };
  }, [filterState]);

  const [highlightEntry, setHighlightEntry] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#entry-(\d+)$/);
    return match ? parseInt(match[1]!, 10) : null;
  });

  // Re-read hash on client-side navigation (sessionId change) and hash changes
  useEffect(() => {
    const readHash = () => {
      const match = window.location.hash.match(/^#entry-(\d+)$/);
      setHighlightEntry(match ? parseInt(match[1]!, 10) : null);
      scrolledRef.current = false;
    };
    // Sync on mount / sessionId change
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [sessionId]);

  // Scroll to highlighted entry on mount / hash change
  useEffect(() => {
    if (highlightEntry == null || scrolledRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`entry-${highlightEntry}`);
        if (el) {
          scrolledRef.current = true;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-1", "ring-purple-500/60");
        }
      });
    });
  }, [highlightEntry, entries]);

  const displayItems = useMemo(() => buildDisplayItems(entries, displayOverrides), [entries, displayOverrides]);

  const toolMap = useMemo(() => {
    const map = new Map<string, ToolUseInfo>();
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          map.set(b.id, { name: b.name, input: b.input as Record<string, unknown> | undefined });
        }
      }
    }
    return map;
  }, [entries]);

  const toolResultMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          let content = "";
          if (typeof b.content === "string") {
            content = b.content;
          } else if (Array.isArray(b.content)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content = (b.content as any[]).map((c) => (typeof c === "string" ? c : c.text ?? "")).join("\n");
          }
          map.set(b.tool_use_id, content);
        }
      }
    }
    return map;
  }, [entries]);

  // Map tool_use_id → { useTimestamp, resultTimestamp } for computing durations
  const toolTimestamps = useMemo(() => {
    const useTs = new Map<string, string>(); // tool_use_id → timestamp of the entry containing tool_use
    const resultTs = new Map<string, string>(); // tool_use_id → timestamp of the entry containing tool_result
    for (const entry of entries) {
      const ts = entry.timestamp;
      if (!ts) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && typeof b.id === "string") {
          useTs.set(b.id, ts);
        }
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          resultTs.set(b.tool_use_id, ts);
        }
      }
    }
    // Combine into a single map
    const combined = new Map<string, { useTs: string | null; resultTs: string | null }>();
    for (const [id, t] of useTs) combined.set(id, { useTs: t, resultTs: resultTs.get(id) ?? null });
    for (const [id, t] of resultTs) {
      if (!combined.has(id)) combined.set(id, { useTs: null, resultTs: t });
    }
    return combined;
  }, [entries]);

  // TodoWrite diffs: for each TodoWrite tool_use, compute what changed vs the previous one
  const todoWriteDiffs = useMemo(() => {
    const diffs = new Map<string, TodoWriteDiff>();
    let prevTodos: TodoItem[] | null = null;
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && b.name === "TodoWrite" && typeof b.id === "string") {
          const todos = ((b.input as Record<string, unknown>)?.todos as TodoItem[]) ?? [];
          diffs.set(b.id, computeTodoWriteDiff(todos, prevTodos));
          prevTodos = todos;
        }
      }
    }
    return diffs;
  }, [entries]);

  // Subagent cross-references: maps entry lineIndex of call → lineIndex of result, and vice versa.
  // Also maps call lineIndex → tool_use_id for linking.
  const subagentLinks = useMemo(() => {
    // First pass: find all Agent tool_use blocks with their entry lineIndex and tool_use_id
    const callsByToolId = new Map<string, number>(); // tool_use_id → call entry lineIndex
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && b.name === "Agent" && typeof b.id === "string") {
          callsByToolId.set(b.id, entry.lineIndex);
        }
      }
    }
    // Second pass: find tool_result blocks that match
    const callToResult = new Map<number, number>(); // call lineIndex → result lineIndex
    const resultToCall = new Map<number, number>(); // result lineIndex → call lineIndex
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: unknown[] = (entry.raw as any)?.message?.content ?? [];
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks as Array<Record<string, unknown>>) {
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          const callLineIndex = callsByToolId.get(b.tool_use_id);
          if (callLineIndex !== undefined) {
            callToResult.set(callLineIndex, entry.lineIndex);
            resultToCall.set(entry.lineIndex, callLineIndex);
          }
        }
      }
    }
    return { callToResult, resultToCall };
  }, [entries]);

  // Model usage stats: sorted desc by count, most common = default
  const { defaultModel, modelStats } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (entry.raw as any)?.message?.model;
      if (typeof model === "string" && model) {
        counts.set(model, (counts.get(model) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const best = sorted[0]?.[0];
    return { defaultModel: best, modelStats: sorted };
  }, [entries]);

  const handleExpandAll = useCallback(() => setExpandAll(true), []);
  const handleReapply = useCallback(() => {
    setExpandAll(false);
    setReapplyKey((k) => k + 1);
  }, []);

  if (loading) {
    return <div className="text-neutral-500 py-10 text-center">Loading session entries...</div>;
  }

  if (error) {
    return <div className="text-red-400 py-10 text-center"><p>Error: {error}</p></div>;
  }

  if (entries.length === 0) {
    return <div className="text-neutral-500 py-10 text-center">No entries found in this session.</div>;
  }

  return (
    <div>
      {modelStats.length > 0 && (
        <div className="text-xs text-neutral-500 mb-2 flex items-center gap-2 flex-wrap">
          <span>Models:</span>
          {modelStats.map(([model, count]) => (
            <span key={model} className="text-neutral-400">
              {model} <span className="text-neutral-600">x{count}</span>
              {model === defaultModel && <span className="text-neutral-600 ml-1">(default)</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-neutral-500">
          Showing {entries.length} of {total} entries
        </p>
        <FilterBar filterState={filterState} onChange={handleFilterChange} onExpandAll={handleExpandAll} onReapply={handleReapply} />
      </div>
      <div className="space-y-3">
        {displayItems.map((item, i) => (
          <DisplayItemView
            key={`${reapplyKey}-${item.kind === "entry" ? `e-${item.entry.lineIndex}` : `cg-${item.items[0]?.kind === "entry" ? item.items[0].entry.lineIndex : (item.items[0] as TopicalGroup)?.entries[0]?.lineIndex ?? i}`}`}
            item={item}
            projectPath={projectPath}
            toolMap={toolMap}
            toolResultMap={toolResultMap}
            toolTimestamps={toolTimestamps}
            reapplyKey={reapplyKey}
            expandAll={expandAll}
            defaultModel={defaultModel}
            subagentLinks={subagentLinks}
            highlightEntry={highlightEntry}
            todoWriteDiffs={todoWriteDiffs}
          />
        ))}
      </div>
    </div>
  );
}
