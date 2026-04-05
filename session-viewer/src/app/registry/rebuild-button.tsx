"use client";

import { useState } from "react";

export function RegistryRebuildButton() {
  const [status, setStatus] = useState<"idle" | "rebuilding" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleRebuild = async () => {
    setStatus("rebuilding");
    setMessage(null);
    try {
      const res = await fetch("/api/registry-rebuild", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setMessage(data.message);
      setStatus("done");
      // Reload after a delay so the user sees the result
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-neutral-400">{message}</span>}
      <button
        onClick={handleRebuild}
        disabled={status === "rebuilding"}
        className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {status === "idle" && "Rebuild Index"}
        {status === "rebuilding" && "Rebuilding..."}
        {status === "done" && "Done! Reloading..."}
        {status === "error" && "Error — try again"}
      </button>
    </div>
  );
}
