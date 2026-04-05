"use client";

import { FILTERABLE_TAGS, TAG_LABELS, type FilterState, type TagOverride } from "@/lib/filter-state";
import { DEFAULT_PRIMARY_TAGS, DEFAULT_EXPANDED_TAGS, type EntryTag } from "@/lib/grouping";

/**
 * Badge styles matching the entry card sub-badges exactly.
 * active = same bg+text as the badge on cards; dim = muted version.
 */
/** Active = filled badge; dim = grey bg with colored border + text. */
const TAG_BADGE: Record<string, { active: string; dim: string }> = {
  "user-prompt":     { active: "bg-blue-900 text-blue-300",       dim: "bg-neutral-900 border border-blue-800/50 text-neutral-600" },
  "assistant-text":  { active: "bg-green-900 text-green-300",     dim: "bg-neutral-900 border border-green-800/50 text-neutral-600" },
  "plan":            { active: "bg-purple-900 text-purple-300",   dim: "bg-neutral-900 border border-purple-800/50 text-neutral-600" },
  "agent-question":  { active: "bg-blue-900 text-blue-300",      dim: "bg-neutral-900 border border-blue-800/50 text-neutral-600" },
  "exit-plan-mode":  { active: "bg-purple-900 text-purple-300",  dim: "bg-neutral-900 border border-purple-800/50 text-neutral-600" },
  "tool-call":       { active: "bg-[#3d2f0f] text-yellow-300",   dim: "bg-neutral-900 border border-amber-800/50 text-neutral-600" },
  "subagent":        { active: "bg-[#3d2f0f] text-yellow-300",   dim: "bg-neutral-900 border border-amber-800/50 text-neutral-600" },
  "noise":           { active: "bg-neutral-800 text-neutral-400", dim: "bg-neutral-900 border border-neutral-700/50 text-neutral-600" },
  "misc":            { active: "bg-neutral-800 text-neutral-400", dim: "bg-neutral-900 border border-neutral-700/50 text-neutral-600" },
};

export function FilterBar({
  filterState,
  onChange,
  onExpandAll,
  onReapply,
}: {
  filterState: FilterState;
  onChange: (next: FilterState) => void;
  onExpandAll: () => void;
  onReapply: () => void;
}) {
  const hasOverrides = Object.keys(filterState).length > 0;

  const togglePrimary = (tag: EntryTag) => {
    const ovr = filterState[tag] ?? {};
    const currentPrimary = ovr.primary ?? DEFAULT_PRIMARY_TAGS.has(tag);
    const next = { ...filterState };
    const newOvr: TagOverride = { ...ovr, primary: !currentPrimary };
    // If toggling back to default, clean up the override
    if (newOvr.primary === DEFAULT_PRIMARY_TAGS.has(tag)) delete newOvr.primary;
    if (newOvr.expanded === undefined && newOvr.primary === undefined) {
      delete next[tag];
    } else {
      next[tag] = newOvr;
    }
    onChange(next);
  };

  const toggleExpanded = (tag: EntryTag) => {
    const ovr = filterState[tag] ?? {};
    const currentExpanded = ovr.expanded ?? DEFAULT_EXPANDED_TAGS.has(tag);
    const next = { ...filterState };
    const newOvr: TagOverride = { ...ovr, expanded: !currentExpanded };
    if (newOvr.expanded === DEFAULT_EXPANDED_TAGS.has(tag)) delete newOvr.expanded;
    if (newOvr.expanded === undefined && newOvr.primary === undefined) {
      delete next[tag];
    } else {
      next[tag] = newOvr;
    }
    onChange(next);
  };

  const reset = () => onChange({});

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTERABLE_TAGS.map((tag) => {
        const ovr = filterState[tag] ?? {};
        const isPrimary = ovr.primary ?? DEFAULT_PRIMARY_TAGS.has(tag);
        const isExpanded = ovr.expanded ?? DEFAULT_EXPANDED_TAGS.has(tag);
        const isOverridden = filterState[tag] !== undefined;

        const badge = TAG_BADGE[tag] ?? { active: "bg-neutral-800/50 text-neutral-400", dim: "bg-neutral-900/30 text-neutral-600" };
        const badgeClass = isPrimary ? badge.active : badge.dim;

        return (
          <span key={tag} className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeClass}`}>
            <button
              onClick={() => togglePrimary(tag)}
              className="cursor-pointer transition-opacity hover:opacity-70 mr-1"
              title={`${TAG_LABELS[tag]}: ${isPrimary ? "shown at top level" : "inside collapsed groups"} — click to toggle`}
            >
              {isPrimary ? "●" : "○"}
            </button>
            {TAG_LABELS[tag]}
            <button
              onClick={() => toggleExpanded(tag)}
              className="cursor-pointer transition-opacity hover:opacity-70 ml-1"
              title={`Cards ${isExpanded ? "expanded" : "collapsed"} by default — click to toggle`}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          </span>
        );
      })}
      <span className="text-neutral-700 mx-0.5">|</span>
      <button
        onClick={onExpandAll}
        className="text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors px-1.5 py-0.5"
        title="Expand all blocks and groups"
      >
        Expand all
      </button>
      <button
        onClick={onReapply}
        className="text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors px-1.5 py-0.5"
        title="Re-collapse to filter settings"
      >
        Re-apply
      </button>
      {hasOverrides && (
        <button
          onClick={reset}
          className="text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors px-1.5 py-0.5"
          title="Reset to default filter"
        >
          &#8634; Reset
        </button>
      )}
    </div>
  );
}
