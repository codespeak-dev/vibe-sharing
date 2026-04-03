/** Format bytes into a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format an ISO date string as a short date. */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Format an ISO date string as a relative time (e.g. "3 hours ago"). */
export function formatRelative(iso: string | null): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  } catch {
    return "";
  }
}

/** Format an ISO date string as a short date + 24h time, with year if not current year. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    };
    if (d.getFullYear() !== new Date().getFullYear()) {
      opts.year = "numeric";
    }
    return d.toLocaleString("en-US", opts);
  } catch {
    return "";
  }
}

/** Format an ISO date string as 24h time only (e.g. "15:42"). */
export function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return "";
  }
}

/** Check whether two ISO date strings fall on the same calendar date. */
export function isSameDate(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Format the duration between two ISO date strings as "Xd Yh" or "Xh Ym". */
export function formatDuration(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso || !endIso) return "";
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (ms < 0) return "";
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  } catch {
    return "";
  }
}

/** Truncate a string with ellipsis. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/** Replace occurrences of a cwd path with $CWD in text. */
export function foldCwd(text: string, cwd: string): string {
  if (!cwd) return text;
  // Ensure no trailing slash for consistent replacement
  const normalized = cwd.replace(/\/+$/, "");
  if (!normalized) return text;
  return text.replaceAll(normalized, "$CWD");
}

/** Shorten a path from the beginning if it exceeds maxLen. e.g. ".../foo.txt" */
export function shortenPath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  // Find last component(s) that fit
  const parts = path.split("/");
  let result = parts[parts.length - 1] ?? path;
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts.slice(i).join("/");
    if (candidate.length + 4 > maxLen) break; // 4 for ".../"
    result = candidate;
  }
  return `.../${result}`;
}

/** Strip IDE context tags from text. */
export function stripIdeTags(text: string): string {
  return text.replace(/<ide_\w+>[\s\S]*?<\/ide_\w+>/g, "").trim();
}

export interface IdeTag {
  tagName: string;
  content: string;
}

export interface TextSegment {
  type: "text" | "ide";
  text?: string;
  tag?: IdeTag;
}

/** Parse text into alternating text and IDE tag segments. */
export function parseIdeTags(text: string): { segments: TextSegment[]; tags: IdeTag[] } {
  const re = /<(ide_\w+)>([\s\S]*?)<\/\1>/g;
  const segments: TextSegment[] = [];
  const tags: IdeTag[] = [];
  let lastIndex = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const tag: IdeTag = { tagName: match[1], content: match[2].trim() };
    tags.push(tag);
    segments.push({ type: "ide", tag });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return { segments, tags };
}
