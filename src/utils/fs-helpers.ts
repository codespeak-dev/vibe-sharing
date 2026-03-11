import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Check if a directory exists.
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Safely read and parse a JSON file. Returns null on any error.
 */
export async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Read a JSONL file line by line, yielding parsed objects.
 * Skips lines that fail to parse.
 */
export async function* readJsonl<T>(
  filePath: string,
): AsyncGenerator<T, void, undefined> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch {
      // Skip malformed lines
    }
  }
}

/**
 * Get file size in bytes. Returns 0 on error.
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Recursively walk a directory and return all file paths (relative to root).
 * Respects the provided exclude function.
 */
export async function walkDirectory(
  root: string,
  shouldExclude: (relativePath: string, isDirectory: boolean) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (shouldExclude(relativePath, true)) continue;
        await walk(`${dir}/${entry.name}`, relativePath);
      } else if (entry.isFile()) {
        if (shouldExclude(relativePath, false)) continue;
        results.push(relativePath);
      }
    }
  }

  await walk(root, "");
  return results;
}
