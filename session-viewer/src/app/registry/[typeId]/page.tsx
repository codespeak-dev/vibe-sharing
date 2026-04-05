import Link from "next/link";
import { REGISTRY } from "@/lib/message-type-registry";
import type { EntryTag } from "@/lib/classify";
import { openCache, getInstancesByTag } from "@/lib/cache-db";
import { getPresetsForType } from "@/lib/group-state";
import { RegistryInstancesClient } from "./client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function RegistryTypePage({
  params,
}: {
  params: Promise<{ typeId: string }>;
}) {
  const { typeId } = await params;
  const spec = REGISTRY[typeId as EntryTag];

  if (!spec) {
    return (
      <div className="text-neutral-500 py-10 text-center">
        Unknown type: {typeId}
      </div>
    );
  }

  // Load first page server-side — no client loading spinner needed
  const db = openCache();
  const { instances, total } = getInstancesByTag(db, spec.searchTag, 0, PAGE_SIZE);
  const presets = getPresetsForType(typeId as EntryTag);

  return (
    <div>
      <div className="mb-6">
        <Link href="/registry" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          &larr; Back to registry
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${spec.color}`}>
            {spec.id}
          </span>
          <h1 className="text-xl font-semibold">{spec.displayName}</h1>
        </div>
        <p className="text-sm text-neutral-500 mt-1">{spec.description}</p>
      </div>
      <RegistryInstancesClient
        typeId={typeId as EntryTag}
        presets={presets}
        initialInstances={instances}
        initialTotal={total}
      />
    </div>
  );
}
