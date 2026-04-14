/**
 * Browser Claude Code session provider.
 *
 * Reads from a FileSystemDirectoryHandle pointing to ~/.claude.
 * Sessions live at: ~/.claude/projects/<encoded-path>/<session-id>.jsonl
 *
 * Also supports a handle pointing directly to a single project session directory
 * (slug: "claude-project"), e.g. ~/.claude/projects/-Users-foo-myproject/.
 */
import type { DiscoveredSession } from "../types.js";
import { getDirHandle, readText, readJsonlHandle } from "../fs.js";
import { encodeProjectPath, stripIdeTags } from "../path.js";

const AGENT_NAME = "Claude Code";
const AGENT_SLUG = "claude-code";

interface ClaudeMessage {
  type?: string;
  cwd?: string;
  timestamp?: string;
  aiTitle?: string;
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
}

// ── Shared inner helpers ──────────────────────────────────────────────────────

/** Extract the project cwd from the first few lines of a JSONL file text. */
function extractCwdFromText(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as ClaudeMessage;
      if (msg.type === "user" && msg.cwd) return msg.cwd;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Parse a single JSONL session file and return a DiscoveredSession if it
 * belongs to projectPath, or null otherwise.
 */
async function parseSessionFile(
  fileName: string,
  fileHandle: FileSystemFileHandle,
  projectPath: string,
): Promise<DiscoveredSession | null> {
  const sessionId = fileName.slice(0, -".jsonl".length);
  let summary: string | null = null;
  let firstPrompt: string | null = null;
  let messageCount = 0;
  let created: string | null = null;
  let modified: string | null = null;
  let belongsToProject = false;

  try {
    const messages = await readJsonlHandle<ClaudeMessage>(fileHandle);
    for (const msg of messages) {
      if (msg.type === "ai-title") {
        if (msg.aiTitle) summary = msg.aiTitle;
        continue;
      }
      if (msg.type !== "user") continue;
      messageCount++;
      if (!created && msg.timestamp) created = msg.timestamp;
      if (msg.timestamp) modified = msg.timestamp;

      if (!belongsToProject && msg.cwd) {
        belongsToProject =
          msg.cwd === projectPath || msg.cwd.startsWith(projectPath + "/");
      }

      if (!firstPrompt && msg.message?.content) {
        const block = msg.message.content.find((c) => c.type === "text");
        if (block?.text) {
          firstPrompt = stripIdeTags(block.text).slice(0, 200) || null;
        }
      }
    }
  } catch {
    return null;
  }

  if (!belongsToProject) return null;

  const file = await fileHandle.getFile();
  return {
    agentName: AGENT_NAME,
    agentSlug: AGENT_SLUG,
    sessionId,
    summary,
    firstPrompt,
    messageCount,
    created,
    modified,
    sizeBytes: file.size,
  };
}

// ── ~/.claude root handle (slug: "claude") ────────────────────────────────────

/**
 * Discover all projects that have Claude Code sessions.
 * claudeHandle: the ~/.claude directory.
 */
export async function discoverClaudeProjects(
  claudeHandle: FileSystemDirectoryHandle,
): Promise<Map<string, number>> {
  const projects = new Map<string, number>();
  const projectsDir = await getDirHandle(claudeHandle, "projects");
  if (!projectsDir) return projects;

  for await (const [, encodedDirHandle] of projectsDir.entries()) {
    if (encodedDirHandle.kind !== "directory") continue;
    const encDir = encodedDirHandle as FileSystemDirectoryHandle;

    let cwd: string | null = null;
    let count = 0;
    for await (const [fileName, fileHandle] of encDir.entries()) {
      if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
      count++;
      if (!cwd) {
        try {
          const text = await readText(fileHandle as FileSystemFileHandle);
          cwd = extractCwdFromText(text);
        } catch { /* keep trying with next file */ }
      }
    }
    if (cwd && count > 0) {
      projects.set(cwd, (projects.get(cwd) ?? 0) + count);
    }
  }

  return projects;
}

/**
 * Find all Claude Code sessions for a given project path.
 * claudeHandle: the ~/.claude directory.
 */
export async function findClaudeSessions(
  claudeHandle: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<DiscoveredSession[]> {
  const encoded = encodeProjectPath(projectPath);
  const projectsDir = await getDirHandle(claudeHandle, "projects");
  if (!projectsDir) return [];
  const sessionDir = await getDirHandle(projectsDir, encoded);
  if (!sessionDir) return [];
  return readSessionsFromDir(sessionDir, projectPath);
}

/**
 * Collect JSONL files for a set of sessions to include in the bundle.
 * claudeHandle: the ~/.claude directory.
 */
export async function getClaudeSessionFiles(
  claudeHandle: FileSystemDirectoryHandle,
  projectPath: string,
  sessionIds: Set<string>,
): Promise<Array<{ zipPath: string; handle: FileSystemFileHandle }>> {
  const encoded = encodeProjectPath(projectPath);
  const result: Array<{ zipPath: string; handle: FileSystemFileHandle }> = [];

  const projectsDir = await getDirHandle(claudeHandle, "projects");
  if (!projectsDir) return result;
  const sessionDir = await getDirHandle(projectsDir, encoded);
  if (!sessionDir) return result;

  for await (const [fileName, fileHandle] of sessionDir.entries()) {
    if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
    const sid = fileName.slice(0, -".jsonl".length);
    if (!sessionIds.has(sid)) continue;
    result.push({
      zipPath: `sessions/.claude/projects/${encoded}/${fileName}`,
      handle: fileHandle as FileSystemFileHandle,
    });
  }
  return result;
}

// ── Single project session dir handle (slug: "claude-project") ───────────────

/**
 * Discover the project(s) present in a single project session directory.
 * projectDir: a directory containing .jsonl session files directly.
 */
export async function discoverClaudeProjectFromDir(
  projectDir: FileSystemDirectoryHandle,
): Promise<Map<string, number>> {
  const projects = new Map<string, number>();

  for await (const [fileName, fileHandle] of projectDir.entries()) {
    if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
    try {
      const text = await readText(fileHandle as FileSystemFileHandle);
      const cwd = extractCwdFromText(text);
      if (cwd) projects.set(cwd, (projects.get(cwd) ?? 0) + 1);
    } catch {
      continue;
    }
  }

  return projects;
}

/**
 * Find all Claude sessions for a project from a single project session dir.
 * projectDir: a directory containing .jsonl session files directly.
 */
export async function findClaudeSessionsFromDir(
  projectDir: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<DiscoveredSession[]> {
  return readSessionsFromDir(projectDir, projectPath);
}

/**
 * Collect JSONL files for bundling from a single project session dir.
 * projectDir: a directory containing .jsonl session files directly.
 */
export async function getClaudeSessionFilesFromDir(
  projectDir: FileSystemDirectoryHandle,
  sessionIds: Set<string>,
): Promise<Array<{ zipPath: string; handle: FileSystemFileHandle }>> {
  const result: Array<{ zipPath: string; handle: FileSystemFileHandle }> = [];
  const dirName = projectDir.name; // the encoded project path

  for await (const [fileName, fileHandle] of projectDir.entries()) {
    if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
    const sid = fileName.slice(0, -".jsonl".length);
    if (!sessionIds.has(sid)) continue;
    result.push({
      zipPath: `sessions/.claude/projects/${dirName}/${fileName}`,
      handle: fileHandle as FileSystemFileHandle,
    });
  }
  return result;
}

// ── Shared ────────────────────────────────────────────────────────────────────

async function readSessionsFromDir(
  sessionDir: FileSystemDirectoryHandle,
  projectPath: string,
): Promise<DiscoveredSession[]> {
  const sessions: DiscoveredSession[] = [];

  for await (const [fileName, fileHandle] of sessionDir.entries()) {
    if (fileHandle.kind !== "file" || !fileName.endsWith(".jsonl")) continue;
    try {
      const session = await parseSessionFile(
        fileName,
        fileHandle as FileSystemFileHandle,
        projectPath,
      );
      if (session) sessions.push(session);
    } catch {
      continue;
    }
  }

  return sessions;
}
