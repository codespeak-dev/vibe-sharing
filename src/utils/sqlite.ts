import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let sqliteCliAvailable: boolean | null = null;

/**
 * Check if the sqlite3 CLI is available on this system.
 * Result is cached after first check.
 */
export async function hasSqliteCli(): Promise<boolean> {
  if (sqliteCliAvailable !== null) return sqliteCliAvailable;
  try {
    await execFileAsync("sqlite3", ["--version"]);
    sqliteCliAvailable = true;
  } catch {
    sqliteCliAvailable = false;
  }
  return sqliteCliAvailable;
}

/**
 * Run a SQL query against a SQLite database using the sqlite3 CLI.
 * Always uses -readonly to avoid any risk of modifying data.
 * Returns raw stdout string.
 */
export async function sqliteQuery(
  dbPath: string,
  sql: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", dbPath, sql],
    { timeout: 10_000 },
  );
  return stdout;
}

/**
 * Run a SQL query and parse the result as JSON.
 * Uses sqlite3's -json output mode.
 */
export async function sqliteQueryJson<T>(
  dbPath: string,
  sql: string,
): Promise<T[]> {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", "-json", dbPath, sql],
    { timeout: 10_000 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

/**
 * Get installation instructions for sqlite3 based on the current platform.
 */
export function getSqliteInstallInstructions(): string {
  const platform = process.platform;
  const lines = [
    "Cursor session discovery requires sqlite3.",
    "",
  ];

  if (platform === "darwin") {
    lines.push("On macOS, sqlite3 ships with Xcode CLI tools. If missing:");
    lines.push("  xcode-select --install");
  } else if (platform === "win32") {
    lines.push("On Windows, install sqlite3:");
    lines.push("  winget install SQLite.SQLite");
    lines.push("  or download from https://sqlite.org/download.html and add to PATH");
  } else {
    lines.push("On Linux (Debian/Ubuntu): sudo apt install sqlite3");
    lines.push("On Linux (RHEL/Fedora):   sudo dnf install sqlite");
  }

  lines.push("");
  lines.push("Alternatively, upgrade Node.js to 22.5+ (has built-in node:sqlite).");

  return lines.join("\n");
}
