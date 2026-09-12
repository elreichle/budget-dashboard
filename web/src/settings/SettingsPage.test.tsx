import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountsResponse, AccountView, CsvImportForm, CsvPresetOption, ImportResult, SimpleFinStatus, SyncResult, SyncRun, SyncStatus } from "../api.js";
import { POLL_RUNNING_MS } from "../components/StatusStrip.js";
import { SettingsPage } from "./SettingsPage.js";

const api = vi.hoisted(() => ({
  getSimpleFinStatus: vi.fn<() => Promise<SimpleFinStatus>>(),
  claimSimpleFin: vi.fn<(token: string) => Promise<SimpleFinStatus>>(),
  getSyncStatus: vi.fn<() => Promise<SyncStatus>>(),
  triggerSync: vi.fn<() => Promise<SyncResult>>(),
  listCsvPresets: vi.fn<() => Promise<CsvPresetOption[]>>(),
  getAccounts: vi.fn<() => Promise<AccountsResponse>>(),
  importCsv: vi.fn<(form: CsvImportForm) => Promise<ImportResult>>(),
}));
vi.mock("../api.js", () => api);

const run = (over: Partial<SyncRun> = {}): SyncRun => ({ id: 1, connector: "simplefin", startedAt: "2026-09-10T08:00:00.000Z", finishedAt: "2026-09-10T08:00:05.000Z", accountsN: 4, transactionsN: 120, error: null, requestedSince: null, ...over });
const categorized = { applied: true, counts: null, warnings: [] };
const syncResult = (over: Partial<SyncResult> = {}): SyncResult => ({ run: run(), inserted: 3, updated: 2, skipped: 0, snapshots: 4, categorized, warnings: [], ...over });
const importResult = (over: Partial<ImportResult> = {}): ImportResult => ({
  run: run({ connector: "csv" }),
  account: { id: 5, name: "Joint Checking", institution: "Example Bank" },
  inserted: 0,
  updated: 0,
  skipped: 0,
  pendingIgnored: 0,
  skippedOverlap: 0,
  categorized,
  warnings: [],
  ...over,
});
const joint: AccountView = { id: 5, connector: "csv", externalId: "generic:joint-checking", name: "Joint Checking", institution: "Example Bank", type: "checking", role: null, linkedGoalIds: [], linkedDebtId: null, createdAt: "2026-09-01T00:00:00.000Z", balance: null };
const accounts = (list: AccountView[]): AccountsResponse => ({ accounts: list, debts: [], goals: [], currency: "USD", planOk: true });
const presets: CsvPresetOption[] = [
  { name: "generic", label: "Generic", institution: "Any bank" },
  { name: "cardco", label: "Card Co", institution: "Card Co" },
];

beforeEach(() => {
  api.getSimpleFinStatus.mockReset().mockResolvedValue({ configured: true });
  api.claimSimpleFin.mockReset();
  api.getSyncStatus.mockReset().mockResolvedValue({ running: false, last: null });
  api.triggerSync.mockReset();
  api.listCsvPresets.mockReset().mockResolvedValue(presets);
  api.getAccounts.mockReset().mockResolvedValue(accounts([joint]));
  api.importCsv.mockReset();
});

describe("SimpleFIN connection", () => {
  it("sends a pasted setup token once, clears it at once and shows the connection", async () => {
    api.getSimpleFinStatus.mockResolvedValueOnce({ configured: false });
    api.claimSimpleFin.mockResolvedValue({ configured: true });
    render(<SettingsPage />);
    const card = await screen.findByRole("region", { name: "SimpleFIN" });
    expect(await within(card).findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();

    const form = within(card).getByRole("form", { name: "Connect SimpleFIN" });
    const input = within(form).getByLabelText("Setup token");
    expect(input).toHaveAttribute("type", "password");
    const token = ["DEMO", "SETUP", "TOKEN"].join("-");
    fireEvent.change(input, { target: { value: `  ${token}\n` } });
    fireEvent.click(within(form).getByRole("button", { name: "Connect" }));
    expect(api.claimSimpleFin).toHaveBeenCalledExactlyOnceWith(token);
    expect(input).toHaveValue("");

    expect(await within(card).findByRole("status")).toHaveTextContent("Connected. Sync now to pull in your accounts.");
    expect(await within(card).findByText("Connected")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Reconnect" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled());
  });

  it("shows why a token was refused without putting it back", async () => {
    api.getSimpleFinStatus.mockResolvedValue({ configured: false });
    api.claimSimpleFin.mockRejectedValue(new Error("SimpleFIN rejected the setup token (HTTP 403)."));
    render(<SettingsPage />);
    const card = await screen.findByRole("region", { name: "SimpleFIN" });
    const form = within(card).getByRole("form", { name: "Connect SimpleFIN" });
    const input = within(form).getByLabelText("Setup token");
    fireEvent.change(input, { target: { value: "SPENT-TOKEN" } });
    fireEvent.submit(form);
    expect(await within(card).findByRole("alert")).toHaveTextContent("rejected the setup token");
    expect(input).toHaveValue("");
    expect(within(form).getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});

describe("Sync", () => {
  it("shows the last run's error and keeps Sync now off until SimpleFIN is connected", async () => {
    api.getSimpleFinStatus.mockResolvedValue({ configured: false });
    api.getSyncStatus.mockResolvedValue({ running: false, last: run({ error: "SimpleFIN returned HTTP 403." }) });
    render(<SettingsPage />);
    const sync = await screen.findByRole("region", { name: "Sync" });
    expect(await within(sync).findByText(/^Last sync failed .*: SimpleFIN returned HTTP 403\.$/)).toBeInTheDocument();
    expect(await within(sync).findByText(/Connect SimpleFIN above to sync/)).toBeInTheDocument();
    expect(within(sync).getByRole("button", { name: "Sync now" })).toBeDisabled();
  });

  it("runs a sync, reports what it did and refreshes the last-run line", async () => {
    let finish!: (result: SyncResult) => void;
    api.triggerSync.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<SettingsPage />);
    const sync = await screen.findByRole("region", { name: "Sync" });
    expect(await within(sync).findByText("Never synced")).toBeInTheDocument();
    const button = within(sync).getByRole("button", { name: "Sync now" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(button).toHaveTextContent("Syncing…");
    expect(button).toBeDisabled();
    api.getSyncStatus.mockResolvedValue({ running: false, last: run() });
    finish(syncResult({ warnings: ["Example Bank needs to be reconnected."] }));

    expect(await within(sync).findByRole("status")).toHaveTextContent("Synced: 3 new transactions, 2 updated, 4 balance readings.");
    expect(within(sync).getByText("Example Bank needs to be reconnected.")).toBeInTheDocument();
    expect(await within(sync).findByText(/^Last sync .* · 120 transactions across 4 accounts$/)).toBeInTheDocument();
    expect(api.triggerSync).toHaveBeenCalledTimes(1);
  });

  it("keeps re-reading a sync that was already running when the page opened, then offers Sync now", async () => {
    vi.useFakeTimers();
    try {
      api.getSyncStatus.mockResolvedValueOnce({ running: true, last: run({ finishedAt: null }) }).mockResolvedValue({ running: false, last: run() });
      render(<SettingsPage />);
      await act(async () => {});
      const sync = screen.getByRole("region", { name: "Sync" });
      const button = within(sync).getByRole("button", { name: "Syncing…" });
      expect(button).toBeDisabled();
      expect(within(sync).getByText("Sync running…")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(POLL_RUNNING_MS));
      await act(async () => {});
      expect(api.getSyncStatus).toHaveBeenCalledTimes(2);
      expect(button).toHaveTextContent("Sync now");
      expect(button).toBeEnabled();
      expect(within(sync).getByText(/^Last sync .* · 120 transactions across 4 accounts$/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a failed sync's message", async () => {
    api.triggerSync.mockRejectedValue(new Error("SimpleFIN returned HTTP 500."));
    render(<SettingsPage />);
    const sync = await screen.findByRole("region", { name: "Sync" });
    const button = within(sync).getByRole("button", { name: "Sync now" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await within(sync).findByRole("alert")).toHaveTextContent("SimpleFIN returned HTTP 500.");
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("CSV import", () => {
  const file = new File(["Date,Description,Amount\n"], "export.csv", { type: "text/csv" });

  it("imports a file into an existing account and reports the counts", async () => {
    api.importCsv.mockResolvedValue(importResult({ inserted: 12, pendingIgnored: 2, warnings: ["Row 7: unreadable date, skipped"] }));
    render(<SettingsPage />);
    const csv = await screen.findByRole("region", { name: "Import a CSV" });
    const form = within(csv).getByRole("form", { name: "Import CSV" });
    const submit = within(form).getByRole("button", { name: "Import" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(form).getByLabelText("File"), { target: { files: [file] } });
    await within(form).findByRole("option", { name: "Card Co" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bank format" }), { target: { value: "generic" } });
    await within(form).findByRole("option", { name: "Joint Checking (Example Bank)" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Account" }), { target: { value: "5" } });
    expect(within(form).queryByLabelText("New account name")).not.toBeInTheDocument();
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(api.importCsv).toHaveBeenCalledWith({ file, preset: "generic", target: { accountId: 5 } });
    expect(await within(csv).findByRole("status")).toHaveTextContent("Imported into Joint Checking: 12 new transactions, 0 updated, 2 pending rows left out until posted.");
    expect(within(csv).getByText("Row 7: unreadable date, skipped")).toBeInTheDocument();
    await waitFor(() => expect(api.getAccounts).toHaveBeenCalledTimes(2));
    expect(submit).toBeDisabled();
  });

  it("says how many rows SimpleFIN already covers", async () => {
    api.importCsv.mockResolvedValue(importResult({ inserted: 3, skippedOverlap: 9, warnings: ["Skipped 9 row(s) dated 2026-08-15 or later: SimpleFIN already covers this account from then."] }));
    render(<SettingsPage />);
    const csv = await screen.findByRole("region", { name: "Import a CSV" });
    const form = within(csv).getByRole("form", { name: "Import CSV" });
    fireEvent.change(within(form).getByLabelText("File"), { target: { files: [file] } });
    await within(form).findByRole("option", { name: "Card Co" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bank format" }), { target: { value: "generic" } });
    await within(form).findByRole("option", { name: "Joint Checking (Example Bank)" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Account" }), { target: { value: "5" } });

    fireEvent.submit(form);
    expect(await within(csv).findByRole("status")).toHaveTextContent("Imported into Joint Checking: 3 new transactions, 0 updated, 9 rows already covered by SimpleFIN.");
    expect(within(csv).getByText(/dated 2026-08-15 or later/)).toBeInTheDocument();
    await waitFor(() => expect(api.getAccounts).toHaveBeenCalledTimes(2));
  });

  it("names a new account when there is none to pick, and shows a refused file", async () => {
    api.getAccounts.mockResolvedValue(accounts([]));
    api.importCsv.mockRejectedValue(new Error("The file does not have the columns the Generic preset expects."));
    render(<SettingsPage />);
    const form = await screen.findByRole("form", { name: "Import CSV" });
    await waitFor(() => expect(within(form).getByRole("combobox", { name: "Account" })).toHaveValue("new"));
    fireEvent.change(within(form).getByLabelText("File"), { target: { files: [file] } });
    await within(form).findByRole("option", { name: "Generic" });
    fireEvent.change(within(form).getByRole("combobox", { name: "Bank format" }), { target: { value: "generic" } });
    expect(within(form).getByRole("button", { name: "Import" })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("New account name"), { target: { value: "  Credit Union " } });

    fireEvent.submit(form);
    expect(api.importCsv).toHaveBeenCalledWith({ file, preset: "generic", target: { accountName: "Credit Union" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("does not have the columns");
  });
});
