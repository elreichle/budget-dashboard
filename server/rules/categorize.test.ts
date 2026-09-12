import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTransaction, openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { categorize, debtPaidBy } from "./categorize.js";

let db: Db;
let checking: number;
let card: number;
const t0 = "2026-09-01T12:00:00.000Z";
const t1 = "2026-09-02T12:00:00.000Z";
const rules = [
  { match: "GROCERY", bucket: "meals" },
  { match: "FARE", bucket: "transit" },
  { match: "PAYMENT THANK YOU", bucket: "_transfer" },
  { match: "PAYROLL", bucket: "_income" },
];

beforeEach(() => {
  db = openDatabase(":memory:");
  checking = upsertAccount(db, { connector: "fake", externalId: "chk", name: "Checking", institution: "Bank", type: "checking" }, t0).id;
  card = upsertAccount(db, { connector: "fake", externalId: "card", name: "Card", institution: "Issuer", type: "credit" }, t0).id;
  setAccountRole(db, card, "card");
  setAccountLinks(db, card, { linkedGoalIds: [], linkedDebtId: "card-a" });
});
afterEach(() => db.close());

let n = 0;
function add(accountId: number, description: string, amount: number, pending = false) {
  n += 1;
  return upsertTransaction(db, { accountId, connector: "fake", externalId: `tx-${n}`, date: "2026-09-01", pending, amount, description }, t0).transaction.id;
}

describe("categorize", () => {
  it("files posted and pending transactions by the first matching rule and leaves the rest unfiled", () => {
    const groceries = add(checking, "Grocery Mart 12", -50);
    const fuel = add(checking, "BUS FARE", -30, true);
    const mystery = add(checking, "SOMETHING ELSE", -10);
    const counts = categorize(db, rules, t1);
    expect(counts).toEqual({ filed: 2, unfiled: 0, debtLinked: 0, unmatched: 1 });
    expect(getTransaction(db, groceries)).toMatchObject({ bucketId: "meals", bucketSource: "rule", updatedAt: t1 });
    expect(getTransaction(db, fuel)).toMatchObject({ bucketId: "transit", bucketSource: "rule" });
    expect(getTransaction(db, mystery)).toMatchObject({ bucketId: null, bucketSource: "none", updatedAt: t0 });
  });

  it("never overrides a manual filing, and re-files rule filings when the rules change", () => {
    const manual = add(checking, "GROCERY MART", -50);
    setTransactionBucket(db, manual, { bucketId: "transit", source: "manual" }, t0);
    const byRule = add(checking, "GROCERY MART", -20);
    categorize(db, rules, t1);
    expect(getTransaction(db, byRule)).toMatchObject({ bucketId: "meals", bucketSource: "rule" });

    const counts = categorize(db, [{ match: "GROCERY", bucket: "transit" }], t1);
    expect(counts).toMatchObject({ filed: 1, unfiled: 0 });
    expect(getTransaction(db, manual)).toMatchObject({ bucketId: "transit", bucketSource: "manual" });
    expect(getTransaction(db, byRule)).toMatchObject({ bucketId: "transit", bucketSource: "rule" });

    expect(categorize(db, [], t1)).toMatchObject({ filed: 0, unfiled: 1, unmatched: 1 });
    expect(getTransaction(db, byRule)).toMatchObject({ bucketId: null, bucketSource: "none" });
  });

  it("is idempotent: a second pass with the same rules changes nothing", () => {
    add(checking, "GROCERY MART", -50);
    add(card, "PAYMENT THANK YOU", 200);
    categorize(db, rules, t1);
    expect(categorize(db, rules, "2026-09-03T00:00:00.000Z")).toEqual({ filed: 0, unfiled: 0, debtLinked: 0, unmatched: 0 });
  });

  it("records a transfer into a linked card account as a payment toward its debt, and nothing else", () => {
    const payment = add(card, "AUTOPAY PAYMENT THANK YOU", 200);
    const purchase = add(card, "GROCERY MART", -40);
    const reversal = add(card, "PAYMENT THANK YOU REVERSAL", -200);
    const fromChecking = add(checking, "CARD PAYMENT THANK YOU", -200);
    const counts = categorize(db, rules, t1);
    expect(counts.debtLinked).toBe(1);
    expect(getTransaction(db, payment)).toMatchObject({ bucketId: "_transfer", debtId: "card-a" });
    expect(getTransaction(db, purchase)).toMatchObject({ bucketId: "meals", debtId: null });
    expect(getTransaction(db, reversal)).toMatchObject({ bucketId: "_transfer", debtId: null });
    expect(getTransaction(db, fromChecking)).toMatchObject({ bucketId: "_transfer", debtId: null });
  });

  it("derives the debt link for manual transfers too, and clears it when the link goes away", () => {
    const id = add(card, "ONLINE TRANSFER", 150);
    setTransactionBucket(db, id, { bucketId: "_transfer", source: "manual" }, t0);
    categorize(db, [], t1);
    expect(getTransaction(db, id)).toMatchObject({ bucketSource: "manual", debtId: "card-a" });

    setAccountLinks(db, card, { linkedGoalIds: [], linkedDebtId: null });
    expect(categorize(db, [], t1)).toMatchObject({ debtLinked: 1 });
    expect(getTransaction(db, id)).toMatchObject({ debtId: null });
  });

  it("debtPaidBy needs a transfer, a card role, a link and money in", () => {
    const base = { bucketId: "_transfer", amount: 10, accountRole: "card" as const, linkedDebtId: "card-a" };
    expect(debtPaidBy(base)).toBe("card-a");
    expect(debtPaidBy({ ...base, bucketId: "meals" })).toBeNull();
    expect(debtPaidBy({ ...base, accountRole: "checking" })).toBeNull();
    expect(debtPaidBy({ ...base, linkedDebtId: null })).toBeNull();
    expect(debtPaidBy({ ...base, amount: -10 })).toBeNull();
  });
});
