import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileBucketBody, FileBucketResponse, MonthList, PlanState, ReviewItem, ReviewResponse, Rule, TransactionFilter, TransactionsResponse } from "../api.js";
import { TransactionsPage } from "./TransactionsPage.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn<() => Promise<PlanState>>(),
  listMonths: vi.fn<() => Promise<MonthList>>(),
  getReview: vi.fn<() => Promise<ReviewResponse>>(),
  listTransactions: vi.fn<(filter?: TransactionFilter) => Promise<TransactionsResponse>>(),
  fileTransaction: vi.fn<(id: number, body: FileBucketBody) => Promise<FileBucketResponse>>(),
}));
vi.mock("../api.js", () => api);

const plan = {
  version: 1 as const,
  currency: "USD",
  planStartMonth: "2026-09",
  income: { netMonthly: 3000, paychecksPerMonth: 1 },
  buckets: [
    { id: "meals", name: "Meals", group: "living" as const, planned: 600, baseline: 700 },
    { id: "rent", name: "Rent", group: "fixed" as const, planned: 1500, baseline: 1500 },
  ],
  savingsGoals: [],
  debts: [],
  payoffStrategy: { order: [], totalMonthly: 400, rollover: true },
  subscriptions: [],
};

const BUCKETS = ["meals", "rent", "_transfer", "_income", "_uncategorized"];
const checking = { id: 1, name: "Everyday Checking", institution: "Bank" };
const card = { id: 2, name: "Rewards Card", institution: "Issuer" };
const at = "2026-09-06T08:00:00.000Z";

function txn(over: Partial<ReviewItem> & Pick<ReviewItem, "id" | "description">): ReviewItem {
  return { accountId: 1, connector: "fake", externalId: `x-${over.id}`, date: "2026-09-05", pending: false, amount: -12.5, bucketId: null, bucketSource: "none", debtId: null, createdAt: at, updatedAt: at, account: checking, ...over };
}

const cafe = txn({ id: 1, description: "CORNER CAFE #3 ", amount: -4.5 });
const shop = txn({ id: 2, description: "PENDING SHOP", pending: true, amount: -20, accountId: 2, account: card });
const grocery = txn({ id: 3, description: "GROCERY MART", amount: -52.1, bucketId: "meals", bucketSource: "manual" });
const payroll = txn({ id: 4, description: "PAYROLL DEPOSIT", amount: 2500, bucketId: "_income", bucketSource: "rule" });

const filed = (id: number, bucketId: string, rule: Rule | null = null): FileBucketResponse => ({
  transaction: { ...txn({ id, description: "x" }), bucketId, bucketSource: "manual" },
  rule,
  categorized: { applied: true, counts: null, warnings: [] },
});

beforeEach(() => {
  api.getPlan.mockReset().mockResolvedValue({ ok: true, plan });
  api.listMonths.mockReset().mockResolvedValue({ months: ["2026-09", "2026-08"], current: "2026-09" });
  api.getReview.mockReset().mockResolvedValue({ transactions: [cafe, shop], buckets: BUCKETS });
  api.listTransactions.mockReset().mockResolvedValue({ transactions: [payroll, grocery, shop], accounts: [checking, card], buckets: BUCKETS });
  api.fileTransaction.mockReset();
});

describe("TransactionsPage", () => {
  it("puts the review inbox above the month's transactions, pending rows greyed and tagged", async () => {
    render(<TransactionsPage />);
    const inbox = await screen.findByRole("region", { name: "Review inbox" });
    const list = await screen.findByRole("region", { name: "September 2026" });
    expect(inbox.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(inbox).findByRole("form", { name: "File CORNER CAFE #3" })).toBeInTheDocument();
    expect(within(inbox).getByRole("form", { name: "File PENDING SHOP" })).toBeInTheDocument();
    expect(api.listTransactions).toHaveBeenCalledWith({ month: "2026-09", accountId: undefined });

    const groceryRow = await within(list).findByRole("row", { name: /GROCERY MART/ });
    expect(groceryRow).toHaveTextContent("Sep 5, 2026");
    expect(groceryRow).toHaveTextContent("-$52.10");
    expect(groceryRow).not.toHaveClass("pending");
    expect(within(groceryRow).getByRole("button", { name: "Meals" })).toHaveAttribute("aria-expanded", "false");
    const payrollRow = within(list).getByRole("row", { name: /PAYROLL DEPOSIT/ });
    expect(payrollRow).toHaveTextContent("$2,500.00");
    expect(within(payrollRow).getByRole("button", { name: "Income" })).toBeInTheDocument();
    const pendingRow = within(list).getByRole("row", { name: /PENDING SHOP/ });
    expect(pendingRow).toHaveClass("pending");
    expect(pendingRow).toHaveTextContent("Rewards Card");
    expect(within(pendingRow).getByText("Pending")).toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Needs a bucket" })).toBeInTheDocument();
  });

  it("files an inbox item from the picker and refreshes the inbox and the list", async () => {
    render(<TransactionsPage />);
    const form = await screen.findByRole("form", { name: "File CORNER CAFE #3" });
    const picker = within(form).getByRole("combobox", { name: "Bucket" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a bucket…", "Meals", "Rent", "Transfer", "Income"]);
    const submit = within(form).getByRole("button", { name: "File" });
    expect(submit).toBeDisabled();
    expect(within(form).queryByRole("textbox")).not.toBeInTheDocument();

    api.fileTransaction.mockResolvedValue(filed(1, "meals"));
    api.getReview.mockResolvedValue({ transactions: [shop], buckets: BUCKETS });
    fireEvent.change(picker, { target: { value: "meals" } });
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(api.fileTransaction).toHaveBeenCalledWith(1, { bucket: "meals" });
    await waitFor(() => expect(screen.queryByRole("form", { name: "File CORNER CAFE #3" })).not.toBeInTheDocument());
    expect(api.getReview).toHaveBeenCalledTimes(2);
    expect(api.listTransactions).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("saves the choice as a rule with an edited match and confirms it with a toast", async () => {
    render(<TransactionsPage />);
    const form = await screen.findByRole("form", { name: "File CORNER CAFE #3" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bucket" }), { target: { value: "meals" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "Save as rule" }));
    const match = within(form).getByRole("textbox", { name: "Matches" });
    expect(match).toHaveValue("CORNER CAFE #3");
    const submit = within(form).getByRole("button", { name: "File" });
    fireEvent.change(match, { target: { value: "  " } });
    expect(submit).toBeDisabled();
    fireEvent.change(match, { target: { value: "corner cafe " } });

    api.fileTransaction.mockResolvedValue(filed(1, "meals", { match: "corner cafe", bucket: "meals" }));
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(api.fileTransaction).toHaveBeenCalledWith(1, { bucket: "meals", saveRule: true, match: "corner cafe" });
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent('Rule saved: "corner cafe" → Meals'));
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(toast).toBeEmptyDOMElement();
  });

  it("changes a filed row's bucket from its chip, and Escape closes the picker", async () => {
    render(<TransactionsPage />);
    const list = await screen.findByRole("region", { name: "September 2026" });
    const chip = await within(list).findByRole("button", { name: "Meals" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const picker = within(within(list).getByRole("form", { name: "File GROCERY MART" })).getByRole("combobox", { name: "Bucket" });
    expect(picker).toHaveValue("meals");
    expect(picker).toHaveFocus();
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(within(list).queryByRole("form", { name: "File GROCERY MART" })).not.toBeInTheDocument();
    expect(chip).toHaveFocus();

    fireEvent.click(chip);
    const form = within(list).getByRole("form", { name: "File GROCERY MART" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bucket" }), { target: { value: "rent" } });
    api.fileTransaction.mockResolvedValue(filed(3, "rent"));
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "File" }));
    });
    expect(api.fileTransaction).toHaveBeenCalledWith(3, { bucket: "rent" });
    expect(within(list).queryByRole("form", { name: "File GROCERY MART" })).not.toBeInTheDocument();
    await waitFor(() => expect(api.listTransactions).toHaveBeenCalledTimes(2));
  });

  it("lets a filing that lands late leave another row's open editor alone", async () => {
    let resolve: (result: FileBucketResponse) => void = () => {};
    api.fileTransaction.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<TransactionsPage />);
    const list = await screen.findByRole("region", { name: "September 2026" });
    fireEvent.click(await within(list).findByRole("button", { name: "Meals" }));
    const form = within(list).getByRole("form", { name: "File GROCERY MART" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bucket" }), { target: { value: "rent" } });
    fireEvent.click(within(form).getByRole("button", { name: "File" }));
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.click(within(list).getByRole("button", { name: "Income" }));
    expect(within(list).getByRole("form", { name: "File PAYROLL DEPOSIT" })).toBeInTheDocument();
    await act(async () => {
      resolve(filed(3, "rent"));
    });
    expect(within(list).getByRole("form", { name: "File PAYROLL DEPOSIT" })).toBeInTheDocument();
    await waitFor(() => expect(api.listTransactions).toHaveBeenCalledTimes(2));
  });

  it("keeps the account filter clearable when a load fails", async () => {
    render(<TransactionsPage />);
    const list = await screen.findByRole("region", { name: "September 2026" });
    await within(list).findByRole("button", { name: "Meals" });
    await act(async () => {
      fireEvent.change(within(list).getByRole("combobox", { name: "Account" }), { target: { value: "2" } });
    });
    api.listTransactions.mockRejectedValue(new Error("database is locked"));
    await act(async () => {
      fireEvent.change(within(list).getByRole("combobox", { name: "Month" }), { target: { value: "2026-08" } });
    });
    const august = await screen.findByRole("region", { name: "August 2026" });
    expect(await within(august).findByRole("alert")).toHaveTextContent("database is locked");
    const account = within(august).getByRole("combobox", { name: "Account" });
    expect(account).toHaveValue("2");
    await act(async () => {
      fireEvent.change(account, { target: { value: "" } });
    });
    expect(api.listTransactions).toHaveBeenLastCalledWith({ month: "2026-08", accountId: undefined });
  });

  it("filters the list by month and by account", async () => {
    render(<TransactionsPage />);
    const list = await screen.findByRole("region", { name: "September 2026" });
    await within(list).findByRole("button", { name: "Meals" });
    const month = within(list).getByRole("combobox", { name: "Month" });
    expect(within(month).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["2026-09", "2026-08"]);
    const account = within(list).getByRole("combobox", { name: "Account" });
    expect(within(account).getAllByRole("option").map((o) => o.textContent)).toEqual(["All accounts", "Everyday Checking (Bank)", "Rewards Card (Issuer)"]);

    await act(async () => {
      fireEvent.change(month, { target: { value: "2026-08" } });
    });
    expect(api.listTransactions).toHaveBeenLastCalledWith({ month: "2026-08", accountId: undefined });
    const august = await screen.findByRole("region", { name: "August 2026" });
    await act(async () => {
      fireEvent.change(within(august).getByRole("combobox", { name: "Account" }), { target: { value: "2" } });
    });
    expect(api.listTransactions).toHaveBeenLastCalledWith({ month: "2026-08", accountId: 2 });
  });

  it("shows why a filing failed and keeps the item in the inbox", async () => {
    api.fileTransaction.mockRejectedValue(new Error("rules.json is invalid at rules.0.bucket"));
    render(<TransactionsPage />);
    const form = await screen.findByRole("form", { name: "File PENDING SHOP" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bucket" }), { target: { value: "_transfer" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "File" }));
    });
    expect(await within(form).findByRole("alert")).toHaveTextContent("rules.json is invalid at rules.0.bucket");
    expect(within(form).getByRole("button", { name: "File" })).toBeEnabled();
    expect(api.getReview).toHaveBeenCalledTimes(1);
  });

  it("lists transactions read-only while the plan is missing", async () => {
    api.getPlan.mockResolvedValue({ ok: false, error: "plan_missing", path: "/data/plan.json", hint: "Copy the example plan" });
    render(<TransactionsPage />);
    expect(await screen.findByRole("heading", { name: "Filing needs a valid plan" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "September 2026" });
    const row = await within(list).findByRole("row", { name: /PAYROLL DEPOSIT/ });
    expect(within(row).getByText("Income")).toBeInTheDocument();
    expect(await within(screen.getByRole("region", { name: "Review inbox" })).findByText("CORNER CAFE #3")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(within(list).queryByRole("button")).not.toBeInTheDocument();
  });
});
