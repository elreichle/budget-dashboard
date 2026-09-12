import type { CsvPreset } from "./csv.js";

/**
 * Starting points for common bank exports, keyed by template name. Column names are best-effort
 * from each bank's public export format, and banks change them, so a template is only a default:
 * `<DATA_DIR>/csv-presets.json` picks the templates someone uses and overrides any field (see
 * csvPresets.ts). Card exports often list the transaction date before the posted date; templates
 * prefer the transaction date because that is the date the user remembers.
 *
 * To add a bank, add an entry here and a row to the README table; the template test builds an
 * export from every entry's own column names.
 */
export const CSV_TEMPLATES: Readonly<Record<string, CsvPreset>> = {
  ally: {
    label: "Ally Bank (checking or savings)",
    institution: "Ally Bank",
    accountType: "checking",
    date: ["Date"],
    description: ["Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
  },
  amex: {
    label: "American Express (card)",
    institution: "American Express",
    accountType: "credit",
    date: ["Date"],
    description: ["Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: true },
  },
  "apple-card": {
    label: "Apple Card",
    institution: "Apple Card",
    accountType: "credit",
    date: ["Transaction Date", "Clearing Date"],
    description: ["Merchant", "Description"],
    amount: { kind: "signed", columns: ["Amount (USD)", "Amount"], spendingPositive: true },
  },
  "bank-of-america": {
    label: "Bank of America (card)",
    institution: "Bank of America",
    accountType: "credit",
    date: ["Posted Date", "Date"],
    description: ["Payee", "Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
  },
  "capital-one": {
    label: "Capital One (card)",
    institution: "Capital One",
    accountType: "credit",
    date: ["Transaction Date", "Posted Date"],
    description: ["Description"],
    amount: { kind: "split", debit: ["Debit"], credit: ["Credit"] },
  },
  chase: {
    label: "Chase (card or checking)",
    institution: "Chase",
    accountType: "unknown",
    date: ["Transaction Date", "Posting Date"],
    description: ["Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
  },
  citi: {
    label: "Citi (card)",
    institution: "Citi",
    accountType: "credit",
    date: ["Date"],
    description: ["Description"],
    amount: { kind: "split", debit: ["Debit"], credit: ["Credit"] },
    pending: { columns: ["Status"], value: "Pending" },
  },
  discover: {
    label: "Discover (card)",
    institution: "Discover",
    accountType: "credit",
    date: ["Trans. Date", "Post Date"],
    description: ["Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: true },
  },
  schwab: {
    label: "Charles Schwab (checking)",
    institution: "Charles Schwab",
    accountType: "checking",
    date: ["Date"],
    description: ["Description"],
    amount: { kind: "split", debit: ["Withdrawal"], credit: ["Deposit"] },
    pending: { columns: ["Status"], value: "Pending" },
  },
  sofi: {
    label: "SoFi (checking or savings)",
    institution: "SoFi",
    accountType: "checking",
    date: ["Date"],
    description: ["Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
    pending: { columns: ["Status"], value: "Pending" },
  },
  "us-bank": {
    label: "U.S. Bank (checking or card)",
    institution: "U.S. Bank",
    accountType: "unknown",
    date: ["Date"],
    description: ["Name", "Description"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
  },
  generic: {
    label: "Generic (Date, Description, Amount; spending negative)",
    institution: "CSV import",
    accountType: "unknown",
    date: ["Date", "Transaction Date", "Posted Date"],
    description: ["Description", "Payee", "Name", "Memo"],
    amount: { kind: "signed", columns: ["Amount"], spendingPositive: false },
    pending: { columns: ["Status", "Pending"], value: "Pending" },
  },
};
