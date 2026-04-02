"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { EntryCard } from "@/components/entry-card";
import { getDisplayType } from "@/components/message-renderer";

interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
}

type Segment =
  | { kind: "user"; entry: SessionEntry }
  | { kind: "group"; entries: SessionEntry[] };

function groupEntries(entries: SessionEntry[]): Segment[] {
  const segments: Segment[] = [];
  let nonUserBuf: SessionEntry[] = [];

  const flushBuf = () => {
    if (nonUserBuf.length > 0) {
      segments.push({ kind: "group", entries: nonUserBuf });
      nonUserBuf = [];
    }
  };

  for (const entry of entries) {
    if (getDisplayType(entry.raw) === "user") {
      flushBuf();
      segments.push({ kind: "user", entry });
    } else {
      nonUserBuf.push(entry);
    }
  }
  flushBuf();
  return segments;
}

function CollapsedGroup({ entries }: { entries: SessionEntry[] }) {
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
          <EntryCard key={entry.lineIndex} entry={entry} />
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

const PAGE_SIZE = 100;

export function SessionClient({
  sessionId,
  encodedProjectPath,
}: {
  sessionId: string;
  encodedProjectPath: string;
}) {
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadMore = async () => {
    setLoadingMore(true);
    await fetchPage(entries.length, true);
    setLoadingMore(false);
  };

  const segments = useMemo(() => groupEntries(entries), [entries]);

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
          seg.kind === "user" ? (
            <EntryCard key={seg.entry.lineIndex} entry={seg.entry} />
          ) : (
            <CollapsedGroup key={`group-${i}`} entries={seg.entries} />
          ),
        )}
      </div>
      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 text-sm border border-neutral-700 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loadingMore ? "Loading..." : `Load more (${total - entries.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}
