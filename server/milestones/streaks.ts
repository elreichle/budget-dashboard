import { monthOf, nextMonthStart } from "../months/month.js";
import type { MonthSummary } from "../months/summary.js";
import type { Plan } from "../plan/schema.js";
import { bucketUnderPlan, goalMonthMet } from "./detect.js";

/**
 * Streaks: runs of consecutive closed months in which a bucket stayed under plan or a savings
 * goal was met (the same tests the monthly milestones use). A pure function over the plan and
 * the closed months' summaries.
 */

export interface Streak {
  id: string;
  name: string;
  /** Consecutive months ending with the latest closed month; 0 when that month missed. */
  current: number;
  /** Longest run in the range. */
  best: number;
}

export interface Streaks {
  /** The latest closed month counted; null before there is one. */
  through: string | null;
  buckets: Streak[];
  goals: Streak[];
}

export interface StreaksInput {
  plan: Plan;
  /** One per month of `closedMonthRange`, any order. */
  closedMonths: readonly MonthSummary[];
}

/**
 * The closed months that milestones and streaks count: from `planStartMonth` or the first fully
 * covered month of history, whichever is later, through the month before `today`. History whose
 * oldest transaction is dated after the 1st (a bank's rolling window, an export from mid-month)
 * leaves that month partial, so it is skipped. None before the first transaction, so an empty
 * database never reads as months under plan.
 */
export function closedMonthRange(planStartMonth: string, oldestDate: string | undefined, today: string): string[] {
  if (oldestDate === undefined) return [];
  const firstFull = oldestDate.endsWith("-01") ? monthOf(oldestDate) : monthOf(nextMonthStart(monthOf(oldestDate)));
  const end = monthOf(today);
  const months: string[] = [];
  for (let month = firstFull > planStartMonth ? firstFull : planStartMonth; month < end; month = monthOf(nextMonthStart(month))) {
    months.push(month);
  }
  return months;
}

export function computeStreaks({ plan, closedMonths }: StreaksInput): Streaks {
  const months = [...closedMonths].sort((a, b) => a.month.localeCompare(b.month));
  return {
    through: months[months.length - 1]?.month ?? null,
    buckets: plan.buckets.map((b) =>
      streakOf(b.id, b.name, months.map((m) => { const s = m.buckets.find((x) => x.id === b.id); return s !== undefined && bucketUnderPlan(s); })),
    ),
    goals: plan.savingsGoals.map((g) =>
      streakOf(g.id, g.name, months.map((m) => { const s = m.savings.find((x) => x.id === g.id); return s !== undefined && goalMonthMet(s); })),
    ),
  };
}

function streakOf(id: string, name: string, hits: boolean[]): Streak {
  let current = 0;
  let best = 0;
  for (const hit of hits) {
    current = hit ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { id, name, current, best };
}
