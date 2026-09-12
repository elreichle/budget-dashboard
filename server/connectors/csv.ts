import { createHash } from "node:crypto";
import { roundCents } from "../money.js";
import { ConnectorError, type NormalizedTransaction } from "./types.js";

/**
 * CSV import: turns a bank's transaction export into normalized transactions for one account.
 *
 * Each bank names its columns and signs its amounts differently, so a preset says which header
 * holds the date, description and amount, and whether charges are listed positive (most card
 * exports) or negative (most bank exports). Templates for common exports live in
 * csvTemplates.ts; the presets an import may use come from the user's data dir (csvPresets.ts).
 * Header matching is case-insensitive and the first candidate present wins, so minor export
 * variations still parse.
 *
 * Rows get a deterministic external id (a hash of account, date, amount and description), so
 * re-importing the same file, or an overlapping later export, updates rows instead of doubling
 * them. Two identical rows in one file (the same coffee twice in a day) are kept apart by an
 * ordinal suffix.
 */

export const CSV_CONNECTOR_ID = "csv";

/** How the amount column(s) encode the sign. */
export type CsvAmountSpec =
  /** One signed column. `spendingPositive` means charges are listed as positive numbers. */
  | { kind: "signed"; columns: string[]; spendingPositive: boolean }
  /** Two unsigned columns: money out and money in. Either may be blank on a row. */
  | { kind: "split"; debit: string[]; credit: string[] };

export interface CsvPreset {
  /** Shown in the UI's preset picker. */
  label: string;
  /** Institution name for an account created from this preset. */
  institution: string;
  /** Connector-reported account kind for an account created from this preset. */
  accountType: "checking" | "credit" | "unknown";
  /** Header candidates for each field, in preference order. */
  date: string[];
  description: string[];
  amount: CsvAmountSpec;
  /** A column whose value (case-insensitive) marks a row as pending, when the export has one. */
  pending?: { columns: string[]; value: string };
}

/** A preset with its name, which the import form shows and csv account ids start with. */
export interface NamedCsvPreset extends CsvPreset {
  name: string;
}

export interface CsvParseResult {
  /** Posted rows only; see `pendingIgnored`. */
  transactions: NormalizedTransaction[];
  /** Data rows dropped because a field could not be read; each adds a warning. */
  skipped: number;
  /**
   * Rows the export marks pending, left out on purpose: a pending line often posts later with
   * a different date or descriptor, so its hash id would never match and it would linger as a
   * ghost. The next export lists it posted and it is imported then.
   */
  pendingIgnored: number;
  warnings: string[];
}

/** Rows beyond this many are refused rather than parsed; a year of activity is a few thousand. */
export const CSV_MAX_ROWS = 50_000;

/**
 * Parses `text` with the named preset into transactions for the account identified by
 * `accountKey` (any stable string; the pipeline uses the DB account id). Throws `bad_file` when
 * the header lacks a column the preset needs; a bad row is skipped with a warning so one typo
 * does not block a whole statement.
 */
export function parseCsvTransactions(text: string, preset: NamedCsvPreset, accountKey: string): CsvParseResult {
  const records = parseCsv(text);
  if (records.length === 0) throw badFile("The file is empty.");
  const header = (records[0] ?? []).map(normalizeHeader);
  const col = columnFinder(header, preset.name);
  const dateCol = col.required("date", preset.date);
  const descCol = col.required("description", preset.description);
  const amountCols = preset.amount.kind === "signed" ? { signed: col.required("amount", preset.amount.columns) } : { debit: col.required("debit", preset.amount.debit), credit: col.required("credit", preset.amount.credit) };
  const pendingCol = preset.pending ? col.optional(preset.pending.columns) : undefined;

  const rows = records.slice(1);
  if (rows.length > CSV_MAX_ROWS) throw badFile(`The file has ${rows.length} rows; the limit is ${CSV_MAX_ROWS}.`);

  const result: CsvParseResult = { transactions: [], skipped: 0, pendingIgnored: 0, warnings: [] };
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const line = i + 2; // 1-based, after the header
    if (row.every((cell) => cell.trim() === "")) return;
    // Some exports end every row with a trailing comma; a blank extra cell is not data.
    while (row.length > header.length && (row.at(-1) ?? "").trim() === "") row.pop();
    if (row.length !== header.length) {
      skip(result, line, `has ${row.length} columns, header has ${header.length}`);
      return;
    }
    const cell = (i: number) => row[i] ?? "";
    const date = parseDate(cell(dateCol));
    if (!date) {
      skip(result, line, `unreadable date "${cell(dateCol)}"`);
      return;
    }
    let amount: number | undefined;
    if ("signed" in amountCols) {
      const raw = parseAmount(cell(amountCols.signed));
      if (raw !== undefined) amount = preset.amount.kind === "signed" && preset.amount.spendingPositive ? -raw : raw;
    } else {
      const debit = parseAmount(cell(amountCols.debit), { blankIsZero: true });
      const credit = parseAmount(cell(amountCols.credit), { blankIsZero: true });
      if (debit !== undefined && credit !== undefined) amount = -Math.abs(debit) + Math.abs(credit);
    }
    if (amount === undefined) {
      skip(result, line, "unreadable amount");
      return;
    }
    amount = roundCents(amount);
    const description = cell(descCol).trim().replace(/\s+/g, " ");
    if (pendingCol !== undefined && preset.pending !== undefined && cell(pendingCol).trim().toLowerCase() === preset.pending.value.toLowerCase()) {
      result.pendingIgnored += 1;
      return;
    }

    const base = externalId(accountKey, date, amount, description);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    result.transactions.push({ externalId: n === 1 ? base : `${base}#${n}`, accountExternalId: accountKey, date, pending: false, amount, description });
  });
  if (result.pendingIgnored > 0) result.warnings.push(`Ignored ${result.pendingIgnored} pending row(s); they are imported once they post.`);
  return result;
}

function skip(result: CsvParseResult, line: number, why: string): void {
  result.skipped += 1;
  result.warnings.push(`Skipped line ${line}: ${why}`);
}

function badFile(message: string): ConnectorError {
  return new ConnectorError(CSV_CONNECTOR_ID, "bad_file", message);
}

/** `<account>:<24 hex>`: sha256 over the fields that identify a statement line. */
function externalId(accountKey: string, date: string, amount: number, description: string): string {
  const hash = createHash("sha256").update([accountKey, date, amount.toFixed(2), description.toLowerCase()].join("\n")).digest("hex");
  return `${accountKey}:${hash.slice(0, 24)}`;
}

function normalizeHeader(cell: string): string {
  return cell.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function columnFinder(header: string[], presetName: string) {
  const find = (candidates: string[]) => {
    for (const c of candidates) {
      const i = header.indexOf(c.toLowerCase());
      if (i !== -1) return i;
    }
    return undefined;
  };
  return {
    optional: find,
    required(field: string, candidates: string[]): number {
      const i = find(candidates);
      if (i === undefined) throw badFile(`No ${field} column: the "${presetName}" preset expects one of ${candidates.map((c) => `"${c}"`).join(", ")}.`);
      return i;
    },
  };
}

/** `YYYY-MM-DD`, `M/D/YYYY` or `M/D/YY` (2000s) → `YYYY-MM-DD`, or undefined if not a real date. */
export function parseDate(cell: string): string | undefined {
  const s = cell.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), (us[3] ?? "").length === 2 ? 2000 + Number(us[3]) : Number(us[3])];
  else return undefined;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `-12.34`, `$1,234.56`, `(12.34)` (negative), `+5` → dollars; undefined when unreadable. */
export function parseAmount(cell: string, opts: { blankIsZero?: boolean } = {}): number | undefined {
  let s = cell.trim().replace(/[$,\s]/g, "");
  if (s === "") return opts.blankIsZero ? 0 : undefined;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^[+-]?\d+(?:\.\d+)?$|^[+-]?\.\d+$/.test(s)) return undefined;
  const n = Number(s);
  return negative ? -n : n;
}

/**
 * RFC 4180 reader: quoted fields may hold commas, newlines and doubled quotes; rows end with
 * LF or CRLF. Returns every row, including blank ones, as arrays of raw (untrimmed) cells.
 * Throws `bad_file` when a quoted field is never closed (a truncated download), since the rest
 * of the file would otherwise vanish into that one cell.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (quoted) throw badFile(`A quoted field starting on line ${rows.length + 1} is never closed; the file looks truncated.`);
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // A blank line is one empty cell; drop trailing blank rows so a final newline is not a row.
  while (rows.at(-1)?.every((c) => c === "")) rows.pop();
  return rows;
}
