/**
 * Browser Codex (OpenAI Codex CLI) session provider.
 *
 * Sessions live at: ~/.codex/sessions/YYYY/MM/DD/rollout-{id}.jsonl
 * Each JSONL starts with a session_meta or turn_context entry containing the cwd.
 */
import type { DiscoveredSession, DiscoveredProject } from "../types.js";
import { getDirHandle, walkDir, readJsonlHandle } from "../fs.js";

const AGENT_NAME = "Codex";
const AGENT_SLUG = "codex";

interface CodexEntry {
  type?: string;
  session?: { id?: string; timestamp?: string; cwd?: string };
  turn_context?: { cwd?: string };
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

/** Discover all projects that have Codex sessions. */
export async function discoverCodexProjects(
  codexHandle: FileSystemDirectoryHandle,
): Promise<Map<string, number>> {
  const projects = new Map<string, number>();
  const sessionsDir = await getDirHandle(codexHandle, "sessions");
  if (!sessionsDir) return projects;

  for await (const { path, handle } of walkDir(sessionsDir)) {
    if (!path.endsWith(".jsonl") || !handle.name.startsWith("rollout-")) continue;
    try {
      const entries = await readJsonlHandle<CodexEntry>(handle);
      const cwd = extractCwd(entries);
      if (cwd) projects.set(cwd, (projects.get(cwd) ?? 0) + 1);
    } catch {
      // skip unreadable files
    }
  }

  return projects;
}

/** Find all Codex sessions for a given project path. */
export async function findCodexSessions(
  codexHandle: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<DiscoveredSession[]> {
  const sessionsDir = await getDirHandle(codexHandle, "sessions");
  if (!sessionsDir) return [];

  const sessions: DiscoveredSession[] = [];

  for await (const { path, handle } of walkDir(sessionsDir)) {
    if (!path.endsWith(".jsonl") || !handle.name.startsWith("rollout-")) continue;
    try {
      const entries = await readJsonlHandle<CodexEntry>(handle);
      const cwd = extractCwd(entries);
      if (!cwd || (cwd !== projectPath && !cwd.startsWith(projectPath + "/"))) continue;

      const sessionId = handle.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
      const sessionMeta = entries.find((e) => e.type === "session_meta");
      const timestamp = sessionMeta?.session?.timestamp ?? null;
      const firstPrompt = extractFirstPrompt(entries);
      const messageCount = entries.filter(
        (e) => e.role === "user" || e.type === "response_item",
      ).length;

      const file = await handle.getFile();
      sessions.push({
        agentName: AGENT_NAME,
        agentSlug: AGENT_SLUG,
        sessionId,
        summary: null,
        firstPrompt,
        messageCount,
        created: timestamp,
        modified: timestamp,
        sizeBytes: file.size,
      });
    } catch {
      // skip
    }
  }

  return sessions;
}

/** Collect session files for bundling. */
export async function getCodexSessionFiles(
  codexHandle: FileSystemDirectoryHandle,
  sessionIds: Set<string>,
): Promise<Array<{ zipPath: string; handle: FileSystemFileHandle }>> {
  const sessionsDir = await getDirHandle(codexHandle, "sessions");
  if (!sessionsDir) return [];
  const result: Array<{ zipPath: string; handle: FileSystemFileHandle }> = [];

  for await (const { path, handle } of walkDir(sessionsDir)) {
    if (!path.endsWith(".jsonl") || !handle.name.startsWith("rollout-")) continue;
    const sid = handle.name.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
    if (sessionIds.has(sid)) {
      result.push({ zipPath: `sessions/.codex/sessions/${path}`, handle });
    }
  }

  return result;
}

function extractCwd(entries: CodexEntry[]): string | null {
  for (const entry of entries.slice(0, 10)) {
    if (entry.session?.cwd) return entry.session.cwd;
    if (entry.turn_context?.cwd) return entry.turn_context.cwd;
  }
  return null;
}

function extractFirstPrompt(entries: CodexEntry[]): string | null {
  for (const entry of entries) {
    if (entry.role !== "user" && entry.type !== "response_item") continue;
    const content = entry.content;
    if (typeof content === "string" && content.trim()) return content.slice(0, 200);
    if (Array.isArray(content)) {
      const text = content.find((c) => c.type === "text")?.text;
      if (text) return text.slice(0, 200);
    }
  }
  return null;
}
