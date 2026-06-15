import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { FIXTURE_HOME, FIXTURE_PROJECTS_DIR, ENCODED_PROJECT_DIR, SEEDED_TYPES } from "./fixtures";

// Seed a clean $HOME/.claude/projects/<encoded>/<session>.jsonl for each seeded type, one entry per
// session, so the registry attributes exactly one example to each kind. Every entry is REALISTIC
// Claude Code JSONL (top-level type/uuid/cwd/sessionId/timestamp + a `message`), so any reasonable
// classifier — raw `type` predicate, a content-block scan, or an entry_tags tag — resolves the same
// kind. We also delete any stale SQLite cache from a previous run so the ingestion the spec triggers
// starts from empty (a leftover cache could otherwise mask a broken build).
export default async function globalSetup(_config: FullConfig) {
  const cacheDb = path.join(FIXTURE_HOME, ".claude", ".session-viewer-cache.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(cacheDb + suffix, { force: true });
  }

  const sessionDir = path.join(FIXTURE_PROJECTS_DIR, ENCODED_PROJECT_DIR);
  await mkdir(sessionDir, { recursive: true });

  for (const seed of SEEDED_TYPES) {
    await writeFile(
      path.join(sessionDir, `${seed.sessionId}.jsonl`),
      JSON.stringify(seed.entry) + "\n",
    );
  }
}
