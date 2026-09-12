import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Account, AccountRole } from "../db/accounts.js";
import type { Transaction } from "../db/transactions.js";
import { parsePlan, type Plan } from "../plan/schema.js";
import { paceOf, summarizeMonth, type MonthSummaryInput } from "./summary.js";

const parsed = parsePlan(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/plan.example.json"), "utf8")));
if (!parsed.ok) throw new Error("example plan invalid");
const plan: Plan = parsed.plan;

const stamp = "2026-09-01T00:00:00.000Z";
let nextId = 1;

function account(id: number, role: AccountRole | null, links: Partial<Pick<Account, "linkedGoalIds" | "linkedDebtId">> = {}): Account {
  return { id, connector: "fake", externalId: `a${id}`, name: `Account ${id}`, institution: "Bank", type: "x", role, linkedGoalIds: [], linkedDebtId: null, createdAt: stamp, ...links };
}

function tx(accountId: number, date: string, amount: number, bucketId: string | null, extra: Partial<Transaction> = {}): Transaction {
  const id = nextId++;
  return {
    id,
    accountId,
    connector: "fake",
    externalId: `t${id}`,
    date,
    pending: false,
    amount,
    description: `tx ${id}`,
    bucketId,
    bucketSource: bucketId === null ? "none" : "rule",
    debtId: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}

const CHECKING = account(1, "checking");
const CARD = account(2, "card", { linkedDebtId: "card-a" });
const SAVINGS = account(3, "savings", { linkedGoalIds: ["irregular-costs", "rainy-day"] });
const UNASSIGNED = account(4, null);
const IGNORED = account(5, "ignore");
const accounts = [CHECKING, CARD, SAVINGS, UNASSIGNED, IGNORED];

function summarize(transactions: Transaction[], overrides: Partial<MonthSummaryInput> = {}) {
  return summarizeMonth({ plan, transactions, accounts, month: "2026-09", today: "2026-09-15", ...overrides });
}

const bucket = (s: ReturnType<typeof summarizeMonth>, id: string) => {
  const b = s.buckets.find((x) => x.id === id);
  if (!b) throw new Error(`no bucket ${id}`);
  return b;
};

describe("summarizeMonth buckets", () => {
  it("sums posted spending per bucket from checking and card accounts, nets refunds, keeps pending apart", () => {
    const s = summarize([
      tx(1, "2026-09-03", -80.5, "meals"),
      tx(2, "2026-09-04", -20.25, "meals"),
      tx(1, "2026-09-05", 10, "meals"), // refund
      tx(2, "2026-09-06", -33.33, "meals", { pending: true }),
    ]);
    expect(bucket(s, "meals")).toMatchObject({ planned: 500, posted: 90.75, pending: 33.33, remaining: 409.25, group: "living" });
    expect(bucket(s, "transit").posted).toBe(0);
    expect(s.totals).toEqual({ planned: 2430, posted: 90.75, pending: 33.33 });
  });

  it("ignores spending on savings, ignored and unassigned accounts, and everything outside the month", () => {
    const s = summarize([
      tx(3, "2026-09-03", -50, "meals"),
      tx(4, "2026-09-03", -50, "meals"),
      tx(5, "2026-09-03", -50, "meals"),
      tx(1, "2026-08-31", -50, "meals"),
      tx(1, "2026-10-01", -50, "meals"),
    ]);
    expect(bucket(s, "meals").posted).toBe(0);
  });

  it("never counts transfers, interest charges, income or unfiled rows as spending", () => {
    const s = summarize([tx(1, "2026-09-03", -600, "_transfer"), tx(1, "2026-09-03", -25, "_interest"), tx(1, "2026-09-03", -5, null), tx(1, "2026-09-03", -7, "_uncategorized")]);
    expect(s.totals.posted).toBe(0);
    expect(s.uncategorizedCount).toBe(2);
  });

  it("prorates a living bucket's plan by days elapsed and reports pace", () => {
    const s = summarize([tx(1, "2026-09-03", -300, "meals"), tx(1, "2026-09-03", -70, "transit"), tx(1, "2026-09-03", -100, "hobbies")]);
    expect(s).toMatchObject({ daysInMonth: 30, daysElapsed: 15, closed: false });
    expect(bucket(s, "meals")).toMatchObject({ expectedByToday: 250, pace: "trending-over" }); // 300 > 275
    expect(bucket(s, "transit")).toMatchObject({ expectedByToday: 40, pace: "trending-over" });
    expect(bucket(s, "hobbies")).toMatchObject({ expectedByToday: 25, pace: "over", remaining: -50 });
    expect(bucket(s, "gifts")).toMatchObject({ expectedByToday: 20, pace: "on-pace" });
  });

  it("does not prorate a fixed bucket: on pace up to its plan, over past it, never trending over", () => {
    const early = summarize([tx(1, "2026-09-01", -1200, "rent"), tx(2, "2026-09-01", -200.01, "power"), tx(1, "2026-09-01", -100, "gym")], { today: "2026-09-01" });
    expect(bucket(early, "rent")).toMatchObject({ group: "fixed", expectedByToday: null, pace: "on-pace", remaining: 0 });
    expect(bucket(early, "power")).toMatchObject({ expectedByToday: null, pace: "over", remaining: -0.01 });
    expect(bucket(early, "gym")).toMatchObject({ expectedByToday: null, pace: "over", remaining: -70 });
    expect(bucket(early, "meals")).toMatchObject({ expectedByToday: 16.67, pace: "on-pace" });
    const closed = summarize([tx(1, "2026-09-10", -600, "rent")], { today: "2026-10-01" });
    expect(bucket(closed, "rent")).toMatchObject({ expectedByToday: null, pace: "on-pace", remaining: 600 });
  });

  it("treats a past month as fully elapsed and a future month as not started", () => {
    const past = summarize([tx(1, "2026-09-30", -510, "meals")], { today: "2026-10-01" });
    expect(past).toMatchObject({ daysElapsed: 30, closed: true });
    expect(bucket(past, "meals")).toMatchObject({ expectedByToday: 500, pace: "over" });
    const last = summarize([tx(1, "2026-09-30", -510, "meals")], { today: "2026-09-30" });
    expect(last).toMatchObject({ daysElapsed: 30, closed: false });
    const future = summarize([], { today: "2026-08-20" });
    expect(future).toMatchObject({ daysElapsed: 0, closed: false });
    expect(bucket(future, "meals")).toMatchObject({ expectedByToday: 0, pace: "on-pace" });
    expect(summarize([], { month: "2028-02", today: "2028-03-05" }).daysInMonth).toBe(29);
  });

  it("judges pace on cent-rounded amounts, so float noise in a sum never tips a bucket over", () => {
    const rows = [tx(1, "2026-09-03", -0.22, "meals"), tx(2, "2026-09-04", -257.41, "meals"), tx(1, "2026-09-05", -242.37, "meals")];
    const transit = [tx(1, "2026-09-03", -0.64, "transit"), tx(2, "2026-09-04", -41.09, "transit"), tx(1, "2026-09-05", -2.27, "transit")];
    const closed = summarize(rows, { today: "2026-10-01" });
    expect(bucket(closed, "meals")).toMatchObject({ planned: 500, posted: 500, remaining: 0, pace: "on-pace" });
    const mid = summarize([...rows, ...transit]);
    expect(bucket(mid, "meals").pace).toBe("trending-over");
    expect(bucket(mid, "transit")).toMatchObject({ posted: 44, expectedByToday: 40, pace: "on-pace" }); // exactly 110%
  });
});

describe("paceOf", () => {
  it("is over past the plan, trending-over past 110% of the prorated plan, else on-pace", () => {
    expect(paceOf(0, 100, 50)).toBe("on-pace");
    expect(paceOf(55, 100, 50)).toBe("on-pace");
    expect(paceOf(55.01, 100, 50)).toBe("trending-over");
    expect(paceOf(100, 100, 50)).toBe("trending-over");
    expect(paceOf(100.01, 100, 50)).toBe("over");
    expect(paceOf(0.01, 0, 0)).toBe("over");
  });

  it("never trends over without an expected-by-today figure", () => {
    expect(paceOf(100, 100, null)).toBe("on-pace");
    expect(paceOf(100.01, 100, null)).toBe("over");
  });
});

describe("summarizeMonth income, savings, debts", () => {
  it("counts posted income on checking accounts, pending separately", () => {
    const s = summarize([
      tx(1, "2026-09-04", 3600, "_income"),
      tx(1, "2026-09-22", 400, "_income", { pending: true }),
      tx(2, "2026-09-15", 25, "_income"), // a card credit is not income
      tx(1, "2026-09-16", -30, "_income"), // a reversal is not income either
    ]);
    expect(s.income).toEqual({ planned: 4000, received: 3600, pending: 400 });
  });

  it("splits posted deposits into a savings account across its linked goals by planned monthly", () => {
    const s = summarize([
      tx(3, "2026-09-02", 400, "_transfer"),
      tx(3, "2026-09-20", 100, "_transfer", { pending: true }),
      tx(3, "2026-09-21", -150, "_transfer"), // withdrawals do not un-contribute
      tx(1, "2026-09-02", -400, "_transfer"), // the checking side of the same move
    ]);
    expect(s.savings).toEqual([
      { id: "irregular-costs", name: "Irregular costs fund", planned: 300, contributed: 300 },
      { id: "rainy-day", name: "Rainy day fund", planned: 100, contributed: 100 },
    ]);
  });

  it("makes rounded shares add up to the deposit", () => {
    const three = account(7, "savings", { linkedGoalIds: ["irregular-costs", "rainy-day"] });
    const s = summarize([tx(7, "2026-09-02", 0.01, "_transfer"), tx(7, "2026-09-03", 100, "_transfer")], { accounts: [...accounts, three] });
    expect(s.savings.map((g) => g.contributed)).toEqual([75.01, 25]);
  });

  it("gives a deposit to a single linked goal in full and nothing to unlinked goals", () => {
    const single = account(6, "savings", { linkedGoalIds: ["rainy-day"] });
    const s = summarize([tx(6, "2026-09-02", 250, "_transfer")], { accounts: [...accounts, single] });
    expect(s.savings.map((g) => g.contributed)).toEqual([0, 250]);
  });

  it("sums posted transfers into a card linked to a plan debt, ignoring a stale stored debt link", () => {
    const s = summarize([
      tx(2, "2026-09-05", 600, "_transfer", { debtId: "card-a" }),
      tx(2, "2026-09-25", 50, "_transfer", { debtId: "card-a", pending: true }),
      tx(2, "2026-09-25", 10, "meals", { debtId: "card-a" }), // re-filed by hand; not a payment any more
      tx(1, "2026-09-25", 10, "_transfer", { debtId: "card-a" }), // wrong account
    ]);
    expect(s.debts).toEqual([
      { id: "card-a", name: "Card A", planned: 600, paid: 600 },
      { id: "card-b", name: "Card B", planned: 200, paid: 0 },
      { id: "card-c", name: "Card C", planned: 50, paid: 0 },
    ]);
  });

  it("counts unfiled, _uncategorized and removed-bucket rows on any account but an ignored one, pending included", () => {
    const s = summarize([
      tx(4, "2026-09-05", -1, null),
      tx(1, "2026-09-05", -1, null, { pending: true }),
      tx(5, "2026-09-05", -1, null),
      tx(5, "2026-09-05", -1, "removed-bucket"),
      tx(1, "2026-09-05", -1, "removed-bucket"),
      tx(2, "2026-09-05", -1, "_uncategorized"),
      tx(1, "2026-09-05", -1, "_transfer"),
    ]);
    expect(s.uncategorizedCount).toBe(4);
    expect(s.totals.posted).toBe(0);
  });
});
