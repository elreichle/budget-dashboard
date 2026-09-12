import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./index.js";
import { upsertAccount } from "./accounts.js";
import { hasSnapshot, insertSnapshot, latestSnapshot, listSnapshots } from "./snapshots.js";

let db: Db;
let accountId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  accountId = upsertAccount(db, { connector: "simplefin", externalId: "card-1", name: "Card", institution: "Sample Bank", type: "credit" }, "2026-09-01T00:00:00.000Z").id;
});
afterEach(() => db.close());

describe("balance snapshots", () => {
  it("returns undefined when there are none", () => {
    expect(latestSnapshot(db, accountId)).toBeUndefined();
    expect(listSnapshots(db, accountId)).toEqual([]);
  });

  it("appends per sync and reports the latest by time, not insertion order", () => {
    insertSnapshot(db, { accountId, at: "2026-09-02T08:00:00.000Z", balance: -1200 });
    insertSnapshot(db, { accountId, at: "2026-09-01T08:00:00.000Z", balance: -1250.5 });
    expect(latestSnapshot(db, accountId)).toMatchObject({ at: "2026-09-02T08:00:00.000Z", balance: -1200 });
    expect(listSnapshots(db, accountId).map((s) => s.balance)).toEqual([-1250.5, -1200]);
  });

  it("filters by an inclusive [from, to] time range", () => {
    for (const day of ["01", "05", "09"]) insertSnapshot(db, { accountId, at: `2026-09-${day}T00:00:00.000Z`, balance: -100 });
    expect(listSnapshots(db, accountId, { from: "2026-09-02T00:00:00.000Z", to: "2026-09-09T00:00:00.000Z" })).toHaveLength(2);
  });

  it("rejects an unknown account", () => {
    expect(() => insertSnapshot(db, { accountId: 99, at: "2026-09-01T00:00:00.000Z", balance: 0 })).toThrow(/FOREIGN KEY/);
  });
});

describe("hasSnapshot", () => {
  it("matches only the exact account, timestamp and balance", () => {
    const db = openDatabase(":memory:");
    const acc = upsertAccount(db, { connector: "t", externalId: "1", name: "n", institution: "i", type: "checking" }, "2026-09-01T00:00:00.000Z");
    const reading = { accountId: acc.id, at: "2026-09-01T00:00:00.000Z", balance: 10 };
    expect(hasSnapshot(db, reading)).toBe(false);
    insertSnapshot(db, reading);
    expect(hasSnapshot(db, reading)).toBe(true);
    expect(hasSnapshot(db, { ...reading, balance: 11 })).toBe(false);
    expect(hasSnapshot(db, { ...reading, at: "2026-09-02T00:00:00.000Z" })).toBe(false);
  });
});
