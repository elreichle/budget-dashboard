import type { DebtResponse, GoalsProgress, Plan } from "../api.js";

/** Invented figures for the goals component tests. */

type Projection = DebtResponse["planned"];
type DebtProgress = DebtResponse["progress"]["debts"][number];
type Goal = GoalsProgress["goals"][number];

export function projection(over: Partial<Projection> = {}): Projection {
  return { startMonth: "2026-01", payments: "planned", months: [], debts: [], debtFreeMonth: "2027-08", neverPaysOff: false, totalInterest: 900, totalPaid: 12400, ...over };
}

export function debtProgress(over: Partial<DebtProgress> & Pick<DebtProgress, "id" | "name">): DebtProgress {
  return { startingBalance: 4000, currentBalance: 3000, balanceSource: "snapshot", balanceAsOf: "2026-09-10T08:00:00.000Z", paidSoFar: 1200, percent: 25, interestSavedSoFar: 60, interestSource: "rows", paidOff: false, ...over };
}

/** A synced card and one not yet: `card-a` 4000 → 3000, `card-b` 6000 → 5400. */
export const twoCards = (): DebtProgress[] => [
  debtProgress({ id: "card-a", name: "Card A" }),
  debtProgress({ id: "card-b", name: "Card B", startingBalance: 6000, currentBalance: 5400, paidSoFar: 900, percent: 10, interestSavedSoFar: 40 }),
];

export function debtResponse(debts: DebtProgress[], over: { planned?: Partial<Projection>; live?: Partial<Projection> } = {}): DebtResponse {
  const sum = (pick: (d: DebtProgress) => number) => debts.reduce((total, d) => total + pick(d), 0);
  const startingBalance = sum((d) => d.startingBalance);
  const currentBalance = sum((d) => d.currentBalance);
  return {
    planned: projection(over.planned),
    baseline: projection({ payments: "baseline", debtFreeMonth: "2029-02" }),
    monthsSaved: 18,
    interestSaved: 1500,
    progress: {
      month: "2026-09",
      debts,
      totals: {
        startingBalance,
        currentBalance,
        paidSoFar: sum((d) => d.paidSoFar),
        percent: startingBalance > 0 ? Math.round(((startingBalance - currentBalance) / startingBalance) * 1000) / 10 : 100,
        interestSavedSoFar: sum((d) => d.interestSavedSoFar),
      },
      projection: projection({ startMonth: "2026-09", debtFreeMonth: "2027-06", ...over.live }),
    },
  };
}

export function goal(over: Partial<Goal> & Pick<Goal, "id" | "name">): Goal {
  return { balance: 0, balanceSource: "snapshot", balanceAsOf: "2026-09-10T08:00:00.000Z", nextBill: null, target: null, ...over };
}

export function plan(over: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    currency: "USD",
    planStartMonth: "2026-01",
    income: { netMonthly: 4000, paychecksPerMonth: 1 },
    buckets: [{ id: "meals", name: "Meals", group: "living", planned: 500, baseline: 600 }],
    savingsGoals: [{ id: "bills", name: "Bills fund", monthly: 200, baselineMonthly: 0, targetBalance: null, items: [] }],
    debts: [{ id: "card-a", name: "Card A", asOf: "2025-12-31", creditLimit: 5000, plannedPayment: 400, baselinePayment: 100, segments: [{ name: "Purchases", balance: 4000, apr: 0.2 }] }],
    payoffStrategy: { order: ["card-a"], totalMonthly: 400, rollover: true },
    subscriptions: [],
    ...over,
  };
}
