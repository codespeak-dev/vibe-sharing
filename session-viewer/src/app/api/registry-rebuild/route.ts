import { openCache, rebuildAllSessions } from "@/lib/cache-db";

export async function POST() {
  try {
    const db = openCache();
    const { sessionsIndexed, entriesIndexed } = await rebuildAllSessions(db);
    return Response.json({
      ok: true,
      sessionsIndexed,
      entriesIndexed,
      message: `Re-indexed ${sessionsIndexed} sessions (${entriesIndexed} entries).`,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to rebuild", detail: String(err) },
      { status: 500 },
    );
  }
}
