"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { EntryCard } from "@/components/entry-card";
import { formatDateTime } from "@/lib/format";
import type { EntryTag } from "@/lib/classify";
import type { RegistryInstance } from "@/lib/cache-db";

interface ApiResponse {
  instances: RegistryInstance[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

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

export function RegistryInstancesClient({
  typeId,
  initialInstances,
  initialTotal,
}: {
  typeId: EntryTag;
  initialInstances: RegistryInstance[];
  initialTotal: number;
}) {
  const [instances, setInstances] = useState(initialInstances);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialInstances.length < initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset when server data changes (navigating between types)
  useEffect(() => {
    setInstances(initialInstances);
    setTotal(initialTotal);
    setHasMore(initialInstances.length < initialTotal);
  }, [initialInstances, initialTotal]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const url = `/api/registry-instances?typeId=${encodeURIComponent(typeId)}&offset=${instances.length}&limit=${PAGE_SIZE}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiResponse = await res.json();
      setInstances((prev) => [...prev, ...data.instances]);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [instances.length, typeId]);

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
                  <Link href={link} className="hover:text-neutral-300 transition-colors">
                    {inst.aiTitle || inst.sessionId.slice(0, 12) + "..."}
                  </Link>
                ) : (
                  <span>{inst.aiTitle || inst.sessionId.slice(0, 12) + "..."}</span>
                )}
                <span className="text-neutral-700">#{inst.lineIndex}</span>
                {inst.timestamp && (
                  <span className="text-neutral-600">{formatDateTime(inst.timestamp)}</span>
                )}
                {link && (
                  <Link href={link} className="text-blue-500 hover:text-blue-300 transition-colors">
                    open in session &rarr;
                  </Link>
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
