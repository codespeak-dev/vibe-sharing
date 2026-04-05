import { NextRequest } from "next/server";
import {
  openCache,
  getInstancesByTag,
  getInstancesByTagAndSubTag,
  getInstancesByJsonPathValue,
} from "@/lib/cache-db";
import { REGISTRY } from "@/lib/message-type-registry";
import type { EntryTag } from "@/lib/classify";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const typeId = searchParams.get("typeId") as EntryTag | null;
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  // Optional group filter params
  const groupTag = searchParams.get("groupTag"); // e.g. "tool:Bash"
  const groupJsonPath = searchParams.get("groupJsonPath"); // e.g. "$.cwd"
  const groupValue = searchParams.get("groupValue"); // value to match, or "__null__" for ungrouped

  if (!typeId || !(typeId in REGISTRY)) {
    return Response.json(
      { error: "Invalid or missing typeId" },
      { status: 400 },
    );
  }

  try {
    const db = openCache();
    const visualTag = REGISTRY[typeId].searchTag;

    let result: { instances: ReturnType<typeof getInstancesByTag>["instances"]; total: number };

    if (groupTag) {
      // Tag-prefix group drill-down
      result = getInstancesByTagAndSubTag(db, visualTag, groupTag, offset, limit);
    } else if (groupJsonPath) {
      // JSON path group drill-down
      const value = groupValue === "__null__" ? null : groupValue;
      result = getInstancesByJsonPathValue(db, visualTag, groupJsonPath, value, offset, limit);
    } else {
      // Default: no group filter
      result = getInstancesByTag(db, visualTag, offset, limit);
    }

    return Response.json({
      instances: result.instances,
      total: result.total,
      hasMore: offset + limit < result.total,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to query instances", detail: String(err) },
      { status: 500 },
    );
  }
}
