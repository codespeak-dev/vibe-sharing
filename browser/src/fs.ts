/**
 * Browser File System Access API helpers.
 * All functions accept FileSystemDirectoryHandle / FileSystemFileHandle
 * and return strings, ArrayBuffers, or parsed JSON — no Node.js APIs anywhere.
 */

/** Walk a directory handle recursively, yielding relative paths + file handles. */
export async function* walkDir(
  dir: FileSystemDirectoryHandle,
  prefix = "",
  maxDepth = 20,
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  if (maxDepth <= 0) return;
  for await (const [name, handle] of dir.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      yield { path: rel, handle: handle as FileSystemFileHandle };
    } else {
      yield* walkDir(handle as FileSystemDirectoryHandle, rel, maxDepth - 1);
    }
  }
}

/** Read a file handle as UTF-8 text. */
export async function readText(handle: FileSystemFileHandle): Promise<string> {
  return (await handle.getFile()).text();
}

/** Read a file handle as ArrayBuffer. */
export async function readBuffer(handle: FileSystemFileHandle): Promise<ArrayBuffer> {
  return (await handle.getFile()).arrayBuffer();
}

/**
 * Resolve a relative path (slash-separated) from a root handle.
 * Returns null if any segment is missing.
 */
export async function getFileHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle | null> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]!);
    } catch {
      return null;
    }
  }
  try {
    return await dir.getFileHandle(parts[parts.length - 1]!);
  } catch {
    return null;
  }
}

/** Resolve a relative path to a directory handle; returns null if missing. */
export async function getDirHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle | null> {
  const parts = relativePath.split("/").filter(Boolean);
  let dir: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return dir;
}

/** Read and parse a JSON file; returns null on any error. */
export async function safeReadJson<T>(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<T | null> {
  const handle = await getFileHandle(root, relativePath);
  if (!handle) return null;
  try {
    return JSON.parse(await readText(handle)) as T;
  } catch {
    return null;
  }
}

/** Parse newline-delimited JSON lines from a file handle, skipping bad lines. */
export async function readJsonlHandle<T>(
  handle: FileSystemFileHandle,
): Promise<T[]> {
  const text = await readText(handle);
  const results: T[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      results.push(JSON.parse(t) as T);
    } catch {
      // skip
    }
  }
  return results;
}
