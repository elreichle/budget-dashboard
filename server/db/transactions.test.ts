import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./index.js";
import { setAccountRole, upsertAccount } from "./accounts.js";
import { getTransaction, listNeedingReview, listTransactions, needsReview, setTransactionBucket, upsertTransaction } from "./transactions.js";

let db: Db;
let accountId: number;
const now = "2026-09-01T12:00:00.000Z";
beforeEach(() => {
  db = openDatabase(":memory:");
  accountId = upsertAccount(db, { connector: "simplefin", externalId: "acc-1", name: "Checking", institution: "Sample Bank", type: "checking" }, now).id;
});
afterEach(() => db.close());

const coffee = { accountId: 0, connector: "simplefin", externalId: "tx-1", date: "2026-09-01", pending: true, amount: -4.5, description: "CORNER COFFEE" };

describe("transactions", () => {
  it("inserts with bucket_source none and reports it as inserted", () => {
    const r = upsertTransaction(db, { ...coffee, accountId }, now);
    expect(r.inserted).toBe(true);
    expect(r.transaction).toMatchObject({ ...coffee, accountId, bucketId: null, bucketSource: "none", createdAt: now, updatedAt: now });
  });

  it("promotes a pending transaction to posted in place, keeping id and bucket", () => {
    const first = upsertTransaction(db, { ...coffee, accountId }, now).transaction;
    setTransactionBucket(db, first.id, { bucketId: "eating-out", source: "manual" }, now);
    const later = "2026-09-03T12:00:00.000Z";
    const r = upsertTransaction(db, { ...coffee, accountId, pending: false, amount: -4.75, date: "2026-09-03" }, later);
    expect(r.inserted).toBe(false);
    expect(r.transaction).toMatchObject({
      id: first.id,
      pending: false,
      amount: -4.75,
      date: "2026-09-03",
      bucketId: "eating-out",
      bucketSource: "manual",
      createdAt: now,
      updatedAt: later,
    });
    expect(listTransactions(db)).toHaveLength(1);
  });

  it("never demotes a posted transaction back to pending and never moves it to another account", () => {
    const other = upsertAccount(db, { connector: "simplefin", externalId: "acc-2", name: "Card", institution: "Sample Bank", type: "credit" }, now).id;
    const posted = upsertTransaction(db, { ...coffee, accountId, pending: false }, now).transaction;
    const r = upsertTransaction(db, { ...coffee, accountId: other, pending: true, amount: -9 }, "2026-09-04T00:00:00.000Z");
    expect(r.inserted).toBe(false);
    expect(r.transaction).toMatchObject({ id: posted.id, pending: false, accountId, amount: -9 });
  });

  it("the same external id under a different connector is a different transaction", () => {
    upsertTransaction(db, { ...coffee, accountId }, now);
    upsertTransaction(db, { ...coffee, accountId, connector: "csv" }, now);
    expect(listTransactions(db)).toHaveLength(2);
  });

  it("rejects an unknown account", () => {
    expect(() => upsertTransaction(db, { ...coffee, accountId: 42 }, now)).toThrow(/FOREIGN KEY/);
  });

  it("files, clears back to none, and stamps updated_at each time", () => {
    const t = upsertTransaction(db, { ...coffee, accountId }, now).transaction;
    const filedAt = "2026-09-05T00:00:00.000Z";
    setTransactionBucket(db, t.id, { bucketId: "groceries", source: "rule" }, filedAt);
    expect(getTransaction(db, t.id)).toMatchObject({ bucketId: "groceries", bucketSource: "rule", updatedAt: filedAt });
    const clearedAt = "2026-09-06T00:00:00.000Z";
    setTransactionBucket(db, t.id, { bucketId: null, source: "none" }, clearedAt);
    expect(getTransaction(db, t.id)).toMatchObject({ bucketId: null, bucketSource: "none", updatedAt: clearedAt });
    expect(() => setTransactionBucket(db, 999, { bucketId: null, source: "none" }, clearedAt)).toThrow(/No transaction 999/);
  });

  it("the schema rejects a filed row marked none and an unfiled row marked rule", () => {
    const t = upsertTransaction(db, { ...coffee, accountId }, now).transaction;
    expect(() => db.prepare("update transactions set bucket_id = 'groceries' where id = ?").run(t.id)).toThrow(/CHECK/);
    expect(() => db.prepare("update transactions set bucket_source = 'rule' where id = ?").run(t.id)).toThrow(/CHECK/);
  });

  it("lists by month, account, pending flag and bucket source, newest first", () => {
    const other = upsertAccount(db, { connector: "simplefin", externalId: "acc-2", name: "Card", institution: "Sample Bank", type: "credit" }, now).id;
    upsertTransaction(db, { ...coffee, accountId, externalId: "a", date: "2026-08-31", pending: false }, now);
    upsertTransaction(db, { ...coffee, accountId, externalId: "b", date: "2026-09-02", pending: false }, now);
    upsertTransaction(db, { ...coffee, accountId, externalId: "c", date: "2026-09-15", pending: true }, now);
    upsertTransaction(db, { ...coffee, accountId: other, externalId: "d", date: "2026-09-20", pending: false }, now);
    upsertTransaction(db, { ...coffee, accountId, externalId: "e", date: "2026-10-01", pending: false }, now);

    expect(listTransactions(db, { month: "2026-09" }).map((t) => t.externalId)).toEqual(["d", "c", "b"]);
    expect(listTransactions(db, { month: "2026-09", accountId }).map((t) => t.externalId)).toEqual(["c", "b"]);
    expect(listTransactions(db, { month: "2026-09", pending: false }).map((t) => t.externalId)).toEqual(["d", "b"]);
    expect(listTransactions(db, { bucketSource: "none" })).toHaveLength(5);
    expect(listTransactions(db, { bucketSource: "manual" })).toHaveLength(0);
  });
});

describe("needs review", () => {
  const planBuckets = new Set(["meals"]);

  it("is unfiled, _uncategorized or a bucket the plan lacks, never a reserved id or a row on an ignored account", () => {
    expect(needsReview(null, "checking", planBuckets)).toBe(true);
    expect(needsReview("_uncategorized", null, planBuckets)).toBe(true);
    expect(needsReview("removed", "card", planBuckets)).toBe(true);
    expect(needsReview("meals", "checking", planBuckets)).toBe(false);
    expect(needsReview("_transfer", "checking", planBuckets)).toBe(false);
    expect(needsReview("_interest", "card", planBuckets)).toBe(false);
    expect(needsReview(null, "ignore", planBuckets)).toBe(false);
    expect(needsReview("removed", "ignore", planBuckets)).toBe(false);
  });

  it("without a plan judges only unfiled and _uncategorized rows", () => {
    expect(needsReview(null, "checking", null)).toBe(true);
    expect(needsReview("_uncategorized", "checking", null)).toBe(true);
    expect(needsReview("removed", "checking", null)).toBe(false);
  });

  it("lists every month's rows that need review, newest first, skipping ignored accounts", () => {
    const ignored = upsertAccount(db, { connector: "simplefin", externalId: "acc-9", name: "Old", institution: "Sample Bank", type: "checking" }, now).id;
    setAccountRole(db, ignored, "ignore");
    const add = (externalId: string, account: number, date: string, bucketId: string | null) => {
      const t = upsertTransaction(db, { ...coffee, accountId: account, externalId, date, pending: false }, now).transaction;
      if (bucketId !== null) setTransactionBucket(db, t.id, { bucketId, source: "manual" }, now);
      return t.id;
    };
    const aug = add("aug", accountId, "2026-08-10", "removed");
    add("filed", accountId, "2026-09-02", "meals");
    const sep = add("sep", accountId, "2026-09-03", null);
    add("ignored", ignored, "2026-09-04", null);
    expect(listNeedingReview(db, planBuckets).map((t) => t.id)).toEqual([sep, aug]);
    expect(listNeedingReview(db, null).map((t) => t.id)).toEqual([sep]);
  });
});
