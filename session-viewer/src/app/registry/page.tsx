import Link from "next/link";
import { REGISTRY, type EntryTypeSpec } from "@/lib/message-type-registry";
import type { EntryTag } from "@/lib/classify";
import { openCache, getVisualTagCounts } from "@/lib/cache-db";
import { RegistryRebuildButton } from "./rebuild-button";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const db = openCache();
  const counts = getVisualTagCounts(db);

  const specs = Object.values(REGISTRY) as EntryTypeSpec[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">Message Type Registry</h1>
          <p className="text-sm text-neutral-500">
            All message types the UI distinguishes. Click a type to browse all instances.
          </p>
        </div>
        <RegistryRebuildButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {specs.map((spec) => {
          const count = counts[spec.searchTag] ?? 0;
          return (
            <Link
              key={spec.id}
              href={`/registry/${spec.id}`}
              className="block border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${spec.color}`}>
                  {spec.id}
                </span>
                <span className="text-sm font-medium">{spec.displayName}</span>
              </div>
              <p className="text-xs text-neutral-500 mb-3">{spec.description}</p>
              <div className="text-xs text-neutral-400">
                {count > 0 ? (
                  <span>{count.toLocaleString()} {count === 1 ? "instance" : "instances"}</span>
                ) : (
                  <span className="text-neutral-600">no instances</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
