import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { AccountsResponse, DebtResponse, GoalsProgress, MilestonesResponse, MonthList, MonthSummary, PlanState, Streaks, SyncStatus } from "./api.js";

const api = vi.hoisted(() => ({
  getPlan: vi.fn<() => Promise<PlanState>>(),
  getSyncStatus: vi.fn<() => Promise<SyncStatus>>(),
  listMonths: vi.fn<() => Promise<MonthList>>(),
  getMonth: vi.fn<(month: string) => Promise<MonthSummary>>(),
  getDebt: vi.fn<() => Promise<DebtResponse>>(),
  getGoals: vi.fn<() => Promise<GoalsProgress>>(),
  getAccounts: vi.fn<() => Promise<AccountsResponse>>(),
  getStreaks: vi.fn<() => Promise<Streaks>>(),
  getMilestones: vi.fn<() => Promise<MilestonesResponse>>(),
  dismissMilestone: vi.fn<(id: number) => Promise<unknown>>(),
}));
vi.mock("./api.js", () => api);

const samplePlan = {
  version: 1 as const,
  currency: "USD",
  planStartMonth: "2026-09",
  income: { netMonthly: 3000, paychecksPerMonth: 1 },
  buckets: [
    { id: "meals", name: "Meals", group: "living" as const, planned: 600, baseline: 700 },
    { id: "rent", name: "Rent", group: "fixed" as const, planned: 1500, baseline: 1500 },
  ],
  savingsGoals: [{ id: "bills", name: "Bills fund", monthly: 200, baselineMonthly: 0, targetBalance: null, items: [] }],
  debts: [],
  payoffStrategy: { order: [], totalMonthly: 400, rollover: true },
  subscriptions: [],
};

beforeEach(() => {
  window.location.hash = "";
  api.getPlan.mockReset();
  api.getSyncStatus.mockReset();
  api.getSyncStatus.mockResolvedValue({ running: false, last: null });
  api.getPlan.mockResolvedValue({ ok: true, plan: samplePlan });
  api.getAccounts.mockReset().mockResolvedValue({ accounts: [], debts: [], goals: [], currency: "USD", planOk: true });
  api.listMonths.mockReset().mockResolvedValue({ months: ["2026-09"], current: "2026-09" });
  api.getStreaks.mockReset().mockResolvedValue({ through: "2026-08", buckets: [{ id: "meals", name: "Meals", current: 2, best: 2 }], goals: [] });
  api.getMilestones.mockReset().mockResolvedValue({ undismissed: [], history: [] });
  api.getDebt.mockReset().mockRejectedValue(new Error("the sample plan has no debts"));
  api.getGoals.mockReset().mockResolvedValue({
    today: "2026-09-10",
    goals: [{ id: "bills", name: "Bills fund", balance: 150, balanceSource: "snapshot", balanceAsOf: "2026-09-10T08:00:00.000Z", nextBill: null, target: null }],
  });
  api.getMonth.mockReset().mockResolvedValue({
    month: "2026-09",
    daysInMonth: 30,
    daysElapsed: 10,
    closed: false,
    buckets: [{ id: "meals", name: "Meals", group: "living", planned: 600, posted: 150, pending: 0, expectedByToday: 200, pace: "on-pace", remaining: 450 }],
    income: { planned: 5000, received: 0, pending: 0 },
    savings: [],
    debts: [],
    uncategorizedCount: 0,
    totals: { planned: 600, posted: 150, pending: 0 },
  });
});

describe("App shell", () => {
  it("shows the nav with all four routes and the sync status", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const label of ["Overview", "Transactions", "Accounts", "Settings"]) {
      expect(nav).toContainElement(screen.getByRole("link", { name: label }));
    }
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText(/never synced/i)).toBeInTheDocument();
  });

  it("switches pages on hash navigation", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#/accounts";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a not-found page for an unknown route", async () => {
    window.location.hash = "#/nope";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the overview/i })).toHaveAttribute("href", "#/");
  });

  it("summarizes the last successful sync", async () => {
    api.getSyncStatus.mockResolvedValue({
      running: false,
      last: { id: 3, connector: "simplefin", startedAt: "2026-09-10T12:00:00.000Z", finishedAt: "2026-09-10T12:00:05.000Z", accountsN: 4, transactionsN: 120, error: null, requestedSince: null },
    });
    render(<App />);
    expect(await screen.findByText(/last sync .* 120 transactions across 4 accounts/i)).toBeInTheDocument();
  });

  it("surfaces a failed sync", async () => {
    api.getSyncStatus.mockResolvedValue({
      running: false,
      last: { id: 4, connector: "simplefin", startedAt: "2026-09-10T12:00:00.000Z", finishedAt: "2026-09-10T12:00:01.000Z", accountsN: 0, transactionsN: 0, error: "connector timed out", requestedSince: null },
    });
    render(<App />);
    expect(await screen.findByText(/last sync failed .*connector timed out/i)).toBeInTheDocument();
  });
});

describe("Overview", () => {
  it("shows the first-run card when there is no plan file", async () => {
    api.getPlan.mockResolvedValue({ ok: false, error: "plan_missing", path: "/srv/budget/data/plan.json", hint: "Copy plan.example.json to that path." });
    render(<App />);
    expect(await screen.findByRole("heading", { name: /set up your plan/i })).toBeInTheDocument();
    expect(screen.getByText("/srv/budget/data/plan.json")).toBeInTheDocument();
    expect(screen.getByText("data/plan.example.json")).toBeInTheDocument();
    expect(screen.getByText("Copy plan.example.json to that path.")).toBeInTheDocument();
  });

  it("lists validation issues when the plan file is invalid", async () => {
    api.getPlan.mockResolvedValue({ ok: false, error: "plan_invalid", path: "/srv/budget/data/plan.json", issues: [{ path: "buckets.0.planned", message: "expected number" }] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: /needs a fix/i })).toBeInTheDocument();
    expect(screen.getByText("buckets.0.planned: expected number")).toBeInTheDocument();
  });

  it("shows the month's bucket meters once the plan loads", async () => {
    render(<App />);
    expect(await screen.findByRole("meter", { name: "Meals" })).toBeInTheDocument();
    expect(api.getMonth).toHaveBeenCalledWith("2026-09");
    expect(await screen.findByRole("region", { name: "Savings goals" })).toBeInTheDocument();
    expect(api.getDebt).not.toHaveBeenCalled();
    expect(await screen.findByText("2-month streak")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Wins" })).toHaveTextContent(/No wins yet/);
  });

  it("reports a server failure", async () => {
    api.getPlan.mockRejectedValue(new Error("Failed to fetch"));
    render(<App />);
    expect(await screen.findByRole("heading", { name: /could not load the plan/i })).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
  });
});
