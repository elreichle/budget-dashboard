import type { Account, AccountRole } from "../db/accounts.js";
import { needsReview, type Transaction } from "../db/transactions.js";
import type { Plan } from "../plan/schema.js";
import { roundCents as cents } from "../money.js";
import { debtPayments } from "../rules/categorize.js";
import { INCOME_BUCKET, TRANSFER_BUCKET } from "../rules/schema.js";
import { daysInMonth as daysIn, monthOf } from "./month.js";

/**
 * The month summary: how one calendar month stands against the plan. A pure function over the
 * plan, the transactions (any months; filtered here), the accounts and the date — no clock, no
 * DB. Dollars are rounded to cents on the way out since this is what the API serves. Plan
 * bucket ids can never be reserved (`_transfer`, `_income`, `_interest`, `_uncategorized`), so those rows
 * never reach a meter.
 *
 * Only posted transactions move totals; pending amounts are reported alongside. Which account a
 * transaction sits on decides what it means, so an account with no role yet contributes nothing
 * until the user assigns one.
 */

export type Pace = "on-pace" | "trending-over" | "over";

export interface BucketSummary {
  id: string;
  name: string;
  group: "fixed" | "living";
  planned: number;
  /** Posted spending, net of refunds filed into the same bucket. */
  posted: number;
  pending: number;
  /** `planned × daysElapsed ÷ daysInMonth` for a living bucket; null for a fixed one, which is billed whole rather than spent through the month. */
  expectedByToday: number | null;
  pace: Pace;
  /** `planned − posted`; negative once over. */
  remaining: number;
}

export interface IncomeSummary {
  planned: number;
  received: number;
  pending: number;
}

export interface SavingsSummary {
  id: string;
  name: string;
  planned: number;
  contributed: number;
}

export interface DebtPaymentSummary {
  id: string;
  name: string;
  planned: number;
  paid: number;
}

export interface MonthSummary {
  month: string;
  daysInMonth: number;
  /** Days of the month up to and including `today`; the whole month once it is past, 0 before it starts. */
  daysElapsed: number;
  /** Every day of the month is behind `today`. */
  closed: boolean;
  buckets: BucketSummary[];
  income: IncomeSummary;
  savings: SavingsSummary[];
  debts: DebtPaymentSummary[];
  /** Transactions this month, posted or pending, that need review (see `needsReview`): what the review inbox lists for this month. */
  uncategorizedCount: number;
  totals: { planned: number; posted: number; pending: number };
}

export interface MonthSummaryInput {
  plan: Plan;
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  /** `YYYY-MM`. */
  month: string;
  /** `YYYY-MM-DD`; decides days elapsed and therefore pace. */
  today: string;
}

/** Posted spend above this share of the prorated plan reads as `trending-over`. */
export const TRENDING_OVER_FACTOR = 1.1;

const SPENDING_ROLES: ReadonlySet<AccountRole> = new Set<AccountRole>(["checking", "card"]);

export function summarizeMonth({ plan, transactions, accounts, month, today }: MonthSummaryInput): MonthSummary {
  const daysInMonth = daysIn(month);
  const daysElapsed = elapsed(month, today, daysInMonth);
  const roles = new Map(accounts.map((a) => [a.id, a]));
  const rows = transactions.filter((t) => monthOf(t.date) === month);

  const buckets = plan.buckets.map((bucket): BucketSummary => {
    let posted = 0;
    let pending = 0;
    for (const t of rows) {
      if (t.bucketId !== bucket.id || !isSpendingAccount(roles.get(t.accountId))) continue;
      if (t.pending) pending -= t.amount;
      else posted -= t.amount;
    }
    const expectedByToday = bucket.group === "fixed" ? null : (bucket.planned * daysElapsed) / daysInMonth;
    return {
      id: bucket.id,
      name: bucket.name,
      group: bucket.group,
      planned: cents(bucket.planned),
      posted: cents(posted),
      pending: cents(pending),
      expectedByToday: expectedByToday === null ? null : cents(expectedByToday),
      pace: paceOf(posted, bucket.planned, expectedByToday),
      remaining: cents(cents(bucket.planned) - cents(posted)),
    };
  });

  const income: IncomeSummary = { planned: cents(plan.income.netMonthly), received: 0, pending: 0 };
  for (const t of rows) {
    if (t.bucketId !== INCOME_BUCKET || t.amount <= 0 || roles.get(t.accountId)?.role !== "checking") continue;
    if (t.pending) income.pending += t.amount;
    else income.received += t.amount;
  }
  income.received = cents(income.received);
  income.pending = cents(income.pending);

  const contributed = new Map(plan.savingsGoals.map((g) => [g.id, 0]));
  for (const t of rows) {
    const account = roles.get(t.accountId);
    if (t.pending || t.bucketId !== TRANSFER_BUCKET || t.amount <= 0 || account?.role !== "savings") continue;
    for (const [goalId, share] of splitAcrossGoals(t.amount, account.linkedGoalIds, plan)) {
      contributed.set(goalId, (contributed.get(goalId) ?? 0) + share);
    }
  }
  const savings = plan.savingsGoals.map((g): SavingsSummary => ({ id: g.id, name: g.name, planned: cents(g.monthly), contributed: cents(contributed.get(g.id) ?? 0) }));

  const paid = new Map(plan.debts.map((d) => [d.id, 0]));
  for (const p of debtPayments(rows, accounts)) {
    if (paid.has(p.debtId)) paid.set(p.debtId, (paid.get(p.debtId) ?? 0) + p.amount);
  }
  const debts = plan.debts.map((d): DebtPaymentSummary => ({ id: d.id, name: d.name, planned: cents(d.plannedPayment), paid: cents(paid.get(d.id) ?? 0) }));

  const bucketIds = new Set(plan.buckets.map((b) => b.id));
  const uncategorizedCount = rows.filter((t) => needsReview(t.bucketId, roles.get(t.accountId)?.role, bucketIds)).length;

  return {
    month,
    daysInMonth,
    daysElapsed,
    closed: monthOf(today) > month,
    buckets,
    income,
    savings,
    debts,
    uncategorizedCount,
    totals: {
      planned: cents(sum(buckets.map((b) => b.planned))),
      posted: cents(sum(buckets.map((b) => b.posted))),
      pending: cents(sum(buckets.map((b) => b.pending))),
    },
  };
}

/**
 * `over` past the plan, `trending-over` past the prorated plan with some slack, else `on-pace`;
 * with no prorated plan (a fixed bucket) only the plan itself counts. Compared in cents, so float
 * noise in a sum never moves a bucket spent exactly to a line.
 */
export function paceOf(posted: number, planned: number, expectedByToday: number | null): Pace {
  const spent = cents(posted);
  if (spent > cents(planned)) return "over";
  if (expectedByToday !== null && spent > cents(cents(expectedByToday) * TRENDING_OVER_FACTOR)) return "trending-over";
  return "on-pace";
}

function elapsed(month: string, today: string, daysInMonth: number): number {
  const current = monthOf(today);
  if (current < month) return 0;
  if (current > month) return daysInMonth;
  return Math.min(daysInMonth, Math.max(1, Number(today.slice(8, 10))));
}

function isSpendingAccount(account: Account | undefined): boolean {
  return account?.role !== null && account?.role !== undefined && SPENDING_ROLES.has(account.role);
}

/**
 * A deposit into a savings account funds every goal the account is linked to, split in
 * proportion to their planned monthly amounts (evenly when those are all zero). Goals the plan
 * no longer has are dropped. Shares are rounded to cents and add up to the deposit exactly.
 */
export function splitAcrossGoals(amount: number, linkedGoalIds: readonly string[], plan: Plan): [string, number][] {
  const goals = plan.savingsGoals.filter((g) => linkedGoalIds.includes(g.id));
  if (goals.length === 0) return [];
  const totalMonthly = sum(goals.map((g) => g.monthly));
  const shares: [string, number][] = goals.map((g) => [g.id, cents(totalMonthly > 0 ? (amount * g.monthly) / totalMonthly : amount / goals.length)]);
  // Rounding each share leaves a few cents over or short; the last goal absorbs them so the shares add up to the deposit.
  const last = shares[shares.length - 1];
  if (last) last[1] = cents(amount - sum(shares.slice(0, -1).map(([, share]) => share)));
  return shares;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
