import { openCache, getVisualTagCounts } from "@/lib/cache-db";

export async function GET() {
  try {
    const db = openCache();
    const counts = getVisualTagCounts(db);
    return Response.json(counts);
  } catch (err) {
    return Response.json(
      { error: "Failed to get counts", detail: String(err) },
      { status: 500 },
    );
  }
}
