import { NextRequest } from "next/server";
import { openCache, getGroupsByTagPrefix, getGroupsByJsonPath } from "@/lib/cache-db";
import { REGISTRY } from "@/lib/message-type-registry";
import type { EntryTag } from "@/lib/classify";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const typeId = searchParams.get("typeId") as EntryTag | null;
  const mode = searchParams.get("mode"); // "tag-prefix" | "json-path"

  if (!typeId || !(typeId in REGISTRY)) {
    return Response.json(
      { error: "Invalid or missing typeId" },
      { status: 400 },
    );
  }

  if (!mode || !["tag-prefix", "json-path"].includes(mode)) {
    return Response.json(
      { error: "Invalid or missing mode (tag-prefix | json-path)" },
      { status: 400 },
    );
  }

  try {
    const db = openCache();
    const visualTag = REGISTRY[typeId].searchTag;

    if (mode === "tag-prefix") {
      const tagPrefix = searchParams.get("tagPrefix");
      if (!tagPrefix) {
        return Response.json(
          { error: "Missing tagPrefix parameter" },
          { status: 400 },
        );
      }
      const result = getGroupsByTagPrefix(db, visualTag, tagPrefix);
      return Response.json(result);
    }

    // mode === "json-path"
    const jsonPath = searchParams.get("jsonPath");
    if (!jsonPath) {
      return Response.json(
        { error: "Missing jsonPath parameter" },
        { status: 400 },
      );
    }
    const result = getGroupsByJsonPath(db, visualTag, jsonPath);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: "Failed to query groups", detail: String(err) },
      { status: 500 },
    );
  }
}
