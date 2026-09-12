import { roundCents as cents } from "../money.js";
import { splitAcrossGoals } from "../months/summary.js";
import type { Plan, SavingsGoal } from "../plan/schema.js";

/**
 * Savings goal progress: a pure function over the plan, the latest savings balances and the
 * date — no clock, no DB. A goal's balance is its share of every savings account linked to it
 * (an account linked to several goals is split in proportion to their planned monthly amounts,
 * the way deposits are in the month summary). A goal with bills (`items`) is measured against
 * the soonest bill still to come; a goal with a `targetBalance` against that target; a goal can
 * have both. Dollars are rounded to cents on the way out.
 */

type SavingsItem = SavingsGoal["items"][number];

/** The latest balance reading of one savings account, with the goals it funds. */
export interface SavingsSnapshot {
  goalIds: readonly string[];
  balance: number;
  /** ISO timestamp of the reading. */
  at: string;
}

export interface NextBill {
  /** Every item falling due on `date`, in plan order. */
  names: string[];
  /** Their `perBill` amounts, summed. */
  amount: number;
  /** `YYYY-MM-DD`, on or after today. */
  date: string;
  /** Share of `amount` the balance covers, 0–100 with one decimal. */
  percent: number;
}

export interface GoalTarget {
  amount: number;
  /** Share of the target the balance has reached, 0–100 with one decimal. */
  percent: number;
}

export type GoalBalanceSource = "snapshot" | "none";

export interface GoalProgress {
  id: string;
  name: string;
  /** Zero until a linked savings account has synced (`balanceSource: "none"`). */
  balance: number;
  balanceSource: GoalBalanceSource;
  /** The newest linked reading's timestamp. */
  balanceAsOf: string | null;
  /** Null for a goal without items. */
  nextBill: NextBill | null;
  /** Null when the plan sets no `targetBalance`. */
  target: GoalTarget | null;
}

export interface GoalsProgress {
  /** `YYYY-MM-DD` the bills were rolled forward to. */
  today: string;
  goals: GoalProgress[];
}

export interface GoalProgressInput {
  plan: Plan;
  /** One per savings account linked to at least one goal. */
  snapshots: readonly SavingsSnapshot[];
  /** `YYYY-MM-DD`. */
  today: string;
}

export function goalProgress({ plan, snapshots, today }: GoalProgressInput): GoalsProgress {
  const balances = new Map<string, number>();
  const asOf = new Map<string, string>();
  for (const s of snapshots) {
    for (const [goalId, share] of splitAcrossGoals(s.balance, s.goalIds, plan)) {
      balances.set(goalId, (balances.get(goalId) ?? 0) + share);
      const seen = asOf.get(goalId);
      if (seen === undefined || s.at > seen) asOf.set(goalId, s.at);
    }
  }

  const goals = plan.savingsGoals.map((goal): GoalProgress => {
    const balance = balances.get(goal.id) ?? 0;
    const bill = soonestBill(goal.items, today);
    return {
      id: goal.id,
      name: goal.name,
      balance: cents(balance),
      balanceSource: asOf.has(goal.id) ? "snapshot" : "none",
      balanceAsOf: asOf.get(goal.id) ?? null,
      nextBill: bill && { ...bill, amount: cents(bill.amount), percent: percentOf(balance, bill.amount) },
      target: goal.targetBalance === null ? null : { amount: cents(goal.targetBalance), percent: percentOf(balance, goal.targetBalance) },
    };
  });
  return { today, goals };
}

/**
 * The item's first due date on or after `today`: `nextDue` moved forward by whole billing
 * periods of `12 ÷ timesPerYear` months (rounded, at least one). The day of the month is kept,
 * clamped in shorter months, and always counted from `nextDue` so a clamp never drifts.
 */
export function nextDueDate(item: Pick<SavingsItem, "nextDue" | "timesPerYear">, today: string): string {
  const step = Math.max(1, Math.round(12 / item.timesPerYear));
  const [year, month, day] = item.nextDue.split("-").map(Number) as [number, number, number];
  const [todayYear, todayMonth] = today.split("-").map(Number) as [number, number];
  const monthsBehind = (todayYear - year) * 12 + (todayMonth - month);
  // Start one period short of today's month so the loop runs at most twice.
  let periods = Math.max(0, Math.floor(monthsBehind / step) - 1);
  let date = addMonths(year, month, day, periods * step);
  while (date < today) {
    periods += 1;
    date = addMonths(year, month, day, periods * step);
  }
  return date;
}

function soonestBill(items: readonly SavingsItem[], today: string): Omit<NextBill, "percent"> | null {
  let soonest: Omit<NextBill, "percent"> | null = null;
  for (const item of items) {
    const date = nextDueDate(item, today);
    if (soonest === null || date < soonest.date) soonest = { names: [item.name], amount: item.perBill, date };
    else if (date === soonest.date) {
      soonest.names.push(item.name);
      soonest.amount += item.perBill;
    }
  }
  return soonest;
}

function addMonths(year: number, month: number, day: number, n: number): string {
  const index = year * 12 + (month - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** 0–100 with one decimal; 100 only once the balance covers the amount, so rounding never reports a goal met early. */
function percentOf(balance: number, amount: number): number {
  const have = cents(balance);
  const need = cents(amount);
  if (need <= 0 || have >= need) return 100;
  return Math.min(99.9, Math.round(Math.max(0, (have / need) * 100) * 10) / 10);
}
