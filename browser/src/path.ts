/** Join path segments with forward slashes, collapsing doubles. */
export function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function dirname(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/**
 * Encode a project path the same way Claude Code does:
 * replace every "/" with "-".
 * e.g. /Users/foo/proj → -Users-foo-proj
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").replace(/\//g, "-");
}

/**
 * Convert a project path to the Cursor "slug" used for ~/.cursor/projects/<slug>/:
 * strip leading slash then replace all "/" with "-".
 * e.g. /Users/foo/proj → Users-foo-proj
 */
export function projectPathToSlug(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").replace(/^\//g, "").replace(/\//g, "-");
}

/** Strip IDE context tags injected by VS Code / Cursor extensions. */
export function stripIdeTags(text: string): string {
  return text.replace(/<ide_\w+>[\s\S]*?<\/ide_\w+>/g, "").trim();
}
