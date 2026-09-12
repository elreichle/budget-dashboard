import type { DebtProgress } from "../../debt/engine.js";
import type { GoalProgress } from "../../goals/progress.js";
import type { BucketSummary, MonthSummary, SavingsSummary } from "../../months/summary.js";

const SYNCED_AT = "2026-09-10T00:00:00.000Z";

/** A month summary holding only what detection and streaks read: `[id, planned, posted]` buckets, `[id, planned, contributed]` goals. */
export function monthSummary(month: string, buckets: [string, number, number][], savings: [string, number, number][] = [], closed = true): MonthSummary {
  return {
    month,
    daysInMonth: 30,
    daysElapsed: closed ? 30 : 15,
    closed,
    buckets: buckets.map(
      ([id, planned, posted]): BucketSummary => ({ id, name: id, group: "living", planned, posted, pending: 0, expectedByToday: planned, pace: posted > planned ? "over" : "on-pace", remaining: planned - posted }),
    ),
    income: { planned: 0, received: 0, pending: 0 },
    savings: savings.map(([id, planned, contributed]): SavingsSummary => ({ id, name: id, planned, contributed })),
    debts: [],
    uncategorizedCount: 0,
    totals: { planned: 0, posted: 0, pending: 0 },
  };
}

export function debtProgress(id: string, startingBalance: number, currentBalance: number, balanceSource: DebtProgress["balanceSource"] = "snapshot"): DebtProgress {
  return {
    id,
    name: id,
    startingBalance,
    currentBalance,
    balanceSource,
    balanceAsOf: balanceSource === "snapshot" ? SYNCED_AT : null,
    paidSoFar: startingBalance - currentBalance,
    percent: 0,
    interestSavedSoFar: 0,
    interestSource: "estimate",
    paidOff: currentBalance <= 0,
  };
}

export function goalProgress(id: string, balance: number, target: number | null, balanceSource: GoalProgress["balanceSource"] = "snapshot"): GoalProgress {
  return {
    id,
    name: id,
    balance,
    balanceSource,
    balanceAsOf: balanceSource === "snapshot" ? SYNCED_AT : null,
    nextBill: null,
    target: target === null ? null : { amount: target, percent: 0 },
  };
}
