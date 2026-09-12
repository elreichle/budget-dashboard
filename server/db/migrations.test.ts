import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { appliedVersions, migrate, migrations } from "./migrations.js";
import { dbPath, openDatabase } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "budget-db-"));
  dirs.push(d);
  return d;
}

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare<[], { name: string }>("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((r) => r.name);
}

describe("migrations", () => {
  it("are numbered 1..n without gaps", () => {
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
  });

  it("create every table and record the applied versions", () => {
    const db = openDatabase(":memory:");
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["accounts", "transactions", "balance_snapshots", "sync_runs", "milestones", "migrations"]),
    );
    expect(appliedVersions(db)).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  it("running twice is a no-op", () => {
    const db = openDatabase(":memory:");
    const before = appliedVersions(db);
    const applied = migrate(db);
    expect(applied).toEqual([]);
    expect(appliedVersions(db)).toEqual(before);
    db.close();
  });

  it("opens <dataDir>/budget.db in WAL mode with foreign keys on, creating the dir", () => {
    const dir = path.join(tmpDir(), "nested", "data");
    const db = openDatabase(dbPath(dir));
    expect(fs.existsSync(path.join(dir, "budget.db"))).toBe(true);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();

    // Reopening applies nothing new and keeps the data.
    const again = openDatabase(dbPath(dir));
    expect(appliedVersions(again)).toEqual(migrations.map((m) => m.version));
    again.close();
  });

  it("a failed migration rethrows, records nothing, and leaves a file DB reopenable", () => {
    const dir = tmpDir();
    expect(() => {
      const db = openDatabase(":memory:");
      try {
        migrate(db, [{ version: 99, name: "broken", up: "create table nope (" }]);
      } finally {
        db.close();
      }
    }).toThrow(/syntax error|incomplete input/);
    // On a file DB the failed open must not leave the file locked for the next open.
    const db = openDatabase(dbPath(dir));
    expect(() => migrate(db, [{ version: 99, name: "broken", up: "create table nope (" }])).toThrow(/syntax error|incomplete input/);
    db.close();
    expect(appliedVersions(openDatabase(dbPath(dir)))).toEqual(migrations.map((m) => m.version));
  });

  it("v3 adds a null requested_since to sync runs recorded before it", () => {
    const db = new Database(":memory:");
    migrate(db, migrations.filter((m) => m.version < 3));
    db.prepare("insert into sync_runs (connector, started_at, finished_at) values ('simplefin', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:05.000Z')").run();
    expect(migrate(db)).toEqual(migrations.filter((m) => m.version >= 3).map((m) => m.version));
    expect(db.prepare("select requested_since from sync_runs").all()).toEqual([{ requested_since: null }]);
    db.close();
  });

  it("rejects a transaction whose bucket_source is not rule|manual|none", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "insert into accounts (connector, external_id, name, institution, type, created_at) values ('t', 'a1', 'Checking', 'Bank', 'checking', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() =>
      db
        .prepare(
          "insert into transactions (account_id, connector, external_id, date, pending, amount, description, bucket_source, created_at, updated_at) values (1, 't', 'x1', '2026-01-02', 0, -5, 'Coffee', 'guess', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/CHECK/);
    db.close();
  });
});
