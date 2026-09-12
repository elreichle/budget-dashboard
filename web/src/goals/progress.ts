import type { DebtResponse } from "../api.js";

/** Whole calendar months from `from` to `to` (`YYYY-MM`); positive when `to` is later. */
export function monthsBetween(from: string, to: string): number {
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return index(to) - index(from);
}

export type PayoffOutlook =
  | { kind: "debt-free" }
  | { kind: "never" }
  /** Live, from synced balances. `monthsAhead` is how much sooner than the plan (negative: later); null when the plan itself never pays off. */
  | { kind: "projected"; month: string; monthsAhead: number | null }
  /** No card has synced yet: the plan's own date, null when the plan never pays off. */
  | { kind: "planned"; month: string | null };

/**
 * When the debt will be gone. Once every debt still owing has a synced balance this is the live
 * projection from today's balances, compared with the plan's debt-free month. Until then the
 * live projection restarts each unsynced debt from its plan starting balance in today's month —
 * "behind" by however long the plan has run, which says nothing true — so the plan's own date
 * stands in.
 */
export function payoffOutlook({ planned, progress }: Pick<DebtResponse, "planned" | "progress">): PayoffOutlook {
  if (progress.debts.every((d) => d.paidOff)) return { kind: "debt-free" };
  if (progress.debts.some((d) => d.balanceSource === "plan" && !d.paidOff)) return { kind: "planned", month: planned.debtFreeMonth };
  const live = progress.projection;
  if (live.neverPaysOff) return { kind: "never" };
  if (live.debtFreeMonth === null) return { kind: "debt-free" };
  return { kind: "projected", month: live.debtFreeMonth, monthsAhead: planned.debtFreeMonth === null ? null : monthsBetween(live.debtFreeMonth, planned.debtFreeMonth) };
}

/** "2 months ahead of plan", "1 month behind plan", "On schedule". */
export function aheadLabel(monthsAhead: number): string {
  if (monthsAhead === 0) return "On schedule";
  const n = Math.abs(monthsAhead);
  return `${n} month${n === 1 ? "" : "s"} ${monthsAhead > 0 ? "ahead of" : "behind"} plan`;
}

/** A whole percent, rounded down so nothing reads 100% before it is. */
export function percentLabel(percent: number): string {
  return `${Math.floor(Math.min(100, Math.max(0, percent)))}%`;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
