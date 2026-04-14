/**
 * Thin wrapper around sql.js for browser use.
 * sql.js is loaded from jsDelivr CDN at runtime via a <script> tag so that
 * bundlers (Vite, webpack) never touch its WASM-heavy code.
 */
import type { SqlJsStatic, Database } from "sql.js";

const SQL_JS_CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.js";
const WASM_CDN   = "https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.wasm";

let _SQL: SqlJsStatic | null = null;

/** Load sql.js from CDN via a script tag, returns the global initSqlJs fn. */
async function loadSqlJsScript(): Promise<(config: unknown) => Promise<SqlJsStatic>> {
  // Already loaded?
  if (typeof (window as unknown as Record<string, unknown>)["initSqlJs"] === "function") {
    return (window as unknown as Record<string, unknown>)["initSqlJs"] as (config: unknown) => Promise<SqlJsStatic>;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SQL_JS_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load sql.js from ${SQL_JS_CDN}`));
    document.head.appendChild(script);
  });
  return (window as unknown as Record<string, unknown>)["initSqlJs"] as (config: unknown) => Promise<SqlJsStatic>;
}

export async function initSqlite(): Promise<void> {
  if (_SQL) return;
  const initSqlJs = await loadSqlJsScript();
  _SQL = await initSqlJs({ locateFile: () => WASM_CDN });
}

export function openDatabase(buffer: ArrayBuffer): Database {
  if (!_SQL) throw new Error("Call initSqlite() before using SQLite.");
  return new _SQL.Database(new Uint8Array(buffer));
}

/**
 * Execute a single-row single-column query; returns the value as string or null.
 */
export function queryFirstString(db: Database, sql: string): string | null {
  try {
    const [result] = db.exec(sql);
    const value = result?.values[0]?.[0];
    return value != null ? String(value) : null;
  } catch {
    return null;
  }
}

export function closeDatabase(db: Database): void {
  try {
    db.close();
  } catch {
    // ignore
  }
}
