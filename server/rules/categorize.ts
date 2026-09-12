import { listFilingCandidates, setTransactionBucket, setTransactionDebt, type Account, type Db, type FilingCandidate, type Transaction } from "../db/index.js";
import { matchBucket } from "./match.js";
import { INTEREST_BUCKET, TRANSFER_BUCKET, type Rule } from "./schema.js";

export interface CategorizeCounts {
  /** Transactions whose bucket was set or changed by a rule this pass. */
  filed: number;
  /** Transactions a rule had filed that no rule matches any more; they return to the review inbox. */
  unfiled: number;
  /** Transactions whose debt link was set or cleared. */
  debtLinked: number;
  /** Transactions still without a bucket after the pass. */
  unmatched: number;
}

/**
 * Files every transaction not filed by hand: the first matching rule's bucket, or none. Rules
 * are taken as valid; `loadRules(dataDir, plan)` is what rejects a bucket the plan lacks.
 * Manual filings are never touched.
 *
 * Then, for every transaction (manual ones included), the debt link is derived: a `_transfer`
 * amount paid into a card account linked to a plan debt is a payment toward that debt.
 * Idempotent; rows already in the right state are not rewritten. Call inside `db.transaction(...)`
 * when combined with other writes.
 */
export function categorize(db: Db, rules: readonly Rule[], now: string): CategorizeCounts {
  const counts: CategorizeCounts = { filed: 0, unfiled: 0, debtLinked: 0, unmatched: 0 };

  for (const t of listFilingCandidates(db)) {
    let bucketId = t.bucketId;
    if (t.bucketSource !== "manual") {
      const matched = matchBucket(t.description, rules) ?? null;
      if (matched !== t.bucketId) {
        setTransactionBucket(db, t.id, matched === null ? { bucketId: null, source: "none" } : { bucketId: matched, source: "rule" }, now);
        if (matched === null) counts.unfiled += 1;
        else counts.filed += 1;
      }
      bucketId = matched;
    }
    if (bucketId === null) counts.unmatched += 1;

    const debtId = debtPaidBy({ ...t, bucketId });
    if (debtId !== t.debtId) {
      setTransactionDebt(db, t.id, debtId, now);
      counts.debtLinked += 1;
    }
  }
  return counts;
}

/** A posted transaction that pays down a plan debt (see `debtPaidBy`). */
export interface DebtPayment {
  debtId: string;
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

/**
 * The posted debt payments among `transactions`, derived live from each row and its account
 * rather than the stored `debtId`, so a re-filed row cannot be both a refund and a payment.
 */
export function debtPayments(transactions: readonly Transaction[], accounts: readonly Account[]): DebtPayment[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const payments: DebtPayment[] = [];
  for (const t of transactions) {
    if (t.pending) continue;
    const account = byId.get(t.accountId);
    const debtId = debtPaidBy({ bucketId: t.bucketId, amount: t.amount, accountRole: account?.role ?? null, linkedDebtId: account?.linkedDebtId ?? null });
    if (debtId !== null) payments.push({ debtId, amount: t.amount, date: t.date });
  }
  return payments;
}

/** A posted interest charge on a card account linked to a plan debt, as a positive amount (a reversal is negative). */
export interface DebtInterest {
  debtId: string;
  accountId: number;
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** The posted `_interest` rows among `transactions` that sit on a card account linked to a plan debt. */
export function debtInterest(transactions: readonly Transaction[], accounts: readonly Account[]): DebtInterest[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const charges: DebtInterest[] = [];
  for (const t of transactions) {
    const account = byId.get(t.accountId);
    if (t.pending || t.bucketId !== INTEREST_BUCKET || account?.role !== "card" || account.linkedDebtId === null) continue;
    charges.push({ debtId: account.linkedDebtId, accountId: account.id, amount: -t.amount, date: t.date });
  }
  return charges;
}

/** The plan debt a transaction pays: money into (`amount > 0`) a linked card account, filed as a transfer. */
export function debtPaidBy(t: Pick<FilingCandidate, "bucketId" | "amount" | "accountRole" | "linkedDebtId">): string | null {
  if (t.bucketId !== TRANSFER_BUCKET || t.accountRole !== "card" || t.linkedDebtId === null || t.amount <= 0) return null;
  return t.linkedDebtId;
}
