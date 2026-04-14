/**
 * Browser Cursor session provider.
 *
 * Two handles are needed:
 *   - workspaceStorageHandle: the "User" dir inside Cursor's app data
 *     (e.g. ~/Library/Application Support/Cursor/User  or  ~/cursor-work-profile/User)
 *   - dotCursorHandle (optional): ~/.cursor  — needed for agent-transcript files
 *
 * Sessions are Composer sessions stored in workspace state.vscdb.
 * Conversation content lives in ~/.cursor/projects/<slug>/agent-transcripts/<composerId>.txt
 */
import type { DiscoveredSession } from "../types.js";
import { getDirHandle, getFileHandle, readText, readBuffer } from "../fs.js";
import { projectPathToSlug } from "../path.js";
import { openDatabase, queryFirstString, closeDatabase } from "../sqlite.js";

const AGENT_NAME = "Cursor";
const AGENT_SLUG = "cursor";

interface ComposerMeta {
  composerId?: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  subtitle?: string;
}

/**
 * Discover all projects with Cursor Composer sessions.
 * workspaceUserHandle: the "User" subdirectory of Cursor's app data dir.
 */
export async function discoverCursorProjects(
  workspaceUserHandle: FileSystemDirectoryHandle,
  agentName = AGENT_NAME,
): Promise<Map<string, number>> {
  const projects = new Map<string, number>();
  const wsStorageDir = await getDirHandle(workspaceUserHandle, "workspaceStorage");
  if (!wsStorageDir) return projects;

  for await (const [, handle] of wsStorageDir.entries()) {
    if (handle.kind !== "directory") continue;
    const wsDir = handle as FileSystemDirectoryHandle;

    // Resolve project path from workspace.json
    const wsJsonHandle = await getFileHandle(wsDir, "workspace.json");
    if (!wsJsonHandle) continue;

    let folderPath: string;
    try {
      const text = await readText(wsJsonHandle);
      const wsJson = JSON.parse(text) as { folder?: string };
      if (!wsJson.folder) continue;
      folderPath = new URL(wsJson.folder).pathname;
    } catch {
      continue;
    }

    // Count Composer sessions from state.vscdb
    const stateHandle = await getFileHandle(wsDir, "state.vscdb");
    if (!stateHandle) continue;

    try {
      const buffer = await readBuffer(stateHandle);
      const db = openDatabase(buffer);
      const raw = queryFirstString(
        db,
        "SELECT value FROM ItemTable WHERE key='composer.composerData';",
      );
      closeDatabase(db);
      if (!raw) continue;
      const data = JSON.parse(raw) as { allComposers?: unknown[] };
      const count = data.allComposers?.length ?? 0;
      if (count > 0) {
        projects.set(folderPath, (projects.get(folderPath) ?? 0) + count);
      }
    } catch {
      continue;
    }
  }

  return projects;
}

/**
 * Find all Cursor Composer sessions for a project.
 */
export async function findCursorSessions(
  workspaceUserHandle: FileSystemDirectoryHandle,
  projectPath: string,
  agentName = AGENT_NAME,
  agentSlug = AGENT_SLUG,
): Promise<DiscoveredSession[]> {
  const wsStorageDir = await getDirHandle(workspaceUserHandle, "workspaceStorage");
  if (!wsStorageDir) return [];

  const expectedFolder = `file://${projectPath}`;

  for await (const [, handle] of wsStorageDir.entries()) {
    if (handle.kind !== "directory") continue;
    const wsDir = handle as FileSystemDirectoryHandle;

    const wsJsonHandle = await getFileHandle(wsDir, "workspace.json");
    if (!wsJsonHandle) continue;

    try {
      const text = await readText(wsJsonHandle);
      const wsJson = JSON.parse(text) as { folder?: string };
      if (wsJson.folder !== expectedFolder) continue;
    } catch {
      continue;
    }

    // Matched — read Composer sessions
    const stateHandle = await getFileHandle(wsDir, "state.vscdb");
    if (!stateHandle) return [];

    try {
      const buffer = await readBuffer(stateHandle);
      const db = openDatabase(buffer);
      const raw = queryFirstString(
        db,
        "SELECT value FROM ItemTable WHERE key='composer.composerData';",
      );
      closeDatabase(db);
      if (!raw) return [];

      const data = JSON.parse(raw) as { allComposers?: ComposerMeta[] };
      return (data.allComposers ?? [])
        .filter((c) => c.composerId)
        .map((c) => ({
          agentName,
          agentSlug,
          sessionId: c.composerId!,
          summary: c.name && c.name !== "New Composer" ? c.name : null,
          firstPrompt: c.subtitle ?? null,
          messageCount: null,
          created: c.createdAt ? new Date(c.createdAt).toISOString() : null,
          modified: c.lastUpdatedAt
            ? new Date(c.lastUpdatedAt).toISOString()
            : null,
          sizeBytes: 0,
        }));
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Collect agent-transcript files for the given sessions.
 * dotCursorHandle: the ~/.cursor directory.
 */
export async function getCursorSessionFiles(
  dotCursorHandle: FileSystemDirectoryHandle,
  projectPath: string,
  sessionIds: Set<string>,
): Promise<Array<{ zipPath: string; handle: FileSystemFileHandle }>> {
  const slug = projectPathToSlug(projectPath);
  const result: Array<{ zipPath: string; handle: FileSystemFileHandle }> = [];

  const transcriptsDir = await getDirHandle(
    dotCursorHandle,
    `projects/${slug}/agent-transcripts`,
  );
  if (!transcriptsDir) return result;

  for await (const [fileName, fileHandle] of transcriptsDir.entries()) {
    if (fileHandle.kind !== "file" || !fileName.endsWith(".txt")) continue;
    const sid = fileName.slice(0, -".txt".length);
    if (!sessionIds.has(sid)) continue;
    result.push({
      zipPath: `sessions/.cursor/projects/${slug}/agent-transcripts/${fileName}`,
      handle: fileHandle as FileSystemFileHandle,
    });
  }

  return result;
}
