"use client";

import { useState, useEffect, useCallback } from "react";
import { EntryCard } from "@/components/entry-card";

interface SessionEntry {
  lineIndex: number;
  type: string;
  timestamp: string | null;
  raw: Record<string, unknown>;
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
        {entries.map((entry) => (
          <EntryCard key={entry.lineIndex} entry={entry} />
        ))}
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
