import { describe, expect, it } from "vitest";
import { GENERIC, GENERIC_WITH_BAD_ROWS, MESSY_GENERIC, POSITIVE_CHARGES, SIGNED_CARD, SIGNED_WITH_STATUS, SPLIT_WITH_STATUS, TRAILING_COMMA } from "./__fixtures__/csvFiles.js";
import { parseAmount, parseCsv, parseCsvTransactions, parseDate, type NamedCsvPreset } from "./csv.js";
import { CSV_TEMPLATES } from "./csvTemplates.js";
import { ConnectorError } from "./types.js";

const strip = (t: { date: string; amount: number; description: string; pending: boolean }) => ({ date: t.date, amount: t.amount, description: t.description, pending: t.pending });

/** Reads `Transaction Date` or `Date`, `Description` and one signed `Amount`; `over` replaces fields. */
const preset = (over: Partial<NamedCsvPreset> = {}): NamedCsvPreset => ({
  name: "test",
  label: "Test",
  institution: "Test Bank",
  accountType: "unknown",
  date: ["Transaction Date", "Date"],
  description: ["Description"],
  amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
  ...over,
});
const template = (name: string): NamedCsvPreset => ({ name, ...CSV_TEMPLATES[name]! });
const generic = template("generic");
const pendingStatus = { columns: ["Status"], value: "Pending" };

describe("export shapes", () => {
  it("one signed column: amounts kept as-is, US dates converted", () => {
    const r = parseCsvTransactions(SIGNED_CARD, preset(), "7");
    expect(r.warnings).toEqual([]);
    expect(r.transactions.map(strip)).toEqual([
      { date: "2026-09-03", amount: -4.5, description: "COFFEE HOUSE", pending: false },
      { date: "2026-09-02", amount: -82.13, description: "GROCERY MART, INC", pending: false },
      { date: "2026-09-01", amount: 250, description: "PAYMENT THANK YOU", pending: false },
    ]);
    expect(r.transactions.every((t) => t.accountExternalId === "7")).toBe(true);
  });

  it("debit and credit columns fold into one signed amount; pending rows wait for the next export", () => {
    const r = parseCsvTransactions(SPLIT_WITH_STATUS, preset({ amount: { kind: "split", debit: ["Debit"], credit: ["Credit"] }, pending: pendingStatus }), "7");
    expect(r.transactions.map(strip)).toEqual([
      { date: "2026-09-04", amount: -37.2, description: "HARDWARE STORE", pending: false },
      { date: "2026-09-02", amount: 150, description: "PAYMENT RECEIVED", pending: false },
    ]);
    expect(r.pendingIgnored).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.warnings).toEqual([expect.stringMatching(/^Ignored 1 pending row/)]);
  });

  it("charges listed positive are negated, credits become positive", () => {
    const r = parseCsvTransactions(POSITIVE_CHARGES, preset({ amount: { kind: "signed", columns: ["Amount"], spendingPositive: true } }), "7");
    expect(r.transactions.map((t) => t.amount)).toEqual([-41, 200]);
  });

  it("ISO dates, signed amounts, a Status column marking pending rows", () => {
    const r = parseCsvTransactions(SIGNED_WITH_STATUS, preset({ pending: pendingStatus }), "3");
    expect(r.transactions.map(strip)).toEqual([
      { date: "2026-09-05", amount: 1500, description: "PAYROLL DEPOSIT", pending: false },
      { date: "2026-09-06", amount: -1200, description: "RENT PAYMENT", pending: false },
    ]);
    expect(r.pendingIgnored).toBe(1);
  });

  it("rows ending in a trailing comma still parse", () => {
    const r = parseCsvTransactions(TRAILING_COMMA, preset(), "2");
    expect(r.warnings).toEqual([]);
    expect(r.transactions.map(strip)).toEqual([
      { date: "2026-09-03", amount: -4.5, description: "COFFEE HOUSE", pending: false },
      { date: "2026-09-01", amount: 1500, description: "PAYROLL DEPOSIT", pending: false },
    ]);
  });

  it("generic template: three columns, spending negative", () => {
    const r = parseCsvTransactions(GENERIC, generic, "9");
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[2]).toMatchObject({ amount: 22, description: "Refund from garden center" });
  });
});

describe("templates", () => {
  it("have names usable as preset names and a label", () => {
    for (const [name, t] of Object.entries(CSV_TEMPLATES)) {
      expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(t.label).toBeTruthy();
    }
  });

  for (const [name, t] of Object.entries(CSV_TEMPLATES)) {
    it(`${name}: reads an export built from its own column names`, () => {
      const signed = t.amount.kind === "signed";
      const amountHeaders = t.amount.kind === "signed" ? [t.amount.columns[0]] : [t.amount.debit[0], t.amount.credit[0]];
      const positive = t.amount.kind === "signed" && t.amount.spendingPositive;
      const charge = signed ? [positive ? "12.50" : "-12.50"] : ["12.50", ""];
      const credit = signed ? [positive ? "-40.00" : "40.00"] : ["", "40.00"];
      const status = (v: string) => (t.pending ? [v] : []);
      const rows = [
        [t.date[0], t.description[0], ...amountHeaders, ...status(t.pending?.columns[0] ?? "")],
        ["09/01/2026", "COFFEE HOUSE", ...charge, ...status("Posted")],
        ["09/02/2026", "PAYMENT", ...credit, ...status("Posted")],
      ];
      if (t.pending) rows.push(["09/03/2026", "WAITING", ...charge, t.pending.value]);
      const r = parseCsvTransactions(rows.map((row) => row.join(",")).join("\n"), { name, ...t }, "1");
      expect(r.skipped).toBe(0);
      expect(r.transactions.map((x) => x.amount)).toEqual([-12.5, 40]);
      expect(r.pendingIgnored).toBe(t.pending ? 1 : 0);
    });
  }
});

describe("external ids", () => {
  it("are a hash of account, date, amount and description, stable across parses", () => {
    const a = parseCsvTransactions(GENERIC, generic, "9").transactions;
    const b = parseCsvTransactions(GENERIC, generic, "9").transactions;
    expect(a.map((t) => t.externalId)).toEqual(b.map((t) => t.externalId));
    expect(a[0].externalId).toMatch(/^9:[0-9a-f]{24}$/);
    const other = parseCsvTransactions(GENERIC, generic, "10").transactions;
    expect(other[0].externalId).not.toBe(a[0].externalId);
  });

  it("keeps identical rows in one file apart with an ordinal suffix", () => {
    const [first, second] = parseCsvTransactions(GENERIC, generic, "9").transactions;
    expect(second.externalId).toBe(`${first.externalId}#2`);
  });

  it("ignore whitespace and case differences in the description", () => {
    const a = parseCsvTransactions("Date,Description,Amount\n2026-09-01,Coffee  House,-4\n", generic, "1").transactions[0];
    const b = parseCsvTransactions("Date,Description,Amount\n2026-09-01, coffee house ,-4.00\n", generic, "1").transactions[0];
    expect(a.externalId).toBe(b.externalId);
  });
});

describe("robustness", () => {
  it("survives a BOM, CRLF, lower-case headers, quoted commas and quotes, $ and parentheses", () => {
    const r = parseCsvTransactions(MESSY_GENERIC, generic, "1");
    expect(r.warnings).toEqual([]);
    expect(r.transactions.map(strip)).toEqual([
      { date: "2026-09-01", amount: 1234.56, description: 'BAKERY "THE LOAF", DOWNTOWN', pending: false },
      { date: "2026-09-02", amount: -3, description: "Parking", pending: false },
    ]);
  });

  it("skips bad rows with a warning naming the line and keeps the rest", () => {
    const r = parseCsvTransactions(GENERIC_WITH_BAD_ROWS, generic, "1");
    expect(r.transactions).toHaveLength(1);
    expect(r.skipped).toBe(3);
    expect(r.warnings).toEqual([
      expect.stringMatching(/^Skipped line 3: unreadable date/),
      expect.stringMatching(/^Skipped line 4: unreadable amount/),
      expect.stringMatching(/^Skipped line 5: has 4 columns/),
    ]);
  });

  it("throws bad_file naming the preset when a required column is missing, or when the file is empty", () => {
    const strict = preset({ name: "strict" });
    expect(() => parseCsvTransactions("Date,Memo,Total\n2026-01-01,x,1\n", strict, "1")).toThrowError(ConnectorError);
    expect(() => parseCsvTransactions("Date,Memo,Total\n", strict, "1")).toThrow(
      expect.objectContaining({ connector: "csv", code: "bad_file", message: expect.stringContaining('No description column: the "strict" preset expects') }),
    );
    expect(() => parseCsvTransactions("", generic, "1")).toThrow(/empty/);
    expect(parseCsvTransactions("Date,Description,Amount\n", generic, "1").transactions).toEqual([]);
  });

  it("parseDate accepts ISO and US forms and rejects impossible dates", () => {
    expect(parseDate("2026-09-05")).toBe("2026-09-05");
    expect(parseDate("9/5/2026")).toBe("2026-09-05");
    expect(parseDate("09/05/26")).toBe("2026-09-05");
    expect(parseDate("2026-02-30")).toBeUndefined();
    expect(parseDate("13/01/2026")).toBeUndefined();
    expect(parseDate("Sept 5")).toBeUndefined();
  });

  it("parseAmount reads currency formatting and blanks only when asked", () => {
    expect(parseAmount("-12.34")).toBe(-12.34);
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(12.34)")).toBe(-12.34);
    expect(parseAmount("+5")).toBe(5);
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("", { blankIsZero: true })).toBe(0);
    expect(parseAmount("twelve")).toBeUndefined();
  });

  it("parseCsv handles quoted newlines and a missing final newline", () => {
    expect(parseCsv('a,b\n"x\ny",2')).toEqual([["a", "b"], ["x\ny", "2"]]);
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects a file whose quoted field is never closed instead of swallowing the rest", () => {
    const truncated = 'Date,Description,Amount\n2026-09-01,"Oops,-1\n2026-09-02,Fine,-2\n';
    expect(() => parseCsvTransactions(truncated, generic, "1")).toThrow(/line 2 is never closed/);
    expect(() => parseCsvTransactions(truncated, generic, "1")).toThrow(expect.objectContaining({ code: "bad_file" }));
  });
});
