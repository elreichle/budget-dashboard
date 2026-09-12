import { CSV_CONNECTOR_ID, parseCsvTransactions, type NamedCsvPreset } from "../connectors/csv.js";
import { SIMPLEFIN_CONNECTOR_ID } from "../connectors/simplefin.js";
import type { NormalizedTransaction } from "../connectors/types.js";
import { earliestTransactionDate, findAccount, finishSyncRun, getAccount, startSyncRun, upsertAccount, type Account, type Db, type SyncRun } from "../db/index.js";
import type { CategorizeOutcome, Categorizer } from "../rules/service.js";
import { applyTransactions, toFailure, type SyncFailure } from "./run.js";

/** The account to import into: an existing one by id, or one created (once) from a name. */
export type ImportTarget = { accountId: number } | { accountName: string };

export interface ImportCsvInput {
  text: string;
  /** The resolved preset (see csvPresets.ts); its name keys an account created from a name. */
  preset: NamedCsvPreset;
  target: ImportTarget;
}

export interface ImportResult {
  /** The sync_runs row (connector `csv`) as finished; `run.error` is set when `failure` is. */
  run: SyncRun;
  account: Pick<Account, "id" | "name" | "institution"> | null;
  inserted: number;
  updated: number;
  /** File rows dropped because a field could not be read; each adds a warning. */
  skipped: number;
  /** Rows the export marks pending, left out until they post (see `CsvParseResult`). */
  pendingIgnored: number;
  /** Rows dated on or after the account's first SimpleFIN transaction, left to SimpleFIN; a warning names that date. */
  skippedOverlap: number;
  /** What categorization did after the rows were applied; null when no categorizer was given or the import failed. */
  categorized: CategorizeOutcome | null;
  warnings: string[];
  failure?: SyncFailure;
}

export class UnknownAccountError extends Error {
  constructor(readonly accountId: number) {
    super(`No account ${accountId}`);
    this.name = "UnknownAccountError";
  }
}

/**
 * One CSV import: parse the file with its preset and fold the rows into the database through
 * the same upsert loop a sync uses, so re-importing a file (or an overlapping later export)
 * updates rows instead of doubling them. Into an account SimpleFIN already syncs, only history
 * from before its first SimpleFIN transaction is added (see `beforeSimpleFinCoverage`). Like a sync it records a sync_runs row whether it
 * succeeds or not, and returns a parse failure (`bad_file`) on the result rather than throwing.
 * An unknown `accountId` throws `UnknownAccountError` before anything is written; an account
 * named for a file that then fails to parse is rolled back with the rest.
 */
export function importCsv(db: Db, input: ImportCsvInput, now: () => string, categorizer?: Categorizer): ImportResult {
  if ("accountId" in input.target && !getAccount(db, input.target.accountId)) throw new UnknownAccountError(input.target.accountId);
  const run = startSyncRun(db, CSV_CONNECTOR_ID, now());
  try {
    const { account, parsed, overlap, applied, categorized } = db.transaction(() => {
      const account = resolveTarget(db, input, now());
      const parsed = parseCsvTransactions(input.text, input.preset, String(account.id));
      const overlap = beforeSimpleFinCoverage(db, account.id, parsed.transactions);
      const applied = applyTransactions(db, CSV_CONNECTOR_ID, overlap.kept, () => account.id, now());
      return { account, parsed, overlap, applied, categorized: categorizer?.run() ?? null };
    })();
    const finished = finishSyncRun(db, run.id, { finishedAt: now(), accountsN: 1, transactionsN: applied.inserted + applied.updated });
    return {
      run: finished,
      account: pick(account),
      inserted: applied.inserted,
      updated: applied.updated,
      skipped: parsed.skipped,
      pendingIgnored: parsed.pendingIgnored,
      skippedOverlap: overlap.skipped,
      categorized,
      warnings: [...parsed.warnings, ...overlap.warnings, ...applied.warnings, ...(categorized?.warnings ?? [])],
    };
  } catch (err) {
    const failure = toFailure(err);
    const finished = finishSyncRun(db, run.id, { finishedAt: now(), error: failure.message });
    const existing = "accountId" in input.target ? getAccount(db, input.target.accountId) : undefined;
    return { run: finished, account: existing ? pick(existing) : null, inserted: 0, updated: 0, skipped: 0, pendingIgnored: 0, skippedOverlap: 0, categorized: null, warnings: [], failure };
  }
}

/**
 * SimpleFIN owns an account from its earliest SimpleFIN transaction on: a CSV row for the same
 * charge has a different id, so importing rows from that day on would count it twice. Those rows
 * are dropped; an account with no SimpleFIN rows keeps them all.
 */
function beforeSimpleFinCoverage(db: Db, accountId: number, rows: NormalizedTransaction[]): { kept: NormalizedTransaction[]; skipped: number; warnings: string[] } {
  const cutoff = earliestTransactionDate(db, accountId, SIMPLEFIN_CONNECTOR_ID);
  if (cutoff === undefined) return { kept: rows, skipped: 0, warnings: [] };
  const kept = rows.filter((t) => t.date < cutoff);
  const skipped = rows.length - kept.length;
  const warnings = skipped > 0 ? [`Skipped ${skipped} row(s) dated ${cutoff} or later: SimpleFIN already covers this account from then.`] : [];
  return { kept, skipped, warnings };
}

/**
 * An account created from a name belongs to the `csv` connector and is keyed on preset + a slug
 * of the name (case and punctuation ignored), so a second statement under the same name lands in
 * the same account. An existing account keeps the name it was created with.
 */
function resolveTarget(db: Db, input: ImportCsvInput, now: string): Account {
  if ("accountId" in input.target) {
    const account = getAccount(db, input.target.accountId);
    if (!account) throw new UnknownAccountError(input.target.accountId);
    return account;
  }
  const preset = input.preset;
  const name = input.target.accountName.trim();
  const externalId = `${preset.name}:${accountSlug(name)}`;
  return (
    findAccount(db, CSV_CONNECTOR_ID, externalId) ??
    upsertAccount(db, { connector: CSV_CONNECTOR_ID, externalId, name, institution: preset.institution, type: preset.accountType }, now)
  );
}

function pick(a: Account): ImportResult["account"] {
  return { id: a.id, name: a.name, institution: a.institution };
}

/** Lower-case letters and digits joined by dashes; empty when the name has none (see `hasAccountSlug`). */
export function accountSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Whether `name` can key an account: it must contain at least one ASCII letter or digit. */
export function hasAccountSlug(name: string): boolean {
  return accountSlug(name) !== "";
}
