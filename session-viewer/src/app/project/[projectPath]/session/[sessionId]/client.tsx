"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { EntryCard } from "@/components/entry-card";
import { type ToolUseInfo } from "@/components/message-renderer";
import { getDisplayType } from "@/components/message-renderer";

interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

type Segment =
  | { kind: "standalone"; entry: SessionEntry }
  | { kind: "group"; entries: SessionEntry[] };

function groupEntries(entries: SessionEntry[], highlightEntry: number | null): Segment[] {
  const segments: Segment[] = [];
  let nonUserBuf: SessionEntry[] = [];

  const flushBuf = () => {
    if (nonUserBuf.length > 0) {
      segments.push({ kind: "group", entries: nonUserBuf });
      nonUserBuf = [];
    }
  };

  for (const entry of entries) {
    const isStandalone =
      getDisplayType(entry.raw) === "user" ||
      entry.lineIndex === highlightEntry;
    if (isStandalone) {
      flushBuf();
      segments.push({ kind: "standalone", entry });
    } else {
      nonUserBuf.push(entry);
    }
  }
  flushBuf();
  return segments;
}

function CollapsedGroup({ entries, projectPath, toolMap }: { entries: SessionEntry[]; projectPath: string; toolMap: Map<string, ToolUseInfo> }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setExpanded(false)}
          className="w-full text-center text-[11px] text-neutral-500 hover:text-neutral-300 py-1 cursor-pointer transition-colors"
        >
          ▲ collapse {entries.length} {entries.length === 1 ? "message" : "messages"}
        </button>
        {entries.map((entry) => (
          <EntryCard key={entry.lineIndex} entry={entry} projectPath={projectPath} toolMap={toolMap} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      className="w-full text-center text-[11px] text-neutral-600 hover:text-neutral-400 py-1.5 cursor-pointer transition-colors border border-neutral-800/50 rounded-lg hover:border-neutral-700"
    >
      ··· {entries.length} {entries.length === 1 ? "message" : "messages"} ···
    </button>
  );
}

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
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrolledRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const [highlightEntry, setHighlightEntry] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#entry-(\d+)$/);
    return match ? parseInt(match[1]!, 10) : null;
  });

  // Listen for same-page hash changes (e.g. clicking plan badge on session page)
  useEffect(() => {
    const onHashChange = () => {
      const match = window.location.hash.match(/^#entry-(\d+)$/);
      setHighlightEntry(match ? parseInt(match[1]!, 10) : null);
      scrolledRef.current = false;
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const url = `/api/session-entries?sessionId=${encodeURIComponent(sessionId)}&projectPath=${encodeURIComponent(encodedProjectPath)}&offset=${offset}&limit=${PAGE_SIZE}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data: ApiResponse = await res.json();
        setEntries((prev) => (append ? [...prev, ...data.entries] : data.entries));
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessionId, encodedProjectPath],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPage(0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  // Load more pages if needed to reach the target entry, then scroll to it
  useEffect(() => {
    if (highlightEntry == null || loading || scrolledRef.current) return;
    const entryLoaded = entries.some((e) => e.lineIndex === highlightEntry);
    if (!entryLoaded && hasMore) {
      // Need to load more entries to reach the target
      setLoadingMore(true);
      fetchPage(entries.length, true).finally(() => setLoadingMore(false));
      return;
    }
    if (entryLoaded) {
      scrolledRef.current = true;
      // Wait for DOM to render the expanded group (two frames for React commit + paint)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`entry-${highlightEntry}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-1", "ring-purple-500/60");
          }
        });
      });
    }
  }, [highlightEntry, entries, loading, hasMore, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    await fetchPage(entries.length, true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [entries.length, fetchPage]);

  // Infinite scroll: auto-load when sentinel is near viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (intersections) => {
        if (intersections[0]?.isIntersecting && hasMore && !loadingMoreRef.current) {
          loadMore();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const segments = useMemo(() => groupEntries(entries, highlightEntry), [entries, highlightEntry]);

  // Build a lookup from tool_use_id → tool info so tool-result entries can show tool names
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

  if (loading) {
    return (
      <div className="text-neutral-500 py-10 text-center">
        Loading session entries...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 py-10 text-center">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-neutral-500 py-10 text-center">
        No entries found in this session.
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-neutral-500 mb-4">
        Showing {entries.length} of {total} entries
      </p>
      <div className="space-y-3">
        {segments.map((seg, i) =>
          seg.kind === "standalone" ? (
            <EntryCard key={seg.entry.lineIndex} entry={seg.entry} forceExpanded={seg.entry.lineIndex === highlightEntry} projectPath={projectPath} toolMap={toolMap} />
          ) : (
            <CollapsedGroup key={`group-${i}`} entries={seg.entries} projectPath={projectPath} toolMap={toolMap} />
          ),
        )}
      </div>
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="text-neutral-500 text-sm text-center py-4">
          Loading more entries...
        </div>
      )}
    </div>
  );
}
