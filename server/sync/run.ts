import { localDate } from "../clock.js";
import { ConnectorError, type Connector, type ConnectorBatch, type ConnectorErrorCode, type NormalizedTransaction } from "../connectors/types.js";
import {
  finishSyncRun,
  hasSnapshot,
  insertSnapshot,
  latestSuccessfulSyncRun,
  startSyncRun,
  upsertAccount,
  upsertTransaction,
  type Db,
  type SyncRun,
} from "../db/index.js";
import type { CategorizeOutcome, Categorizer } from "../rules/service.js";

/** Days re-fetched before the last good run: pending charges post late and ids never change. */
export const RESYNC_OVERLAP_DAYS = 14;
/** How far back the very first sync reaches, so past months have data from day one. */
export const INITIAL_LOOKBACK_DAYS = 365;

export interface SyncOptions {
  /** `YYYY-MM-DD`; defaults to `defaultSince`. A run given one is recorded as such and never moves the default window. */
  since?: string;
  /** Clock, injectable for tests. Returns an ISO timestamp. */
  now?: () => string;
  /** Runs after the batch is applied, in the same database transaction. Omitted: nothing is filed. */
  categorizer?: Categorizer;
}

export interface SyncFailure {
  /** A connector's own code, or `internal` for anything it did not raise on purpose. */
  code: ConnectorErrorCode | "internal";
  message: string;
}

export interface SyncResult {
  /** The sync_runs row as finished; `run.error` is set when `failure` is. */
  run: SyncRun;
  /** Transactions first seen this run. */
  inserted: number;
  /** Transactions already known and refreshed (including pending→posted promotions). */
  updated: number;
  /** Transactions dropped because their account was not in the reading; each adds a warning. */
  skipped: number;
  /** Balance snapshots appended (identical repeat readings are not re-appended). */
  snapshots: number;
  /** What categorization did after the batch; null when no categorizer was given or the run failed. */
  categorized: CategorizeOutcome | null;
  warnings: string[];
  failure?: SyncFailure;
}

/**
 * One sync: fetch a reading from the connector and fold it into the database.
 *
 * Accounts are upserted (user-assigned role and links untouched), transactions upserted on
 * connector + external id (pending only ever promotes to posted, in place), and each account's
 * balance appended as a snapshot unless that exact reading is already stored. All writes happen
 * in one SQLite transaction, so a failure leaves the data exactly as it was, but the sync_runs
 * row is written regardless so the UI can show what happened. A connector failure (or any error
 * while applying the batch) is returned on the result, not thrown; only a database that cannot
 * even record the run rejects.
 */
export async function runSync(db: Db, connector: Connector, opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const since = opts.since ?? defaultSince(db, connector.id, now());
  const run = startSyncRun(db, connector.id, now(), opts.since);

  try {
    const batch = await connector.fetchTransactions(since);
    const { counts, categorized } = db.transaction(() => {
      const counts = applyBatch(db, connector.id, batch, now());
      return { counts, categorized: opts.categorizer?.run() ?? null };
    })();
    const finished = finishSyncRun(db, run.id, { finishedAt: now(), accountsN: batch.accounts.length, transactionsN: counts.inserted + counts.updated });
    return { run: finished, ...counts, categorized, warnings: [...batch.warnings, ...counts.warnings, ...(categorized?.warnings ?? [])] };
  } catch (err) {
    const failure = toFailure(err);
    const finished = finishSyncRun(db, run.id, { finishedAt: now(), error: failure.message });
    return { run: finished, ...emptyCounts(), categorized: null, failure };
  }
}

/**
 * `RESYNC_OVERLAP_DAYS` before the day the last successful default-window run started, or
 * `INITIAL_LOOKBACK_DAYS` before today when there has never been one. Failed runs do not move
 * the window, so nothing is missed across an outage; nor do runs given an explicit `since`, so a
 * narrow manual fetch cannot hide what the default window has not yet re-read.
 */
export function defaultSince(db: Db, connectorId: string, nowIso: string): string {
  const lastOk = latestSuccessfulSyncRun(db, connectorId, { defaultWindowOnly: true });
  return lastOk ? minusDays(lastOk.startedAt, RESYNC_OVERLAP_DAYS) : minusDays(nowIso, INITIAL_LOOKBACK_DAYS);
}

interface ApplyCounts {
  inserted: number;
  updated: number;
  skipped: number;
  snapshots: number;
  warnings: string[];
}

const emptyCounts = (): ApplyCounts => ({ inserted: 0, updated: 0, skipped: 0, snapshots: 0, warnings: [] });

function applyBatch(db: Db, connectorId: string, batch: ConnectorBatch, now: string): ApplyCounts {
  const counts = emptyCounts();
  const idByExternal = new Map<string, number>();

  for (const a of batch.accounts) {
    const account = upsertAccount(db, { connector: connectorId, externalId: a.externalId, name: a.name, institution: a.institution, type: a.type }, now);
    idByExternal.set(a.externalId, account.id);
    const reading = { accountId: account.id, at: a.balanceAt, balance: a.balance };
    if (hasSnapshot(db, reading)) continue;
    insertSnapshot(db, reading);
    counts.snapshots += 1;
  }

  const applied = applyTransactions(db, connectorId, batch.transactions, (externalId) => idByExternal.get(externalId), now);
  return { ...counts, ...applied, warnings: [...counts.warnings, ...applied.warnings] };
}

export interface ApplyTransactionsCounts {
  inserted: number;
  updated: number;
  /** Transactions whose account `resolveAccount` did not know; each adds a warning. */
  skipped: number;
  warnings: string[];
}

/**
 * The one upsert loop every source goes through (sync readings and CSV imports alike):
 * transactions keyed on connector + external id, pending only ever promoting to posted. Call
 * inside `db.transaction(...)`.
 */
export function applyTransactions(
  db: Db,
  connectorId: string,
  transactions: NormalizedTransaction[],
  resolveAccount: (accountExternalId: string) => number | undefined,
  now: string,
): ApplyTransactionsCounts {
  const counts: ApplyTransactionsCounts = { inserted: 0, updated: 0, skipped: 0, warnings: [] };
  for (const t of transactions) {
    const accountId = resolveAccount(t.accountExternalId);
    if (accountId === undefined) {
      counts.skipped += 1;
      counts.warnings.push(`Skipped transaction ${t.externalId}: account ${t.accountExternalId} was not in this reading`);
      continue;
    }
    const { inserted } = upsertTransaction(
      db,
      { accountId, connector: connectorId, externalId: t.externalId, date: t.date, pending: t.pending, amount: t.amount, description: t.description },
      now,
    );
    if (inserted) counts.inserted += 1;
    else counts.updated += 1;
  }
  return counts;
}

export function toFailure(err: unknown): SyncFailure {
  if (err instanceof ConnectorError) return { code: err.code, message: err.message };
  return { code: "internal", message: err instanceof Error ? err.message : String(err) };
}

/** The calendar day `days` before the local day of `iso` (a date or timestamp), as `YYYY-MM-DD`. */
function minusDays(iso: string, days: number): string {
  // Calendar arithmetic on the local day, done in UTC so no DST shift can move it.
  const day = new Date(`${localDate(iso)}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw new Error(`Invalid date: ${iso}`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}
