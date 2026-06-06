/**
 * Filter state: user overrides for the three-layer display pipeline.
 *
 * Controls:
 * - Layer 1: which entry types default to expanded/collapsed
 * - Layer 3: which entry types count as "primary interest"
 *
 * Layer 2 (topical grouping) is structural and not user-overridable.
 */

// For now this is a placeholder — the filter bar will use it to persist
// user preferences. The grouping pipeline can optionally accept overrides.

export interface FilterState {
  // Future: per-tag overrides for isPrimary and defaultExpanded
}

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
