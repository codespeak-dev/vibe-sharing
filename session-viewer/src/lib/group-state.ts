import type { EntryTag } from "./classify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupByConfig {
  mode: "off" | "tag-prefix" | "json-path";
  /** For tag-prefix mode: e.g. "tool:" groups by tool:Bash, tool:Read, etc. */
  tagPrefix?: string;
  /**
   * For json-path mode: SQLite json_extract path, e.g. "$.cwd" or "$.message.model".
   * Docs: https://www.sqlite.org/json1.html#path_arguments
   */
  jsonPath?: string;
}

export interface GroupPreset {
  label: string;
  config: GroupByConfig;
}

// ---------------------------------------------------------------------------
// Presets per entry type
// ---------------------------------------------------------------------------

const COMMON_PRESETS: GroupPreset[] = [
  { label: "Entry type", config: { mode: "json-path", jsonPath: "$.type" } },
  {
    label: "Working directory",
    config: { mode: "json-path", jsonPath: "$.cwd" },
  },
];

const TYPE_PRESETS: Partial<Record<EntryTag, GroupPreset[]>> = {
  "tool-call": [
    {
      label: "Tool name",
      config: { mode: "tag-prefix", tagPrefix: "tool:" },
    },
    {
      label: "Model",
      config: { mode: "json-path", jsonPath: "$.message.model" },
    },
  ],
  "tool-result": [
    {
      label: "Model",
      config: { mode: "json-path", jsonPath: "$.message.model" },
    },
  ],
  "assistant-text": [
    {
      label: "Model",
      config: { mode: "json-path", jsonPath: "$.message.model" },
    },
  ],
  "user-prompt": [
    {
      label: "Working directory",
      config: { mode: "json-path", jsonPath: "$.cwd" },
    },
  ],
  subagent: [
    {
      label: "Tool name",
      config: { mode: "tag-prefix", tagPrefix: "tool:" },
    },
  ],
};

/** Get available presets for a given entry type. Type-specific presets come first. */
export function getPresetsForType(typeId: EntryTag): GroupPreset[] {
  const specific = TYPE_PRESETS[typeId] ?? [];
  // Deduplicate: skip common presets whose label already appears in specific
  const specificLabels = new Set(specific.map((p) => p.label));
  const extra = COMMON_PRESETS.filter((p) => !specificLabels.has(p.label));
  return [...specific, ...extra];
}

// ---------------------------------------------------------------------------
// Persistence (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "session-viewer-group-v1";

type PersistedState = Record<string, GroupByConfig>;

function loadAll(): PersistedState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : {};
  } catch {
    return {};
  }
}

function saveAll(state: PersistedState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadGroupConfig(typeId: string): GroupByConfig {
  const all = loadAll();
  return all[typeId] ?? { mode: "off" };
}

export function saveGroupConfig(typeId: string, config: GroupByConfig): void {
  const all = loadAll();
  if (config.mode === "off") {
    delete all[typeId];
  } else {
    all[typeId] = config;
  }
  saveAll(all);
}
