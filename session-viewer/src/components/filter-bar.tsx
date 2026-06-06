"use client";

export function FilterBar({
  onExpandAll,
  onReapply,
}: {
  onExpandAll: () => void;
  onReapply: () => void;
}) {
  // TODO: per-tag pills for overriding primary/expanded defaults
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <button
        onClick={onExpandAll}
        className="text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors px-2 py-0.5 border border-neutral-800 rounded"
        title="Expand all blocks and groups"
      >
        Expand all
      </button>
      <button
        onClick={onReapply}
        className="text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors px-2 py-0.5 border border-neutral-800 rounded"
        title="Re-collapse to default view"
      >
        Re-apply filter
      </button>
    </div>
  );
}
