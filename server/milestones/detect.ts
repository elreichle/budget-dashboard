import type { Account } from "../db/accounts.js";
import type { Transaction } from "../db/transactions.js";
import type { DebtProgress } from "../debt/engine.js";
import type { GoalProgress } from "../goals/progress.js";
import { monthOf, nextMonthStart } from "../months/month.js";
import type { BucketSummary, MonthSummary, SavingsSummary } from "../months/summary.js";

/**
 * Milestone detection: a pure function over the settled months' summaries and the live debt and
 * savings goal progress — no clock, no DB. It reports every milestone that holds right now;
 * recording each one once (keyed on kind + key) is the caller's job, so re-running it is harmless.
 *
 * Balance milestones need a synced balance: a debt still read from the plan, or a goal with no
 * linked snapshot, never fires. A bucket or goal the plan sets to zero never fires either, so a
 * retired bucket does not celebrate every month. A month is only judged once it has settled
 * (`isSettled`), since a recorded milestone is never taken back.
 */

export const MILESTONE_KINDS = ["debt-paid", "debt-halfway", "month-under-plan", "buffer-target-met", "savings-month-met"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export type MilestoneSubject = "bucket" | "goal" | "debt";

/** What each kind is about: the plan list its key's subject id points into. */
export const SUBJECT_OF: Record<MilestoneKind, MilestoneSubject> = {
  "debt-paid": "debt",
  "debt-halfway": "debt",
  "month-under-plan": "bucket",
  "buffer-target-met": "goal",
  "savings-month-met": "goal",
};

const MONTHLY: ReadonlySet<MilestoneKind> = new Set<MilestoneKind>(["month-under-plan", "savings-month-met"]);

export interface DetectedMilestone {
  kind: MilestoneKind;
  /** The subject id, followed by `:YYYY-MM` for a monthly kind. Stable, so a milestone fires once. */
  key: string;
}

export interface DetectInput {
  /** Summaries of settled months (see `isSettled`), any order; an open month is ignored. */
  settledMonths: readonly MonthSummary[];
  debts: readonly DebtProgress[];
  goals: readonly GoalProgress[];
}

export function isMilestoneKind(kind: string): kind is MilestoneKind {
  return (MILESTONE_KINDS as readonly string[]).includes(kind);
}

/** A bucket closed its month under plan: posted spending at or below a non-zero plan. */
export function bucketUnderPlan(bucket: Pick<BucketSummary, "planned" | "posted">): boolean {
  return bucket.planned > 0 && bucket.posted <= bucket.planned;
}

/** A goal's month was met: contributions reached a non-zero planned monthly. */
export function goalMonthMet(goal: Pick<SavingsSummary, "planned" | "contributed">): boolean {
  return goal.planned > 0 && goal.contributed >= goal.planned;
}

export function detectMilestones({ settledMonths, debts, goals }: DetectInput): DetectedMilestone[] {
  const found: DetectedMilestone[] = [];
  for (const debt of debts) {
    if (debt.balanceSource !== "snapshot") continue;
    if (debt.startingBalance > 0 && debt.currentBalance <= debt.startingBalance / 2) found.push({ kind: "debt-halfway", key: debt.id });
    if (debt.paidOff) found.push({ kind: "debt-paid", key: debt.id });
  }
  for (const goal of goals) {
    if (goal.balanceSource !== "snapshot" || goal.target === null || goal.target.amount <= 0) continue;
    if (goal.balance >= goal.target.amount) found.push({ kind: "buffer-target-met", key: goal.id });
  }
  for (const month of settledMonths) {
    if (!month.closed) continue;
    for (const bucket of month.buckets) if (bucketUnderPlan(bucket)) found.push({ kind: "month-under-plan", key: `${bucket.id}:${month.month}` });
    for (const goal of month.savings) if (goalMonthMet(goal)) found.push({ kind: "savings-month-met", key: `${goal.id}:${month.month}` });
  }
  return found;
}

/** Splits a key back into its subject id and month (null for a balance kind). Ids may contain `:`; the month is always last. */
export function parseKey(kind: MilestoneKind, key: string): { subjectId: string; month: string | null } {
  if (!MONTHLY.has(kind)) return { subjectId: key, month: null };
  const at = key.lastIndexOf(":");
  return { subjectId: key.slice(0, at), month: key.slice(at + 1) };
}

/** Days into the next month before a closed month is judged: late-posting charges, the next sync and the UTC day boundary come first. */
export const SETTLE_DAYS = 3;

export interface SettleInput {
  summary: MonthSummary;
  /** Any months; filtered here. */
  transactions: readonly Pick<Transaction, "accountId" | "date" | "pending">[];
  accounts: readonly Pick<Account, "id" | "role">[];
  /** `YYYY-MM-DD`. */
  today: string;
}

/**
 * Whether a closed month's numbers are final enough to record a milestone for: `SETTLE_DAYS`
 * into the next month, nothing in it still pending or waiting in the review inbox, and every
 * account with activity in it given a role (until then its spending counts nowhere, so every
 * bucket would look under plan). An ignored account never holds a month open.
 */
export function isSettled({ summary, transactions, accounts, today }: SettleInput): boolean {
  const next = monthOf(nextMonthStart(summary.month));
  const current = monthOf(today);
  if (current < next || (current === next && Number(today.slice(8, 10)) <= SETTLE_DAYS)) return false;
  if (summary.uncategorizedCount > 0) return false;
  const roles = new Map(accounts.map((a) => [a.id, a.role]));
  return transactions.every((t) => {
    if (monthOf(t.date) !== summary.month) return true;
    const role = roles.get(t.accountId);
    return role === "ignore" || (role !== null && role !== undefined && !t.pending);
  });
}
