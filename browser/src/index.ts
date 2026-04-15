/**
 * @codespeak/vibe-sharing-browser — public API.
 */
export type { DiscoveredSession, DiscoveredProject, AgentHandle, ExternalWorktreeHandle } from "./types.js";
export type { VibenessResult } from "./vibeness.js";
export { detectExternalWorktrees } from "./vibeness.js";
export type { UploadMetadata, UploadResult } from "./upload.js";
export type { GitMetadata } from "./git.js";
export { initSqlite } from "./sqlite.js";
export { discoverAllProjects, findProjectSessions } from "./discovery.js";
export { createBundle, downloadBundle } from "./archive.js";
export { calculateVibeness } from "./vibeness.js";
export { uploadBundle } from "./upload.js";
export { readGitMetadata } from "./git.js";
export { buildHandleFromFileList, buildHandleFromEntry } from "./virtual-fs.js";
import type { AgentHandle } from "./types.js";
import { getDirHandle } from "./fs.js";

/**
 * Open a directory picker and detect which AI agent the chosen folder belongs to.
 * Opens near the home directory so users can navigate to hidden dirs easily.
 *
 * Navigate to:
 *   ~/.claude                                  -> Claude Code
 *   ~/.codex                                   -> Codex
 *   ~/Library/.../Cursor/User                  -> Cursor
 */
export async function pickAgentDirectory(): Promise<AgentHandle | null> {
  // "home" is not in the TS types but works at runtime in Chrome/Edge to hint start location
  const handle = await showDirectoryPicker({ mode: "read" });
  return detectAgentHandle(handle);
}

/**
 * Open a directory picker for a project folder.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  return showDirectoryPicker({ mode: "read" });
}

/**
 * Detect which agent a directory handle belongs to by inspecting its contents.
 * Returns null if the directory is not recognised.
 */
export async function detectAgentHandle(
  handle: FileSystemDirectoryHandle,
): Promise<AgentHandle | null> {
  // Claude Code: ~/.claude — has a "projects" subdirectory
  const projectsDir = await getDirHandle(handle, "projects");
  if (projectsDir) {
    return { slug: "claude", name: "Claude Code", handle };
  }

  // Codex CLI: ~/.codex — has a "sessions" subdirectory
  const sessionsDir = await getDirHandle(handle, "sessions");
  if (sessionsDir) {
    return { slug: "codex", name: "Codex", handle };
  }

  // Cursor "User" dir selected directly — ~/Library/.../Cursor/User
  const wsStorage = await getDirHandle(handle, "workspaceStorage");
  if (wsStorage) {
    return { slug: "cursor", name: "Cursor", handle };
  }

  // Cursor parent dir selected — ~/Library/.../Cursor (contains a "User" subdir)
  const userDir = await getDirHandle(handle, "User");
  if (userDir && (await getDirHandle(userDir, "workspaceStorage"))) {
    return { slug: "cursor", name: "Cursor", handle: userDir };
  }

  // Claude Code: single project session dir — contains .jsonl files directly
  // e.g. ~/.claude/projects/-Users-foo-myproject/
  for await (const [name] of handle.entries()) {
    if (name.endsWith(".jsonl")) {
      return { slug: "claude-project", name: "Claude Code", handle };
    }
    break; // only need to check first entry
  }

  return null;
}
