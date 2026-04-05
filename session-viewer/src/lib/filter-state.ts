/**
 * Filter state: user overrides for the three-layer display pipeline.
 *
 * Controls:
 * - Layer 1: which entry types default to expanded/collapsed
 * - Layer 3: which entry types count as "primary interest"
 *
 * Layer 2 (topical grouping) is structural and not user-overridable.
 */

import type { EntryTag } from "./classify";
import { FILTERABLE_TAGS as _FILTERABLE_TAGS, TAG_LABELS as _TAG_LABELS } from "./message-type-registry";

export interface TagOverride {
  /** Override: is this tag primary interest? */
  primary?: boolean;
  /** Override: are cards of this tag expanded by default? */
  expanded?: boolean;
}

export type FilterState = Partial<Record<EntryTag, TagOverride>>;

/** Tags the user can toggle in the filter bar. Derived from the registry. */
export const FILTERABLE_TAGS: EntryTag[] = _FILTERABLE_TAGS;

/** Human-readable labels for filter tags. Derived from the registry. */
export const TAG_LABELS: Record<string, string> = _TAG_LABELS;

const STORAGE_KEY = "session-viewer-filter-v2";

export function saveFilter(filter: FilterState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filter)); } catch { /* */ }
}

export function loadFilter(): FilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as FilterState;
  } catch { /* */ }
  return {};
}

export function initFilter(): FilterState {
  if (typeof window === "undefined") return {};
  return loadFilter();
}
