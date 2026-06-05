import { NextRequest } from "next/server";
import { openCache, getInstancesByTag } from "@/lib/cache-db";
import { REGISTRY } from "@/lib/message-type-registry";
import type { EntryTag } from "@/lib/classify";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const typeId = searchParams.get("typeId") as EntryTag | null;
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  if (!typeId || !(typeId in REGISTRY)) {
    return Response.json(
      { error: "Invalid or missing typeId" },
      { status: 400 },
    );
  }

  try {
    const db = openCache();
    const tag = REGISTRY[typeId].searchTag;
    const { instances, total } = getInstancesByTag(db, tag, offset, limit);
    return Response.json({
      instances,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to query instances", detail: String(err) },
      { status: 500 },
    );
  }
}
