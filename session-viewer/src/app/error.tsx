"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="text-center py-10">
      <p className="text-red-400 mb-2">Something went wrong</p>
      <p className="text-sm text-neutral-500 mb-4">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm border border-neutral-700 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}
