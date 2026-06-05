/**
 * Central registry of all message types the UI distinguishes.
 *
 * This is the SINGLE SOURCE OF TRUTH for:
 * - Display names and descriptions
 * - Badge colors
 * - Rendered-view availability
 * - Default primary/expanded states
 * - Filter bar inclusion
 * - DB search tags
 *
 * Adding a new EntryTag without a registry entry is a compiler error.
 */

import type { EntryTag } from "./classify";

export interface EntryTypeSpec {
  id: EntryTag;
  /** Human-readable label for filter bar & registry page */
  displayName: string;
  /** One-line description for the registry page */
  description: string;
  /** Tailwind classes for the badge in the card header */
  color: string;
  /** Whether a rendered (non-JSON) body view exists */
  hasRenderedView: boolean;
  /** Whether this tag counts as primary interest (shown between collapsed groups) */
  defaultPrimary: boolean;
  /** Whether cards of this tag are expanded by default */
  defaultExpanded: boolean;
  /** Whether this tag appears in the filter bar UI */
  filterable: boolean;
  /** Tag stored in entry_tags for DB queries (e.g. "visual:user-prompt") */
  searchTag: string;
}

export const REGISTRY: Record<EntryTag, EntryTypeSpec> = {
  "user-prompt": {
    id: "user-prompt",
    displayName: "Prompts",
    description: "User text messages and instructions to the assistant",
    color: "bg-blue-900/50 text-blue-300",
    hasRenderedView: true,
    defaultPrimary: true,
    defaultExpanded: true,
    filterable: true,
    searchTag: "visual:user-prompt",
  },
  "assistant-text": {
    id: "assistant-text",
    displayName: "Responses",
    description: "Assistant text replies with no tool calls",
    color: "bg-green-900/50 text-green-300",
    hasRenderedView: true,
    defaultPrimary: true,
    defaultExpanded: true,
    filterable: true,
    searchTag: "visual:assistant-text",
  },
  "plan": {
    id: "plan",
    displayName: "Plans",
    description: "Assistant tool calls targeting .claude/plans/ files",
    color: "bg-purple-900/50 text-purple-300",
    hasRenderedView: true,
    defaultPrimary: true,
    defaultExpanded: true,
    filterable: true,
    searchTag: "visual:plan",
  },
  "agent-question": {
    id: "agent-question",
    displayName: "Questions",
    description: "Assistant using AskUserQuestion tool to ask the user",
    color: "bg-green-900/50 text-green-300",
    hasRenderedView: true,
    defaultPrimary: true,
    defaultExpanded: true,
    filterable: true,
    searchTag: "visual:agent-question",
  },
  "exit-plan-mode": {
    id: "exit-plan-mode",
    displayName: "Plan exit",
    description: "Assistant using ExitPlanMode tool",
    color: "bg-green-900/50 text-green-300",
    hasRenderedView: true,
    defaultPrimary: true,
    defaultExpanded: true,
    filterable: true,
    searchTag: "visual:exit-plan-mode",
  },
  "tool-call": {
    id: "tool-call",
    displayName: "Tool calls",
    description: "Assistant tool invocations (Bash, Read, Write, Grep, etc.)",
    color: "bg-amber-900/50 text-amber-300",
    hasRenderedView: true,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: true,
    searchTag: "visual:tool-call",
  },
  "tool-result": {
    id: "tool-result",
    displayName: "Tool results",
    description: "User entries carrying only tool_result blocks",
    color: "bg-amber-900/50 text-amber-300",
    hasRenderedView: true,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: false,
    searchTag: "visual:tool-result",
  },
  "subagent": {
    id: "subagent",
    displayName: "Subagents",
    description: "Assistant launching Agent subagent tool calls",
    color: "bg-cyan-900/50 text-cyan-300",
    hasRenderedView: true,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: true,
    searchTag: "visual:subagent",
  },
  "noise": {
    id: "noise",
    displayName: "Noise",
    description: "Progress, queue-operation, and file-history-snapshot entries",
    color: "bg-neutral-800/50 text-neutral-400",
    hasRenderedView: true,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: true,
    searchTag: "visual:noise",
  },
  "filler": {
    id: "filler",
    displayName: "Filler",
    description: "Thinking-only assistant entries and system hook messages",
    color: "bg-neutral-800 text-neutral-300",
    hasRenderedView: true,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: false,
    searchTag: "visual:filler",
  },
  "misc": {
    id: "misc",
    displayName: "Misc",
    description: "Known but uncategorized entries (last-prompt, ai-title, etc.)",
    color: "bg-neutral-800/50 text-neutral-400",
    hasRenderedView: false,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: true,
    searchTag: "visual:misc",
  },
  "unclassified": {
    id: "unclassified",
    displayName: "Unclassified",
    description: "Entries with unknown type — browse these to find new types to support",
    color: "bg-red-900/50 text-red-300",
    hasRenderedView: false,
    defaultPrimary: false,
    defaultExpanded: false,
    filterable: true,
    searchTag: "visual:unclassified",
  },
} satisfies Record<EntryTag, EntryTypeSpec>;

// ── Derived sets (replace scattered parallel lists) ────────────────

export const FILTERABLE_TAGS: EntryTag[] = (Object.values(REGISTRY) as EntryTypeSpec[])
  .filter((s) => s.filterable)
  .map((s) => s.id);

export const TAG_LABELS: Record<string, string> = Object.fromEntries(
  (Object.values(REGISTRY) as EntryTypeSpec[]).map((s) => [s.id, s.displayName]),
);

export const DEFAULT_PRIMARY_TAGS = new Set<EntryTag>(
  (Object.values(REGISTRY) as EntryTypeSpec[]).filter((s) => s.defaultPrimary).map((s) => s.id),
);

export const DEFAULT_EXPANDED_TAGS = new Set<EntryTag>(
  (Object.values(REGISTRY) as EntryTypeSpec[]).filter((s) => s.defaultExpanded).map((s) => s.id),
);

/** Look up badge color for an EntryTag. Falls back to neutral for unknown tags. */
export function tagColor(tag: EntryTag): string {
  return REGISTRY[tag]?.color ?? "bg-neutral-800/50 text-neutral-400";
}
