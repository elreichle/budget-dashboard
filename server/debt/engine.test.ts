import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan, type Debt, type Plan, type PayoffStrategy } from "../plan/schema.js";
import { compare, MAX_MONTHS, progress, project } from "./engine.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");

function loadExample(): Plan {
  const parsed = parsePlan(JSON.parse(fs.readFileSync(examplePlan, "utf8")));
  if (!parsed.ok) throw new Error("example plan invalid");
  return parsed.plan;
}

function debt(id: string, segments: { balance: number; apr: number }[], planned: number, baseline = planned): Debt {
  return {
    id,
    name: id.toUpperCase(),
    asOf: "2025-12-31",
    creditLimit: 10000,
    plannedPayment: planned,
    baselinePayment: baseline,
    segments: segments.map((s, i) => ({ name: `seg${i}`, ...s })),
  };
}

function strategy(order: string[], totalMonthly: number, rollover: boolean): PayoffStrategy {
  return { order, totalMonthly, rollover };
}

describe("project", () => {
  it("adds a month of interest before the payment and stops when the balance hits zero", () => {
    const p = project({ debts: [debt("a", [{ balance: 1000, apr: 0.12 }], 110)], strategy: strategy(["a"], 110, false), startMonth: "2026-01" });
    expect(p.months[0]).toEqual({ month: "2026-01", interest: 10, payment: 110, balance: 900, debts: [{ id: "a", interest: 10, payment: 110, balance: 900 }] });
    expect(p.months[1]).toMatchObject({ month: "2026-02", interest: 9, balance: 799 });
    const last = p.months[p.months.length - 1]!;
    expect(last.balance).toBe(0);
    expect(last.payment).toBeLessThan(110);
    expect(p.debtFreeMonth).toBe(last.month);
    expect(p.neverPaysOff).toBe(false);
    expect(p.debts[0]).toMatchObject({ id: "a", startingBalance: 1000, paidOffMonth: last.month });
    expect(p.totalPaid).toBeCloseTo(1000 + p.totalInterest, 2);
  });

  it("pays the highest-APR segment first", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0 }, { balance: 100, apr: 0.24 }], 100)],
      strategy: strategy(["a"], 100, false),
      startMonth: "2026-01",
    });
    // Month 1: 2 interest on the 24% segment, then 100 pays that segment down to 2. Month 2's interest is on those 2 only.
    expect(p.months[0]).toMatchObject({ interest: 2, balance: 102 });
    expect(p.months[1]).toMatchObject({ interest: 0.04, balance: 2.04 });
  });

  it("rolls a paid-off debt's payment (and the same month's leftover) onto the next debt in order", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0 }], 60), debt("b", [{ balance: 1000, apr: 0 }], 40)],
      strategy: strategy(["a", "b"], 100, true),
      startMonth: "2026-01",
    });
    expect(p.months[0]!.debts).toEqual([
      { id: "a", interest: 0, payment: 60, balance: 40 },
      { id: "b", interest: 0, payment: 40, balance: 960 },
    ]);
    expect(p.months[1]!.debts).toEqual([
      { id: "a", interest: 0, payment: 40, balance: 0 },
      { id: "b", interest: 0, payment: 60, balance: 900 },
    ]);
    expect(p.months[2]!.debts[1]).toEqual({ id: "b", interest: 0, payment: 100, balance: 800 });
    expect(p.debts[0]!.paidOffMonth).toBe("2026-02");
    expect(p.months.every((m) => m.payment <= 100)).toBe(true);
  });

  it("without rollover each debt pays only its own amount", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0 }], 60), debt("b", [{ balance: 1000, apr: 0 }], 40)],
      strategy: strategy(["a", "b"], 100, false),
      startMonth: "2026-01",
    });
    expect(p.months[1]!.debts).toEqual([
      { id: "a", interest: 0, payment: 40, balance: 0 },
      { id: "b", interest: 0, payment: 40, balance: 920 },
    ]);
    expect(p.months[2]!.debts[1]).toMatchObject({ payment: 40, balance: 880 });
  });

  it("puts extra budget on the first debt in order and unlisted debts last", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0 }], 60), debt("b", [{ balance: 30, apr: 0 }], 40)],
      strategy: strategy(["b"], 110, true),
      startMonth: "2026-01",
    });
    // b is first: 40 + 10 extra budget → pays 30, 20 rolls to a: 60 + 20 = 80.
    expect(p.months[0]!.debts).toEqual([
      { id: "a", interest: 0, payment: 80, balance: 20 },
      { id: "b", interest: 0, payment: 30, balance: 0 },
    ]);
    expect(p.months[0]!.payment).toBe(110);
  });

  it("caps a payment below the interest at MAX_MONTHS and flags neverPaysOff", () => {
    const p = project({ debts: [debt("a", [{ balance: 1000, apr: 0.24 }], 10)], strategy: strategy(["a"], 10, true), startMonth: "2026-01" });
    expect(p.months).toHaveLength(MAX_MONTHS);
    expect(p.neverPaysOff).toBe(true);
    expect(p.debtFreeMonth).toBeNull();
    expect(p.debts[0]!.paidOffMonth).toBeNull();
    expect(p.months[MAX_MONTHS - 1]!.balance).toBeGreaterThan(1000);
  });

  it("projects nothing when nothing is owed", () => {
    const p = project({ debts: [debt("a", [{ balance: 0, apr: 0.2 }], 50)], strategy: strategy(["a"], 50, true), startMonth: "2026-01" });
    expect(p).toMatchObject({ months: [], debtFreeMonth: null, neverPaysOff: false, totalInterest: 0, totalPaid: 0 });
    expect(p.debts[0]).toMatchObject({ startingBalance: 0, paidOffMonth: null });
  });

  it("reaches an overriding balance by paying the plan's segments down highest-APR first", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0.24 }, { balance: 300, apr: 0.12 }], 50)],
      strategy: strategy(["a"], 50, false),
      startMonth: "2026-06",
      balances: { a: 200 },
    });
    // 200 paid off the 24% segment first: 0 @ 24% and 200 @ 12% → 2.00 interest.
    expect(p.debts[0]!.startingBalance).toBe(200);
    expect(p.months[0]).toMatchObject({ month: "2026-06", interest: 2, balance: 152 });
    expect(p.months[0]!.balance).toBe(project({ debts: [debt("a", [{ balance: 200, apr: 0.12 }], 50)], strategy: strategy(["a"], 50, false), startMonth: "2026-06" }).months[0]!.balance);
  });

  it("puts new charges above the plan's balance on the highest-APR segment", () => {
    const p = project({
      debts: [debt("a", [{ balance: 0, apr: 0 }, { balance: 0, apr: 0.24 }], 50)],
      strategy: strategy(["a"], 50, false),
      startMonth: "2026-06",
      balances: { a: 1000 },
    });
    expect(p.months[0]).toMatchObject({ interest: 20, balance: 970 });
  });

  it("deducts what startMonth already paid from its first payment", () => {
    const p = project({
      debts: [debt("a", [{ balance: 1000, apr: 0 }], 100), debt("b", [{ balance: 1000, apr: 0 }], 100)],
      strategy: strategy(["a", "b"], 200, true),
      startMonth: "2026-03",
      alreadyPaid: { a: 40, b: 500 },
    });
    expect(p.months[0]!.debts.map((d) => d.payment)).toEqual([60, 0]);
    expect(p.months[1]!.debts.map((d) => d.payment)).toEqual([100, 100]);
  });

  it("leaves a debt dated after startMonth idle until the month after its asOf", () => {
    const later = { ...debt("b", [{ balance: 1200, apr: 0.12 }], 100), asOf: "2026-03-15" };
    const p = project({ debts: [debt("a", [{ balance: 100, apr: 0 }], 50), later], strategy: strategy(["a", "b"], 150, true), startMonth: "2026-01" });
    expect(p.months.slice(0, 3).map((m) => m.debts[1])).toEqual([
      { id: "b", interest: 0, payment: 0, balance: 1200 },
      { id: "b", interest: 0, payment: 0, balance: 1200 },
      { id: "b", interest: 0, payment: 0, balance: 1200 },
    ]);
    // The budget b is not yet taking rolls to a, which is gone in January; April: 12 interest, then the whole 150.
    expect(p.months[0]!.debts[0]).toEqual({ id: "a", interest: 0, payment: 100, balance: 0 });
    expect(p.months[1]!.payment).toBe(0);
    expect(p.months[3]!.debts[1]).toEqual({ id: "b", interest: 12, payment: 150, balance: 1062 });
  });

  it("uses baseline payments without rollover in baseline mode", () => {
    const p = project({
      debts: [debt("a", [{ balance: 100, apr: 0 }], 60, 50), debt("b", [{ balance: 1000, apr: 0 }], 40, 20)],
      strategy: strategy(["a", "b"], 100, true),
      startMonth: "2026-01",
      payments: "baseline",
    });
    expect(p.payments).toBe("baseline");
    expect(p.months[0]!.debts.map((d) => d.payment)).toEqual([50, 20]);
    expect(p.months[2]!.debts.map((d) => d.payment)).toEqual([0, 20]);
  });
});

describe("compare", () => {
  it("projects the example plan to a finite month, sooner and cheaper than the baseline", () => {
    const c = compare(loadExample());
    expect(c.planned.startMonth).toBe("2026-01");
    expect(c.planned.neverPaysOff).toBe(false);
    expect(c.baseline.neverPaysOff).toBe(false);
    expect(c.planned.debtFreeMonth).not.toBeNull();
    expect(c.planned.debtFreeMonth! < c.baseline.debtFreeMonth!).toBe(true);
    expect(c.monthsSaved).toBeGreaterThan(0);
    expect(c.interestSaved).toBeGreaterThan(0);
    expect(c.interestSaved).toBeCloseTo(c.baseline.totalInterest - c.planned.totalInterest, 2);
    // First month: card-a 1500 @ 31% + 2000 @ 33% → 38.75 + 55.00 interest, then the 600 payment; card-b 8000 @ 14% → 93.33, then 200;
    // card-c 600 @ 9% → 4.50, then 50.
    expect(c.planned.months[0]!.debts).toEqual([
      { id: "card-a", interest: 93.75, payment: 600, balance: 2993.75 },
      { id: "card-b", interest: 93.33, payment: 200, balance: 7893.33 },
      { id: "card-c", interest: 4.5, payment: 50, balance: 554.5 },
    ]);
    expect(c.baseline.months[0]!.debts.map((d) => d.payment)).toEqual([350, 200, 50]);
  });

  it("reports monthsSaved as null when the baseline never pays off", () => {
    const plan = loadExample();
    const c = compare({ ...plan, debts: plan.debts.map((d) => ({ ...d, baselinePayment: 1 })) });
    expect(c.baseline.neverPaysOff).toBe(true);
    expect(c.monthsSaved).toBeNull();
    expect(c.interestSaved).toBeGreaterThan(0);
  });
});

describe("progress", () => {
  const plan = loadExample();
  const today = "2026-03-20";

  it("falls back to the plan's starting balance with no snapshot", () => {
    const p = progress({ plan, snapshots: [], payments: [], today });
    expect(p.month).toBe("2026-03");
    expect(p.debts[0]).toEqual({
      id: "card-a",
      name: "Card A",
      startingBalance: 3500,
      currentBalance: 3500,
      balanceSource: "plan",
      balanceAsOf: null,
      paidSoFar: 0,
      percent: 0,
      interestSavedSoFar: 0,
      interestSource: "estimate",
      paidOff: false,
    });
    expect(p.totals).toEqual({ startingBalance: 12100, currentBalance: 12100, paidSoFar: 0, percent: 0, interestSavedSoFar: 0 });
    expect(p.projection).toMatchObject({ startMonth: "2026-03", payments: "planned" });
  });

  it("reads the snapshot, counts payments after asOf, and credits interest saved against the baseline", () => {
    const p = progress({
      plan,
      snapshots: [{ debtId: "card-a", owed: 2400, at: "2026-03-15T12:00:00.000Z" }],
      payments: [
        { debtId: "card-a", amount: 100, date: "2025-12-15" },
        { debtId: "card-a", amount: 600, date: "2026-01-05" },
        { debtId: "card-a", amount: 600, date: "2026-02-05" },
        { debtId: "card-b", amount: 200, date: "2026-01-05" },
      ],
      today,
    });
    const baseline = compare(plan).baseline;
    const baselineInterestBeforeMarch = baseline.months
      .filter((m) => m.month < "2026-03")
      .reduce((acc, m) => acc + m.debts.find((d) => d.id === "card-a")!.interest, 0);
    const cardA = p.debts[0]!;
    expect(cardA).toMatchObject({ currentBalance: 2400, balanceSource: "snapshot", balanceAsOf: "2026-03-15T12:00:00.000Z", paidSoFar: 1200, percent: 31.4, paidOff: false });
    // Actual interest so far = 2400 − 3500 + 1200 = 100.
    expect(cardA.interestSavedSoFar).toBeCloseTo(baselineInterestBeforeMarch - 100, 2);
    expect(p.debts[1]).toMatchObject({ id: "card-b", balanceSource: "plan", paidSoFar: 200, percent: 0, interestSavedSoFar: 0 });
    expect(p.totals.paidSoFar).toBe(1400);
    expect(p.projection.debts.map((d) => d.startingBalance)).toEqual([2400, 8000, 600]);
    expect(p.projection.months[0]!.month).toBe("2026-03");
  });

  it("only counts payments up to the snapshot against the interest estimate, and this month's against the live projection", () => {
    const snapshots = [{ debtId: "card-a", owed: 2400, at: "2026-03-15T12:00:00.000Z" }];
    const before = progress({ plan, snapshots, payments: [{ debtId: "card-a", amount: 600, date: "2026-01-05" }, { debtId: "card-a", amount: 600, date: "2026-02-05" }], today });
    const after = progress({ plan, snapshots, payments: [...[{ debtId: "card-a", amount: 600, date: "2026-01-05" }, { debtId: "card-a", amount: 600, date: "2026-02-05" }], { debtId: "card-a", amount: 600, date: "2026-03-18" }], today });
    expect(after.debts[0]!.paidSoFar).toBe(1800);
    expect(after.debts[0]!.interestSavedSoFar).toBe(before.debts[0]!.interestSavedSoFar);
    expect(after.projection.months[0]!.debts[0]!.payment).toBe(0);
    expect(before.projection.months[0]!.debts[0]!.payment).toBe(600);
  });

  const baselineBeforeMarch = () =>
    compare(plan)
      .baseline.months.filter((m) => m.month < "2026-03")
      .reduce((acc, m) => acc + m.debts.find((d) => d.id === "card-a")!.interest, 0);
  const twoPayments = [{ debtId: "card-a", amount: 600, date: "2026-01-05" }, { debtId: "card-a", amount: 600, date: "2026-02-05" }];

  it("takes the interest actually charged from the card's interest rows when it has any, so new purchases do not change it", () => {
    const at = "2026-03-15T12:00:00.000Z";
    const interest = [
      { debtId: "card-a", amount: 30, date: "2025-12-31" }, // on asOf: already in the starting balance
      { debtId: "card-a", amount: 40, date: "2026-01-28" },
      { debtId: "card-a", amount: 35, date: "2026-02-28" },
      { debtId: "card-a", amount: 25, date: "2026-03-10" }, // the snapshot's month, whose baseline is not counted yet
      { debtId: "card-a", amount: 20, date: "2026-03-18" }, // after the snapshot
      { debtId: "card-b", amount: 90, date: "2026-02-28" },
    ];
    const quiet = progress({ plan, snapshots: [{ debtId: "card-a", owed: 2400, at }], payments: twoPayments, interest, today });
    const spent = progress({ plan, snapshots: [{ debtId: "card-a", owed: 2900, at }], payments: twoPayments, interest, today });
    expect(quiet.debts[0]!.interestSource).toBe("rows");
    expect(quiet.debts[0]!.interestSavedSoFar).toBeCloseTo(baselineBeforeMarch() - 75, 2);
    expect(spent.debts[0]).toMatchObject({ interestSource: "rows", interestSavedSoFar: quiet.debts[0]!.interestSavedSoFar });
    expect(quiet.debts[1]).toMatchObject({ id: "card-b", interestSource: "rows", interestSavedSoFar: 0 });
  });

  it("falls back to the balance estimate when a card has no interest rows after asOf, which new purchases still move", () => {
    const snapshots = [{ debtId: "card-a", owed: 2400, at: "2026-03-15T12:00:00.000Z" }];
    const none = progress({ plan, snapshots, payments: twoPayments, today });
    const onAsOf = progress({ plan, snapshots, payments: twoPayments, interest: [{ debtId: "card-a", amount: 30, date: "2025-12-31" }], today });
    const spent = progress({ plan, snapshots: [{ ...snapshots[0]!, owed: 2410 }], payments: twoPayments, today });
    expect(none.debts[0]!.interestSource).toBe("estimate");
    // Actual interest so far = 2400 − 3500 + 1200 = 100.
    expect(none.debts[0]!.interestSavedSoFar).toBeCloseTo(baselineBeforeMarch() - 100, 2);
    expect(onAsOf.debts[0]).toMatchObject({ interestSource: "estimate", interestSavedSoFar: none.debts[0]!.interestSavedSoFar });
    expect(spent.debts[0]!.interestSavedSoFar).toBeCloseTo(none.debts[0]!.interestSavedSoFar - 10, 2);
  });

  it("sums the snapshots of several accounts linked to one debt and dates them by the newest", () => {
    const p = progress({
      plan,
      snapshots: [
        { debtId: "card-b", owed: 3000, at: "2026-03-10T00:00:00.000Z" },
        { debtId: "card-b", owed: 5000, at: "2026-03-09T00:00:00.000Z" },
      ],
      payments: [],
      today,
    });
    expect(p.debts[1]).toMatchObject({ id: "card-b", currentBalance: 8000, balanceAsOf: "2026-03-10T00:00:00.000Z", percent: 0 });
  });

  it("does not credit the snapshot's own month before it has elapsed", () => {
    const p = progress({ plan, snapshots: [{ debtId: "card-a", owed: 3500, at: "2026-01-01T00:00:01.000Z" }], payments: [], today: "2026-01-02" });
    expect(p.debts[0]!.interestSavedSoFar).toBe(0);
  });

  it("marks a zeroed card paid off at 100% and never reports negative interest saved", () => {
    const p = progress({
      plan,
      snapshots: [{ debtId: "card-a", owed: 0, at: "2026-03-01T00:00:00.000Z" }],
      payments: [{ debtId: "card-a", amount: 9000, date: "2026-02-01" }],
      today,
    });
    expect(p.debts[0]).toMatchObject({ currentBalance: 0, percent: 100, paidOff: true, interestSavedSoFar: 0 });
    expect(p.projection.debts[0]!.paidOffMonth).toBeNull();
  });

  it("caps a card with any balance left at 99.9%", () => {
    const p = progress({ plan, snapshots: [{ debtId: "card-a", owed: 1, at: "2026-03-01T00:00:00.000Z" }], payments: [], today });
    expect(p.debts[0]).toMatchObject({ currentBalance: 1, percent: 99.9, paidOff: false });
  });

  it("treats float dust left by summed snapshots as paid off", () => {
    const at = "2026-03-01T00:00:00.000Z";
    const snapshots = [0.1, 0.2, -0.3].map((owed) => ({ debtId: "card-a", owed, at }));
    const p = progress({ plan, snapshots, payments: [], today });
    expect(p.debts[0]).toMatchObject({ currentBalance: 0, percent: 100, paidOff: true });
  });
});

describe("progress by the machine's calendar day", () => {
  it("dates a snapshot by its local day, so one taken early on the 1st counts the month before as elapsed", () => {
    const plan = loadExample();
    // 01:00 local on March 1st: still February in UTC for any zone east of it (the suite runs in one).
    const at = new Date(2026, 2, 1, 1).toISOString();
    const payments = [{ debtId: "card-a", amount: 600, date: "2026-01-05" }, { debtId: "card-a", amount: 600, date: "2026-02-05" }];
    const p = progress({ plan, snapshots: [{ debtId: "card-a", owed: 2400, at }], payments, today: "2026-03-20" });
    const baselineInterestBeforeMarch = compare(plan)
      .baseline.months.filter((m) => m.month < "2026-03")
      .reduce((acc, m) => acc + m.debts.find((d) => d.id === "card-a")!.interest, 0);
    // Actual interest so far = 2400 − 3500 + 1200 = 100.
    expect(p.debts[0]!.interestSavedSoFar).toBeCloseTo(baselineInterestBeforeMarch - 100, 2);
  });
});
