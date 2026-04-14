/**
 * Read basic metadata from a project's .git/config file.
 * Parses the INI-like git config format to extract user info and remote URL.
 */
import { getFileHandle, readText } from "./fs.js";

export interface GitMetadata {
  userEmail?: string;
  userName?: string;
  repoUrl?: string;
}

/**
 * Parse a git config INI file and return relevant metadata.
 * Returns an empty object if .git/config is missing or unparseable.
 */
export async function readGitMetadata(
  projectDirHandle: FileSystemDirectoryHandle,
): Promise<GitMetadata> {
  const handle = await getFileHandle(projectDirHandle, ".git/config");
  if (!handle) return {};

  let text: string;
  try {
    text = await readText(handle);
  } catch {
    return {};
  }

  return parseGitConfig(text);
}

function parseGitConfig(text: string): GitMetadata {
  const result: GitMetadata = {};
  let currentSection = "";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    // Section header: [remote "origin"] or [user]
    const sectionMatch = line.match(/^\[([^\]"]+)(?:\s+"([^"]+)")?\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1]!.trim().toLowerCase();
      const sub = sectionMatch[2] ? sectionMatch[2].toLowerCase() : "";
      currentSection = sub ? `${name}.${sub}` : name;
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1]!.trim().toLowerCase();
    const value = kvMatch[2]!.trim();

    if (currentSection === "user" && key === "email") {
      result.userEmail = value;
    } else if (currentSection === "user" && key === "name") {
      result.userName = value;
    } else if (currentSection === 'remote.origin' && key === "url") {
      result.repoUrl = normalizeRemoteUrl(value);
    }
  }

  return result;
}

/** Convert SSH remote URLs to HTTPS for display. */
function normalizeRemoteUrl(url: string): string {
  // git@github.com:user/repo.git → https://github.com/user/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  // Strip trailing .git from HTTPS URLs
  return url.replace(/\.git$/, "");
}
