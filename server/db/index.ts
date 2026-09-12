import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";

export type Db = Database.Database;

export const DB_FILENAME = "budget.db";

export function dbPath(dataDir: string): string {
  return path.join(dataDir, DB_FILENAME);
}

/**
 * Opens (creating if needed) the SQLite database at `file` and brings its schema up to date.
 * Pass `":memory:"` for tests. WAL mode is set on file databases; in-memory databases ignore it.
 */
export function openDatabase(file: string): Db {
  const inMemory = file === ":memory:";
  if (!inMemory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    if (!inMemory) db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export { migrate, migrations, appliedVersions, type Migration } from "./migrations.js";
export * from "./accounts.js";
export * from "./transactions.js";
export * from "./snapshots.js";
export * from "./syncRuns.js";
export * from "./milestones.js";
