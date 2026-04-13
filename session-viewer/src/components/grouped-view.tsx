"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { EntryCard } from "@/components/entry-card";
import { formatDateTime } from "@/lib/format";
import type { GroupByConfig } from "@/lib/group-state";
import type { EntryTag } from "@/lib/classify";
import type { RegistryInstance } from "@/lib/cache-db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupInfo {
  key: string;
  count: number;
}

interface GroupsResponse {
  groups: GroupInfo[];
  ungroupedCount: number;
  total: number;
}

interface InstancesResponse {
  instances: RegistryInstance[];
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sessionLink(instance: RegistryInstance): string | null {
  const cwd = instance.cwd;
  if (!cwd) return null;
  return `/project/${base64url(cwd)}/session/${instance.sessionId}#entry-${instance.lineIndex}`;
}

/** Build the query params for fetching instances within a group. */
function groupFilterParams(
  typeId: EntryTag,
  config: GroupByConfig,
  groupKey: string | null,
): string {
  const params = new URLSearchParams({ typeId });

  if (config.mode === "tag-prefix" && config.tagPrefix) {
    if (groupKey === null) {
      // Ungrouped — we can't easily query "no matching tag" via the API,
      // so we skip loading for ungrouped in tag-prefix mode.
      return params.toString();
    }
    params.set("groupTag", `${config.tagPrefix}${groupKey}`);
  } else if (config.mode === "json-path" && config.jsonPath) {
    params.set("groupJsonPath", config.jsonPath);
    params.set("groupValue", groupKey === null ? "__null__" : groupKey);
  }

  return params.toString();
}

// ---------------------------------------------------------------------------
// GroupAccordion — one collapsible group with lazy-loaded items
// ---------------------------------------------------------------------------

function GroupAccordion({
  groupKey,
  count,
  typeId,
  config,
  defaultOpen,
}: {
  groupKey: string | null; // null = "Ungrouped"
  count: number;
  typeId: EntryTag;
  config: GroupByConfig;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [instances, setInstances] = useState<RegistryInstance[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const label = groupKey ?? "Ungrouped";

  const loadPage = useCallback(async (offset: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const filter = groupFilterParams(typeId, config, groupKey);
    const url = `/api/registry-instances?${filter}&offset=${offset}&limit=${PAGE_SIZE}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InstancesResponse = await res.json();
      setInstances((prev) => (offset === 0 ? data.instances : [...prev, ...data.instances]));
      setHasMore(data.hasMore);
    } catch {
      // silently skip errors for individual groups
    }
    setLoading(false);
    setLoaded(true);
    loadingRef.current = false;
  }, [typeId, config, groupKey]);

  // Load first page when opened
  useEffect(() => {
    if (open && !loaded) {
      loadPage(0);
    }
  }, [open, loaded, loadPage]);

  // Infinite scroll within the group
  useEffect(() => {
    if (!open) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingRef.current && loaded) {
          loadPage(instances.length);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, hasMore, loaded, instances.length, loadPage]);

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-neutral-900/50 hover:bg-neutral-800/50 cursor-pointer transition-colors text-left"
      >
        <span className="text-neutral-500 text-xs w-4">
          {open ? "▾" : "▸"}
        </span>
        <span className="font-medium text-sm text-neutral-200">{label}</span>
        <span className="text-xs text-neutral-500 tabular-nums">
          ({count.toLocaleString()})
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-4">
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
          <div ref={sentinelRef} className="h-1" />
          {loading && (
            <div className="text-neutral-500 text-xs text-center py-2">Loading...</div>
          )}
          {!loading && loaded && instances.length === 0 && (
            <div className="text-neutral-600 text-xs text-center py-2">No items</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupedView — fetches groups and renders accordions
// ---------------------------------------------------------------------------

export function GroupedView({
  typeId,
  config,
}: {
  typeId: EntryTag;
  config: GroupByConfig;
}) {
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null);
    setError(null);

    const params = new URLSearchParams({ typeId });
    if (config.mode === "tag-prefix" && config.tagPrefix) {
      params.set("mode", "tag-prefix");
      params.set("tagPrefix", config.tagPrefix);
    } else if (config.mode === "json-path" && config.jsonPath) {
      params.set("mode", "json-path");
      params.set("jsonPath", config.jsonPath);
    } else {
      return; // Invalid config
    }

    fetch(`/api/registry-groups?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GroupsResponse = await res.json();
        setGroups(data.groups);
        setUngroupedCount(data.ungroupedCount);
        setTotal(data.total);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [typeId, config]);

  if (error) {
    return <div className="text-red-400 py-6 text-center text-sm">Error loading groups: {error}</div>;
  }

  if (groups === null) {
    return <div className="text-neutral-500 py-6 text-center text-sm">Loading groups...</div>;
  }

  if (groups.length === 0 && ungroupedCount === 0) {
    return <div className="text-neutral-500 py-6 text-center text-sm">No instances found.</div>;
  }

  return (
    <div>
      <p className="text-sm text-neutral-500 mb-4">
        {total.toLocaleString()} {total === 1 ? "instance" : "instances"} across{" "}
        {groups.length} {groups.length === 1 ? "group" : "groups"}
        {ungroupedCount > 0 && ` + ${ungroupedCount.toLocaleString()} ungrouped`}
      </p>
      <div className="space-y-2">
        {groups.map((g) => (
          <GroupAccordion
            key={g.key}
            groupKey={g.key}
            count={g.count}
            typeId={typeId}
            config={config}
            defaultOpen={false}
          />
        ))}
        {ungroupedCount > 0 && (
          <GroupAccordion
            groupKey={null}
            count={ungroupedCount}
            typeId={typeId}
            config={config}
            defaultOpen={false}
          />
        )}
      </div>
    </div>
  );
}
