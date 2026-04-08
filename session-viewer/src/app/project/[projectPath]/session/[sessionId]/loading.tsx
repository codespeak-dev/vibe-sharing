export default function Loading() {
  return (
    <div className="text-neutral-500 py-10 text-center">
      <div className="inline-block w-5 h-5 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
      <p className="mt-3 text-sm">Loading session...</p>
    </div>
  );
}
