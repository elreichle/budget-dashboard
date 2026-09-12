import type { Db } from "./index.js";

export interface SyncRun {
  id: number;
  connector: string;
  startedAt: string;
  /** Null while the run is in progress. */
  finishedAt: string | null;
  accountsN: number;
  transactionsN: number;
  /** Error message when the run failed; null on success or while running. */
  error: string | null;
  /** `YYYY-MM-DD` the run was explicitly asked to fetch from; null when it used the default window. */
  requestedSince: string | null;
}

interface SyncRunRow {
  id: number;
  connector: string;
  started_at: string;
  finished_at: string | null;
  accounts_n: number;
  transactions_n: number;
  error: string | null;
  requested_since: string | null;
}

const COLUMNS = "id, connector, started_at, finished_at, accounts_n, transactions_n, error, requested_since";

function fromRow(r: SyncRunRow): SyncRun {
  return {
    id: r.id,
    connector: r.connector,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    accountsN: r.accounts_n,
    transactionsN: r.transactions_n,
    error: r.error,
    requestedSince: r.requested_since,
  };
}

export function startSyncRun(db: Db, connector: string, startedAt: string, requestedSince?: string): SyncRun {
  const row = db
    .prepare<[string, string, string | null], SyncRunRow>(`insert into sync_runs (connector, started_at, requested_since) values (?, ?, ?) returning ${COLUMNS}`)
    .get(connector, startedAt, requestedSince ?? null);
  if (!row) throw new Error("startSyncRun returned no row");
  return fromRow(row);
}

export function finishSyncRun(
  db: Db,
  id: number,
  outcome: { finishedAt: string; accountsN?: number; transactionsN?: number; error?: string },
): SyncRun {
  const row = db
    .prepare<[string, number, number, string | null, number], SyncRunRow>(
      `update sync_runs set finished_at = ?, accounts_n = ?, transactions_n = ?, error = ? where id = ? returning ${COLUMNS}`,
    )
    .get(outcome.finishedAt, outcome.accountsN ?? 0, outcome.transactionsN ?? 0, outcome.error ?? null, id);
  if (!row) throw new Error(`No sync run ${id}`);
  return fromRow(row);
}

/**
 * Finishes every run still open with error `interrupted`, returning how many. Only one process
 * writes the database, so at startup an open row is one whose process died mid-run.
 */
export function finishInterruptedSyncRuns(db: Db, finishedAt: string): number {
  return db.prepare<[string]>(`update sync_runs set finished_at = ?, error = 'interrupted' where finished_at is null`).run(finishedAt).changes;
}

/** Most recently started run, across all connectors or for one. */
export function latestSyncRun(db: Db, connector?: string): SyncRun | undefined {
  const row =
    connector === undefined
      ? db.prepare<[], SyncRunRow>(`select ${COLUMNS} from sync_runs order by started_at desc, id desc limit 1`).get()
      : db.prepare<[string], SyncRunRow>(`select ${COLUMNS} from sync_runs where connector = ? order by started_at desc, id desc limit 1`).get(connector);
  return row && fromRow(row);
}

/**
 * Most recently started run for `connector` that finished without an error; with
 * `defaultWindowOnly`, only among runs that used the default window (no `requestedSince`).
 */
export function latestSuccessfulSyncRun(db: Db, connector: string, opts: { defaultWindowOnly?: boolean } = {}): SyncRun | undefined {
  const defaultOnly = opts.defaultWindowOnly ? " and requested_since is null" : "";
  const row = db
    .prepare<[string], SyncRunRow>(
      `select ${COLUMNS} from sync_runs where connector = ? and finished_at is not null and error is null${defaultOnly} order by started_at desc, id desc limit 1`,
    )
    .get(connector);
  return row && fromRow(row);
}

/** Newest first. */
export function listSyncRuns(db: Db, opts: { limit?: number } = {}): SyncRun[] {
  return db
    .prepare<[number], SyncRunRow>(`select ${COLUMNS} from sync_runs order by started_at desc, id desc limit ?`)
    .all(opts.limit ?? 50)
    .map(fromRow);
}
