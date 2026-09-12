import { localDate } from "../clock.js";
import { roundCents as cents } from "../money.js";
import { monthOf, nextMonthStart } from "../months/month.js";
import type { Debt, PayoffStrategy, Plan } from "../plan/schema.js";
import type { DebtInterest, DebtPayment } from "../rules/categorize.js";

export type { DebtInterest, DebtPayment };

/**
 * Debt payoff engine: pure functions over the plan's debts, with no clock and no DB.
 *
 * A month is: interest on every segment (`balance × apr ÷ 12`), then the payment, applied to the
 * debt's highest-APR segment first. No new charges are assumed. Planned payments follow the
 * payoff strategy: debts are paid in `order` (debts the order does not list come last, in plan
 * order); with `rollover`, the month's total stays at `totalMonthly` (or the sum of the open
 * debts' planned payments if that is more) and whatever a debt cannot absorb flows to the next
 * open debt, so a paid-off debt's payment rolls forward. Baseline payments are each debt's
 * `baselinePayment` with no rollover: what would have happened without the plan.
 *
 * A debt's segment balances are dated its `asOf`, so a debt added after `startMonth` sits idle
 * (no interest, no payment) until the month after `asOf`. A payment below the month's interest
 * never terminates, so a projection stops after `MAX_MONTHS` and reports `neverPaysOff`.
 * Dollars are rounded to cents on the way out.
 */

export const MAX_MONTHS = 600;

export type PaymentMode = "planned" | "baseline";

export interface ProjectionInput {
  debts: readonly Debt[];
  strategy: PayoffStrategy;
  /** `YYYY-MM` of the first payment; the plan's segment balances are the balances before it. */
  startMonth: string;
  /** Defaults to `planned`. */
  payments?: PaymentMode;
  /**
   * Starting balance per debt id (what is owed now), overriding the plan segments' sum. A
   * reading does not say which segment shrank, so the plan's segments are paid down to it
   * highest-APR first, the way the engine itself would have; an excess (new charges) lands on
   * the highest-APR segment. An overridden debt starts in `startMonth` regardless of `asOf`.
   */
  balances?: Readonly<Record<string, number>>;
  /** Per debt id, what was already paid in `startMonth`; deducted from that month's payment. */
  alreadyPaid?: Readonly<Record<string, number>>;
}

export interface DebtMonth {
  id: string;
  interest: number;
  payment: number;
  /** Balance after this month's payment. */
  balance: number;
}

export interface ProjectionMonth {
  month: string;
  interest: number;
  payment: number;
  balance: number;
  debts: DebtMonth[];
}

export interface DebtProjection {
  id: string;
  name: string;
  startingBalance: number;
  /** Month the balance reaches zero; null when it never does or was zero to begin with. */
  paidOffMonth: string | null;
  totalInterest: number;
  totalPaid: number;
}

export interface Projection {
  startMonth: string;
  payments: PaymentMode;
  /** One row per month from `startMonth` until debt-free, or `MAX_MONTHS` rows when never. */
  months: ProjectionMonth[];
  debts: DebtProjection[];
  /** The last month with a balance; null when nothing was owed or it never pays off. */
  debtFreeMonth: string | null;
  neverPaysOff: boolean;
  totalInterest: number;
  totalPaid: number;
}

interface SegmentState {
  balance: number;
  apr: number;
}

interface DebtState {
  debt: Debt;
  /** Highest APR first. */
  segments: SegmentState[];
  /** First month that accrues interest and takes a payment. */
  activeFrom: string;
  startingBalance: number;
  interest: number;
  paid: number;
  paidOffMonth: string | null;
}

export function project(input: ProjectionInput): Projection {
  const mode = input.payments ?? "planned";
  const rollover = mode === "planned" && input.strategy.rollover;
  const paymentOf = (d: Debt) => (mode === "planned" ? d.plannedPayment : d.baselinePayment);
  const states = input.debts.map((debt) => startState(debt, input.startMonth, input.balances?.[debt.id]));
  const ordered = payoffOrder(states, input.strategy);
  const months: ProjectionMonth[] = [];
  let month = input.startMonth;

  while (months.length < MAX_MONTHS && states.some(owes)) {
    const active = (s: DebtState) => s.activeFrom <= month;
    const rows: DebtMonth[] = [];
    for (const s of states) rows.push({ id: s.debt.id, interest: active(s) ? accrue(s) : 0, payment: 0, balance: 0 });

    const open = ordered.filter((s) => owes(s) && active(s));
    // With rollover the month's total is the strategy's budget; the part not spoken for by the
    // open debts' own payments (freed by paid-off debts, or extra in the budget) goes first in line.
    let carry = rollover ? Math.max(0, input.strategy.totalMonthly - sum(open.map((s) => paymentOf(s.debt)))) : 0;
    const alreadyPaid = (s: DebtState) => (month === input.startMonth ? (input.alreadyPaid?.[s.debt.id] ?? 0) : 0);
    for (const s of open) {
      const available = Math.max(0, paymentOf(s.debt) - alreadyPaid(s)) + carry;
      const paid = pay(s, available);
      carry = rollover ? available - paid : 0;
      s.paid += paid;
      if (!owes(s)) s.paidOffMonth = month;
      const row = rows.find((r) => r.id === s.debt.id);
      if (row) row.payment = paid;
    }

    for (const s of states) {
      const row = rows.find((r) => r.id === s.debt.id);
      if (row) row.balance = balanceOf(s);
    }
    months.push({
      month,
      interest: cents(sum(rows.map((r) => r.interest))),
      payment: cents(sum(rows.map((r) => r.payment))),
      balance: cents(sum(rows.map((r) => r.balance))),
      debts: rows.map((r) => ({ ...r, interest: cents(r.interest), payment: cents(r.payment), balance: cents(r.balance) })),
    });
    month = monthOf(nextMonthStart(month));
  }

  const neverPaysOff = states.some(owes);
  return {
    startMonth: input.startMonth,
    payments: mode,
    months,
    debts: states.map((s) => ({
      id: s.debt.id,
      name: s.debt.name,
      startingBalance: cents(s.startingBalance),
      paidOffMonth: s.paidOffMonth,
      totalInterest: cents(s.interest),
      totalPaid: cents(s.paid),
    })),
    debtFreeMonth: neverPaysOff || months.length === 0 ? null : months[months.length - 1]!.month,
    neverPaysOff,
    totalInterest: cents(sum(states.map((s) => s.interest))),
    totalPaid: cents(sum(states.map((s) => s.paid))),
  };
}

export interface Comparison {
  planned: Projection;
  baseline: Projection;
  /** Months sooner the plan is debt-free than the baseline; null when either never pays off. */
  monthsSaved: number | null;
  /** Baseline interest minus planned interest; a lower bound when the baseline never pays off. */
  interestSaved: number;
}

/** The plan's payoff against the baseline payments, both from `planStartMonth` and the plan's segment balances. */
export function compare(plan: Plan): Comparison {
  const base = { debts: plan.debts, strategy: plan.payoffStrategy, startMonth: plan.planStartMonth };
  const planned = project({ ...base, payments: "planned" });
  const baseline = project({ ...base, payments: "baseline" });
  return {
    planned,
    baseline,
    monthsSaved: planned.neverPaysOff || baseline.neverPaysOff ? null : baseline.months.length - planned.months.length,
    interestSaved: cents(baseline.totalInterest - planned.totalInterest),
  };
}

/** The latest balance reading of one account linked to a plan debt, as a positive amount owed. */
export interface DebtSnapshot {
  debtId: string;
  owed: number;
  /** ISO timestamp of the reading. */
  at: string;
}

export interface ProgressInput {
  plan: Plan;
  /** One per linked account; a debt with several accounts owes their sum. */
  snapshots: readonly DebtSnapshot[];
  payments: readonly DebtPayment[];
  /** Posted `_interest` rows on linked card accounts; a debt with any dated after its `asOf` takes them as the interest actually charged. */
  interest?: readonly DebtInterest[];
  /** `YYYY-MM-DD`; the live projection starts in this month. */
  today: string;
  /** The plan's baseline projection, when the caller already has it (see `compare`). */
  baseline?: Projection;
}

export type BalanceSource = "snapshot" | "plan";
export type InterestSource = "rows" | "estimate";

export interface DebtProgress {
  id: string;
  name: string;
  startingBalance: number;
  /** Sum of the linked accounts' latest snapshots, or the starting balance when none has been synced (`balanceSource: "plan"`). */
  currentBalance: number;
  balanceSource: BalanceSource;
  /** The newest reading's timestamp. */
  balanceAsOf: string | null;
  /** Posted payments dated after the debt's `asOf` (earlier ones are already in the starting balance). */
  paidSoFar: number;
  /** Share of the starting balance gone, 0–100 with one decimal. */
  percent: number;
  /**
   * Interest the baseline schedule would have charged in the months fully elapsed before the
   * snapshot minus the interest actually charged (the rows dated in those same months, or the
   * estimate as of the snapshot), floored at zero. Zero without a snapshot.
   */
  interestSavedSoFar: number;
  /**
   * How the interest actually charged is known: `rows` sums the debt's `_interest` rows dated
   * after its `asOf`; `estimate`, when it has none, infers it as `current − starting + payments`,
   * which new purchases on the card inflate.
   */
  interestSource: InterestSource;
  paidOff: boolean;
}

export interface Progress {
  /** `YYYY-MM` of `today`. */
  month: string;
  debts: DebtProgress[];
  totals: Pick<DebtProgress, "startingBalance" | "currentBalance" | "paidSoFar" | "percent" | "interestSavedSoFar">;
  /** Planned payments from the current balances, starting this month net of what this month already paid: the live debt-free date. */
  projection: Projection;
}

/** Where each debt stands now against its starting balance and the baseline schedule. */
export function progress({ plan, snapshots, payments, interest = [], today, baseline: given }: ProgressInput): Progress {
  const month = monthOf(today);
  const baseline = given ?? project({ debts: plan.debts, strategy: plan.payoffStrategy, startMonth: plan.planStartMonth, payments: "baseline" });

  const debts = plan.debts.map((debt): DebtProgress => {
    const startingBalance = sum(debt.segments.map((seg) => seg.balance));
    const readings = snapshots.filter((s) => s.debtId === debt.id);
    const snapshot = readings.length > 0 ? { owed: sum(readings.map((s) => s.owed)), at: readings.map((s) => s.at).sort().pop()! } : undefined;
    const currentBalance = snapshot ? snapshot.owed : startingBalance;
    const paid = payments.filter((p) => p.debtId === debt.id && p.date > debt.asOf);
    const paidSoFar = sum(paid.map((p) => p.amount));
    const charges = interest.filter((c) => c.debtId === debt.id && c.date > debt.asOf);
    const interestSource: InterestSource = charges.length > 0 ? "rows" : "estimate";
    let interestSavedSoFar = 0;
    if (snapshot) {
      const snapshotDate = localDate(snapshot.at);
      const elapsed = monthOf(snapshotDate);
      const baselineInterest = sum(baseline.months.filter((m) => m.month < elapsed).map((m) => m.debts.find((d) => d.id === debt.id)?.interest ?? 0));
      const charged =
        interestSource === "rows"
          ? sum(charges.filter((c) => monthOf(c.date) < elapsed).map((c) => c.amount))
          : currentBalance - startingBalance + sum(paid.filter((p) => p.date <= snapshotDate).map((p) => p.amount));
      const actualInterest = Math.max(0, charged);
      interestSavedSoFar = Math.max(0, baselineInterest - actualInterest);
    }
    return {
      id: debt.id,
      name: debt.name,
      startingBalance: cents(startingBalance),
      currentBalance: cents(currentBalance),
      balanceSource: snapshot ? "snapshot" : "plan",
      balanceAsOf: snapshot?.at ?? null,
      paidSoFar: cents(paidSoFar),
      percent: percentPaid(startingBalance, currentBalance),
      interestSavedSoFar: cents(interestSavedSoFar),
      interestSource,
      paidOff: cents(currentBalance) <= 0,
    };
  });

  const startingBalance = sum(debts.map((d) => d.startingBalance));
  const currentBalance = sum(debts.map((d) => d.currentBalance));
  return {
    month,
    debts,
    totals: {
      startingBalance: cents(startingBalance),
      currentBalance: cents(currentBalance),
      paidSoFar: cents(sum(debts.map((d) => d.paidSoFar))),
      percent: percentPaid(startingBalance, currentBalance),
      interestSavedSoFar: cents(sum(debts.map((d) => d.interestSavedSoFar))),
    },
    projection: project({
      debts: plan.debts,
      strategy: plan.payoffStrategy,
      startMonth: month,
      balances: Object.fromEntries(debts.map((d) => [d.id, d.currentBalance])),
      alreadyPaid: Object.fromEntries(plan.debts.map((d) => [d.id, sum(payments.filter((p) => p.debtId === d.id && monthOf(p.date) === month).map((p) => p.amount))])),
    }),
  };
}

function startState(debt: Debt, startMonth: string, balance: number | undefined): DebtState {
  const segments = debt.segments.map((s): SegmentState => ({ balance: s.balance, apr: s.apr }));
  segments.sort((a, b) => b.apr - a.apr);
  const state: DebtState = { debt, segments, activeFrom: startMonth, startingBalance: balance ?? balanceOfSegments(segments), interest: 0, paid: 0, paidOffMonth: null };
  if (balance === undefined) {
    const afterAsOf = monthOf(nextMonthStart(monthOf(debt.asOf)));
    if (afterAsOf > startMonth) state.activeFrom = afterAsOf;
    return state;
  }
  const planTotal = balanceOfSegments(segments);
  if (balance < planTotal) pay(state, planTotal - balance);
  else if (segments[0]) segments[0].balance += balance - planTotal;
  return state;
}

/** Strategy order first, then any debt it does not list, in plan order. */
function payoffOrder(states: DebtState[], strategy: PayoffStrategy): DebtState[] {
  const byId = new Map(states.map((s) => [s.debt.id, s]));
  const listed = strategy.order.map((id) => byId.get(id)).filter((s): s is DebtState => s !== undefined);
  const rest = states.filter((s) => !strategy.order.includes(s.debt.id));
  return [...listed, ...rest];
}

/** Adds a month of interest to every segment; returns the amount. */
function accrue(s: DebtState): number {
  let interest = 0;
  for (const seg of s.segments) {
    const i = (seg.balance * seg.apr) / 12;
    seg.balance += i;
    interest += i;
  }
  s.interest += interest;
  return interest;
}

/** Pays up to `amount`, highest-APR segment first; returns what was actually applied. */
function pay(s: DebtState, amount: number): number {
  let left = amount;
  for (const seg of s.segments) {
    if (left <= 0) break;
    const applied = Math.min(left, seg.balance);
    seg.balance -= applied;
    left -= applied;
  }
  return amount - left;
}

function balanceOf(s: DebtState): number {
  return balanceOfSegments(s.segments);
}

function balanceOfSegments(segments: SegmentState[]): number {
  return sum(segments.map((seg) => seg.balance));
}

function owes(s: DebtState): boolean {
  return balanceOf(s) > 0;
}

/** 0–100 with one decimal; 100 only once the balance is paid off, so rounding never reports a card cleared early. */
function percentPaid(starting: number, current: number): number {
  const owed = cents(current);
  const start = cents(starting);
  if (owed <= 0) return 100;
  if (start <= 0) return 0;
  return Math.min(99.9, Math.round(Math.max(0, ((start - owed) / start) * 100) * 10) / 10);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
