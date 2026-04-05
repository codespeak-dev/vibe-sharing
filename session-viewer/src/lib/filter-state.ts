/**
 * Filter state: user overrides for the three-layer display pipeline.
 *
 * Controls:
 * - Layer 1: which entry types default to expanded/collapsed
 * - Layer 3: which entry types count as "primary interest"
 *
 * Layer 2 (topical grouping) is structural and not user-overridable.
 */

import type { EntryTag } from "./grouping";

export interface TagOverride {
  /** Override: is this tag primary interest? */
  primary?: boolean;
  /** Override: are cards of this tag expanded by default? */
  expanded?: boolean;
}

export type FilterState = Partial<Record<EntryTag, TagOverride>>;

/** Tags the user can toggle in the filter bar. Internal tags like filler/tool-result are excluded. */
export const FILTERABLE_TAGS: EntryTag[] = [
  "user-prompt",
  "assistant-text",
  "plan",
  "agent-question",
  "exit-plan-mode",
  "tool-call",
  "subagent",
  "noise",
  "misc",
];

export const TAG_LABELS: Record<string, string> = {
  "user-prompt": "Prompts",
  "assistant-text": "Responses",
  "plan": "Plans",
  "agent-question": "Questions",
  "exit-plan-mode": "Plan exit",
  "tool-call": "Tool calls",
  "subagent": "Subagents",
  "noise": "Noise",
  "misc": "Misc",
};

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
