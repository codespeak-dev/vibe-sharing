"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { EntryCard } from "@/components/entry-card";
import { formatDateTime } from "@/lib/format";
import type { EntryTag } from "@/lib/classify";

interface RegistryInstance {
  filePath: string;
  sessionId: string;
  aiTitle: string | null;
  lineIndex: number;
  type: string;
  timestamp: string | null;
  cwd: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  instances: RegistryInstance[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 30;

/** Encode a string as base64url (browser-compatible). */
function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a link to the session page with the entry highlighted. */
function sessionLink(instance: RegistryInstance): string | null {
  const cwd = instance.cwd;
  if (!cwd) return null;
  const encoded = base64url(cwd);
  return `/project/${encoded}/session/${instance.sessionId}#entry-${instance.lineIndex}`;
}

export function RegistryInstancesClient({ typeId }: { typeId: EntryTag }) {
  const [instances, setInstances] = useState<RegistryInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const url = `/api/registry-instances?typeId=${encodeURIComponent(typeId)}&offset=${offset}&limit=${PAGE_SIZE}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data: ApiResponse = await res.json();
        setInstances((prev) => (append ? [...prev, ...data.instances] : data.instances));
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [typeId],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPage(0, false).finally(() => setLoading(false));
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    await fetchPage(instances.length, true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [instances.length, fetchPage]);

  // Infinite scroll
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

  if (loading) {
    return <div className="text-neutral-500 py-10 text-center">Loading instances...</div>;
  }

  if (error) {
    return <div className="text-red-400 py-10 text-center">Error: {error}</div>;
  }

  if (instances.length === 0) {
    return (
      <div className="text-neutral-500 py-10 text-center">
        No instances found. Try rebuilding the index from the registry page.
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-neutral-500 mb-4">
        {total.toLocaleString()} {total === 1 ? "instance" : "instances"} across all sessions
      </p>
      <div className="space-y-4">
        {instances.map((inst, i) => {
          const link = sessionLink(inst);
          const entry = {
            lineIndex: inst.lineIndex,
            type: inst.type,
            timestamp: inst.timestamp,
            raw: inst.raw,
          };
          return (
            <div key={`${inst.filePath}-${inst.lineIndex}-${i}`}>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-neutral-500">
                {link ? (
                  <a href={link} className="hover:text-neutral-300 transition-colors">
                    {inst.aiTitle || inst.sessionId.slice(0, 12) + "..."}
                  </a>
                ) : (
                  <span>{inst.aiTitle || inst.sessionId.slice(0, 12) + "..."}</span>
                )}
                <span className="text-neutral-700">#{inst.lineIndex}</span>
                {inst.timestamp && (
                  <span className="text-neutral-600">{formatDateTime(inst.timestamp)}</span>
                )}
                {link && (
                  <a href={link} className="text-blue-500 hover:text-blue-300 transition-colors">
                    open in session &rarr;
                  </a>
                )}
              </div>
              <EntryCard entry={entry} projectPath={inst.cwd ?? undefined} />
            </div>
          );
        })}
      </div>
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="text-neutral-500 text-sm text-center py-4">Loading more...</div>
      )}
    </div>
  );
}
