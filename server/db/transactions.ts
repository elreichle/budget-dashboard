import { listAccounts, type AccountRole } from "./accounts.js";
import type { Db } from "./index.js";
import { nextMonthStart } from "../months/month.js";
import { RESERVED_BUCKET_IDS, UNCATEGORIZED_BUCKET } from "../rules/schema.js";

/** Who filed the transaction into its bucket. `none` means unfiled (bucket_id is null). */
export type BucketSource = "rule" | "manual" | "none";

export interface Transaction {
  id: number;
  accountId: number;
  connector: string;
  externalId: string;
  /** Posted (or, while pending, authorization) date, `YYYY-MM-DD`. */
  date: string;
  pending: boolean;
  /** Dollars, signed: spending is negative, income and refunds positive. */
  amount: number;
  description: string;
  bucketId: string | null;
  bucketSource: BucketSource;
  /** Plan debt this transaction pays down: set by categorization for `_transfer` amounts on a linked card account. */
  debtId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a connector reports for one transaction. Bucketing is separate. */
export type TransactionInput = Pick<Transaction, "accountId" | "connector" | "externalId" | "date" | "pending" | "amount" | "description">;

export interface TransactionFilter {
  /** Calendar month `YYYY-MM`. */
  month?: string;
  accountId?: number;
  pending?: boolean;
  bucketSource?: BucketSource;
}

interface TransactionRow {
  id: number;
  account_id: number;
  connector: string;
  external_id: string;
  date: string;
  pending: 0 | 1;
  amount: number;
  description: string;
  bucket_id: string | null;
  bucket_source: BucketSource;
  debt_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, account_id, connector, external_id, date, pending, amount, description, bucket_id, bucket_source, debt_id, created_at, updated_at";

function fromRow(r: TransactionRow): Transaction {
  return {
    id: r.id,
    accountId: r.account_id,
    connector: r.connector,
    externalId: r.external_id,
    date: r.date,
    pending: r.pending === 1,
    amount: r.amount,
    description: r.description,
    bucketId: r.bucket_id,
    bucketSource: r.bucket_source,
    debtId: r.debt_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Inserts the transaction or, when `connector + externalId` already exists, updates what the
 * connector reports (date, amount, description) in place. Pending only ever moves to posted, so
 * a promoted row keeps its id and bucket and a later pending re-report cannot demote it. The
 * account is fixed at first sight. Callers looping over a sync batch should wrap the loop in
 * `db.transaction(...)`.
 */
export function upsertTransaction(db: Db, input: TransactionInput, now: string): { transaction: Transaction; inserted: boolean } {
  return upsertTx(db, input, now);
}

const upsertTx = (db: Db, input: TransactionInput, now: string) =>
  db.transaction((): { transaction: Transaction; inserted: boolean } => {
    const existing = db
      .prepare<[string, string], { id: number }>("select id from transactions where connector = ? and external_id = ?")
      .get(input.connector, input.externalId);
    const row = db
      .prepare<[number, string, string, string, number, number, string, string, string], TransactionRow>(
        `insert into transactions (account_id, connector, external_id, date, pending, amount, description, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (connector, external_id) do update set
           date = excluded.date, pending = min(transactions.pending, excluded.pending),
           amount = excluded.amount, description = excluded.description, updated_at = excluded.updated_at
         returning ${COLUMNS}`,
      )
      .get(input.accountId, input.connector, input.externalId, input.date, input.pending ? 1 : 0, input.amount, input.description, now, now);
    if (!row) throw new Error("upsertTransaction returned no row");
    return { transaction: fromRow(row), inserted: existing === undefined };
  })();

export function getTransaction(db: Db, id: number): Transaction | undefined {
  const row = db.prepare<[number], TransactionRow>(`select ${COLUMNS} from transactions where id = ?`).get(id);
  return row && fromRow(row);
}

/** Newest first (date, then id). Every filter field is optional and they combine with AND. */
export function listTransactions(db: Db, filter: TransactionFilter = {}): Transaction[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.month !== undefined) {
    where.push("date >= ? and date < ?");
    params.push(`${filter.month}-01`, nextMonthStart(filter.month));
  }
  if (filter.accountId !== undefined) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.pending !== undefined) {
    where.push("pending = ?");
    params.push(filter.pending ? 1 : 0);
  }
  if (filter.bucketSource !== undefined) {
    where.push("bucket_source = ?");
    params.push(filter.bucketSource);
  }
  const sql = `select ${COLUMNS} from transactions${where.length ? ` where ${where.join(" and ")}` : ""} order by date desc, id desc`;
  return db.prepare<(string | number)[], TransactionRow>(sql).all(...params).map(fromRow);
}

const RESERVED: ReadonlySet<string> = new Set(RESERVED_BUCKET_IDS);

/**
 * The one needs-review rule, behind both the month summary's count and the review inbox: a row is
 * unfiled, filed `_uncategorized`, or filed into a bucket the plan does not have (reserved ids
 * aside), and its account is not ignored. `planBucketIds` null means the plan did not load, so a
 * filed bucket cannot be judged and only unfiled and `_uncategorized` rows count.
 */
export function needsReview(bucketId: string | null, accountRole: AccountRole | null | undefined, planBucketIds: ReadonlySet<string> | null): boolean {
  if (accountRole === "ignore") return false;
  if (bucketId === null || bucketId === UNCATEGORIZED_BUCKET) return true;
  return planBucketIds !== null && !planBucketIds.has(bucketId) && !RESERVED.has(bucketId);
}

/** Every transaction, posted or pending, in any month, that `needsReview`; newest first. */
export function listNeedingReview(db: Db, planBucketIds: ReadonlySet<string> | null): Transaction[] {
  const roles = new Map(listAccounts(db).map((a) => [a.id, a.role]));
  return listTransactions(db).filter((t) => needsReview(t.bucketId, roles.get(t.accountId), planBucketIds));
}

/** Files (or unfiles) a transaction. `source: "none"` requires `bucketId: null`. */
export function setTransactionBucket(
  db: Db,
  id: number,
  bucket: { bucketId: string; source: "rule" | "manual" } | { bucketId: null; source: "none" },
  now: string,
): void {
  const { changes } = db
    .prepare<[string | null, BucketSource, string, number]>("update transactions set bucket_id = ?, bucket_source = ?, updated_at = ? where id = ?")
    .run(bucket.bucketId, bucket.source, now, id);
  if (changes === 0) throw new Error(`No transaction ${id}`);
}

/** Records (or clears) which plan debt the transaction pays; see `Transaction.debtId`. */
export function setTransactionDebt(db: Db, id: number, debtId: string | null, now: string): void {
  const { changes } = db.prepare<[string | null, string, number]>("update transactions set debt_id = ?, updated_at = ? where id = ?").run(debtId, now, id);
  if (changes === 0) throw new Error(`No transaction ${id}`);
}

/** What categorization needs per transaction: its filing plus the account's role and debt link. */
export interface FilingCandidate {
  id: number;
  amount: number;
  description: string;
  bucketId: string | null;
  bucketSource: BucketSource;
  debtId: string | null;
  accountRole: AccountRole | null;
  linkedDebtId: string | null;
}

/** Every transaction joined with its account, oldest first. */
export function listFilingCandidates(db: Db): FilingCandidate[] {
  return db
    .prepare<[], { id: number; amount: number; description: string; bucket_id: string | null; bucket_source: BucketSource; debt_id: string | null; role: AccountRole | null; linked_debt_id: string | null }>(
      `select t.id, t.amount, t.description, t.bucket_id, t.bucket_source, t.debt_id, a.role, a.linked_debt_id
       from transactions t join accounts a on a.id = t.account_id
       order by t.id`,
    )
    .all()
    .map((r) => ({
      id: r.id,
      amount: r.amount,
      description: r.description,
      bucketId: r.bucket_id,
      bucketSource: r.bucket_source,
      debtId: r.debt_id,
      accountRole: r.role,
      linkedDebtId: r.linked_debt_id,
    }));
}

/** The earliest date among an account's transactions (posted or pending) from one connector; undefined when it has none. */
export function earliestTransactionDate(db: Db, accountId: number, connector: string): string | undefined {
  const row = db
    .prepare<[number, string], { date: string | null }>("select min(date) as date from transactions where account_id = ? and connector = ?")
    .get(accountId, connector);
  return row?.date ?? undefined;
}

/** Every `YYYY-MM` with at least one transaction (posted or pending), newest first. */
export function listTransactionMonths(db: Db): string[] {
  return db
    .prepare<[], { month: string }>("select distinct substr(date, 1, 7) as month from transactions order by month desc")
    .all()
    .map((r) => r.month);
}
