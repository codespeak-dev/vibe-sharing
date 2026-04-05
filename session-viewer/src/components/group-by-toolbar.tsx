"use client";

import { useState } from "react";
import type { GroupByConfig, GroupPreset } from "@/lib/group-state";

export function GroupByToolbar({
  config,
  presets,
  onChange,
}: {
  config: GroupByConfig;
  presets: GroupPreset[];
  onChange: (config: GroupByConfig) => void;
}) {
  const [customPath, setCustomPath] = useState(
    config.mode === "json-path" ? (config.jsonPath ?? "") : "",
  );
  const [showCustom, setShowCustom] = useState(false);

  const isActive = config.mode !== "off";

  // Find which preset matches the current config (if any)
  const activePresetLabel = presets.find(
    (p) =>
      p.config.mode === config.mode &&
      p.config.tagPrefix === config.tagPrefix &&
      p.config.jsonPath === config.jsonPath,
  )?.label;

  const applyCustomPath = () => {
    const path = customPath.trim();
    if (!path) return;
    onChange({ mode: "json-path", jsonPath: path });
    setShowCustom(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-neutral-500 font-medium">Group by:</span>

      {/* Preset buttons */}
      {presets.map((preset) => {
        const isSelected =
          preset.config.mode === config.mode &&
          preset.config.tagPrefix === config.tagPrefix &&
          preset.config.jsonPath === config.jsonPath;

        return (
          <button
            key={preset.label}
            onClick={() => onChange(isSelected ? { mode: "off" } : preset.config)}
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
              isSelected
                ? "bg-blue-900/60 text-blue-300"
                : "bg-neutral-800/50 text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {preset.label}
          </button>
        );
      })}

      {/* Custom JSON path toggle */}
      <button
        onClick={() => setShowCustom(!showCustom)}
        className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
          config.mode === "json-path" && !activePresetLabel
            ? "bg-blue-900/60 text-blue-300"
            : "bg-neutral-800/50 text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        Custom path...
      </button>

      {/* Clear button */}
      {isActive && (
        <button
          onClick={() => {
            onChange({ mode: "off" });
            setShowCustom(false);
          }}
          className="px-2 py-0.5 text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors"
        >
          &#x2715; Clear
        </button>
      )}

      {/* Custom JSON path input */}
      {showCustom && (
        <div className="w-full flex items-center gap-2 mt-1">
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustomPath()}
            placeholder="e.g. $.cwd or $.message.model"
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-blue-700"
          />
          <button
            onClick={applyCustomPath}
            className="px-2 py-1 bg-blue-900/60 text-blue-300 rounded text-xs cursor-pointer hover:bg-blue-900/80 transition-colors"
          >
            Apply
          </button>
          <a
            href="https://www.sqlite.org/json1.html#path_arguments"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-600 hover:text-neutral-400 transition-colors"
            title="SQLite JSON path syntax docs"
          >
            ?
          </a>
        </div>
      )}
    </div>
  );
}
