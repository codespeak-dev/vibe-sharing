"use client";

export function PlanBadge({ entryIndex }: { entryIndex: number }) {
  return (
    <button
      onClick={() => {
        window.location.hash = `#entry-${entryIndex}`;
      }}
      className="text-xs text-purple-300 bg-purple-900/50 rounded px-1.5 py-0.5 hover:bg-purple-900/80 transition-colors cursor-pointer"
    >
      plan
    </button>
  );
}
