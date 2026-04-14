import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { OPENCODE_DATA_DIR, OPENCODE_DB_PATH } from "../../config.js";
import { fileExists } from "../../utils/fs-helpers.js";
import {
  hasSqliteCli,
  sqliteQueryJson,
  sqliteCreateFiltered,
} from "../../utils/sqlite.js";
import type {
  AgentProvider,
  DiscoveredSession,
  ProjectContext,
} from "../types.js";

interface OpenCodeSession {
  id: string;
  project_id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface OpenCodeMessageCount {
  session_id: string;
  cnt: number;
}

interface OpenCodeFirstPrompt {
  text: string;
}

export class OpenCodeProvider implements AgentProvider {
  readonly name = "OpenCode";
  readonly slug = "opencode";

  /** Project IDs matched during findSessions, used to scope the DB extract */
  private matchedProjectIds: string[] = [];
  /** Session IDs matched during findSessions */
  private matchedSessionIds: string[] = [];
  /** Path to filtered DB extract */
  private extractPath: string | null = null;

  async detect(): Promise<boolean> {
    if (!(await hasSqliteCli())) return false;
    return fileExists(OPENCODE_DB_PATH);
  }

  getArchiveRoot(): string {
    return OPENCODE_DATA_DIR;
  }

  async discoverProjects(): Promise<Map<string, number>> {
    const projects = new Map<string, number>();

    try {
      const rows = await sqliteQueryJson<{
        worktree: string;
        cnt: number;
      }>(
        OPENCODE_DB_PATH,
        `SELECT p.worktree, COUNT(s.id) AS cnt
         FROM project p
         JOIN session s ON s.project_id = p.id
         WHERE p.worktree != '' AND p.worktree != '/'
         GROUP BY p.id`,
      );

      for (const row of rows) {
        if (row.worktree && row.cnt > 0) {
          projects.set(
            row.worktree,
            (projects.get(row.worktree) ?? 0) + row.cnt,
          );
        }
      }
    } catch {
      // Never throw
    }

    return projects;
  }

  async findSessions(context: ProjectContext): Promise<DiscoveredSession[]> {
    const { projectPath, allWorktreePaths } = context;
    const sessions: DiscoveredSession[] = [];

    try {
      const allPaths = allWorktreePaths.length > 0 ? allWorktreePaths : [projectPath];
      const escaped = allPaths.map((p) => p.replace(/'/g, "''"));
      const whereClause = escaped.map((p) => `'${p}'`).join(",");

      const rows = await sqliteQueryJson<OpenCodeSession>(
        OPENCODE_DB_PATH,
        `SELECT s.id, s.project_id, s.title, s.directory,
                s.time_created, s.time_updated
         FROM session s
         JOIN project p ON p.id = s.project_id
         WHERE p.worktree IN (${whereClause})
         ORDER BY s.time_created DESC`,
      );

      if (rows.length === 0) return [];

      // Track matched IDs for scoping the DB extract
      this.matchedProjectIds = [...new Set(rows.map((r) => r.project_id))];
      this.matchedSessionIds = rows.map((r) => r.id);

      // Get message counts per session
      const sessionIds = rows.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(",");
      const counts = await sqliteQueryJson<OpenCodeMessageCount>(
        OPENCODE_DB_PATH,
        `SELECT session_id, COUNT(*) as cnt
         FROM message
         WHERE session_id IN (${sessionIds})
         GROUP BY session_id`,
      );
      const countMap = new Map(counts.map((c) => [c.session_id, c.cnt]));

      for (const row of rows) {
        let firstPrompt: string | null = null;
        try {
          const prompts = await sqliteQueryJson<OpenCodeFirstPrompt>(
            OPENCODE_DB_PATH,
            `SELECT json_extract(p.data, '$.text') as text
             FROM part p
             JOIN message m ON m.id = p.message_id
             WHERE m.session_id = '${row.id.replace(/'/g, "''")}'
               AND json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
             ORDER BY p.time_created ASC
             LIMIT 1`,
          );
          if (prompts.length > 0 && prompts[0]!.text) {
            firstPrompt = prompts[0]!.text.slice(0, 200);
          }
        } catch {
          // Skip first prompt extraction on error
        }

        sessions.push({
          agentName: this.name,
          sessionId: row.id,
          summary: row.title || null,
          firstPrompt,
          messageCount: countMap.get(row.id) ?? null,
          created: row.time_created
            ? new Date(row.time_created).toISOString()
            : null,
          modified: row.time_updated
            ? new Date(row.time_updated).toISOString()
            : null,
          sizeBytes: 0, // Data lives in SQLite, not individual files
        });
      }
    } catch {
      // Never throw
    }

    return sessions;
  }

  async getSessionFiles(_session: DiscoveredSession): Promise<string[]> {
    return [];
  }

  async getProviderFiles(): Promise<string[]> {
    const files: string[] = [];

    // 1. Filtered DB extract — only rows for matched projects/sessions
    const extractPath = await this.createFilteredExtract();
    if (extractPath) {
      files.push(extractPath);
    }

    // 2. Session diff JSON files — only for matched sessions
    const storageDiffDir = path.join(OPENCODE_DATA_DIR, "storage", "session_diff");
    const matchedSet = new Set(this.matchedSessionIds);
    try {
      const entries = await fs.readdir(storageDiffDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        // Filename is <sessionId>.json
        const sessionId = entry.slice(0, -5);
        if (matchedSet.has(sessionId)) {
          files.push(path.join(storageDiffDir, entry));
        }
      }
    } catch {
      // Directory may not exist
    }

    return files;
  }

  getSessionDir(): string | null {
    return OPENCODE_DATA_DIR;
  }

  /**
   * Create a filtered copy of opencode.db containing only data for matched projects.
   * Copies schema directly from source to avoid breakage when OpenCode adds columns.
   * Mirrors the approach used by CursorProvider.createStateExtract().
   */
  private async createFilteredExtract(): Promise<string | null> {
    if (this.extractPath) return this.extractPath;
    if (this.matchedProjectIds.length === 0) return null;

    try {
      const tmpPath = path.join(
        os.tmpdir(),
        `opencode-extract-${Date.now()}.db`,
      );
      const escapedSource = OPENCODE_DB_PATH.replace(/'/g, "''");
      const projectIn = this.matchedProjectIds
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(",");
      const sessionSubquery = `(SELECT id FROM source.session WHERE project_id IN (${projectIn}))`;

      const sql = [
        `ATTACH DATABASE '${escapedSource}' AS source;`,

        // Copy table schemas from source (handles any columns OpenCode adds)
        "CREATE TABLE project AS SELECT * FROM source.project WHERE 0;",
        "CREATE TABLE session AS SELECT * FROM source.session WHERE 0;",
        "CREATE TABLE message AS SELECT * FROM source.message WHERE 0;",
        "CREATE TABLE part AS SELECT * FROM source.part WHERE 0;",
        "CREATE TABLE todo AS SELECT * FROM source.todo WHERE 0;",

        // Copy only matched project data
        `INSERT INTO project SELECT * FROM source.project WHERE id IN (${projectIn});`,
        `INSERT INTO session SELECT * FROM source.session WHERE project_id IN (${projectIn});`,
        `INSERT INTO message SELECT * FROM source.message WHERE session_id IN ${sessionSubquery};`,
        `INSERT INTO part SELECT * FROM source.part WHERE session_id IN ${sessionSubquery};`,
        `INSERT INTO todo SELECT * FROM source.todo WHERE session_id IN ${sessionSubquery};`,

        "DETACH source;",
      ].join("\n");

      await sqliteCreateFiltered(tmpPath, sql);
      this.extractPath = tmpPath;
      return tmpPath;
    } catch {
      // Fall back to not including the DB
      return null;
    }
  }
}
