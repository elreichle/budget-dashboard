import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebtResponse, GoalsProgress } from "../api.js";
import { GoalsOverview } from "./GoalsOverview.js";
import { debtResponse, goal, plan, twoCards } from "./testData.js";

const api = vi.hoisted(() => ({
  getDebt: vi.fn<() => Promise<DebtResponse>>(),
  getGoals: vi.fn<() => Promise<GoalsProgress>>(),
}));
vi.mock("../api.js", () => api);

beforeEach(() => {
  api.getDebt.mockReset().mockResolvedValue(debtResponse(twoCards()));
  api.getGoals.mockReset().mockResolvedValue({ today: "2026-09-11", goals: [goal({ id: "bills", name: "Bills fund", balance: 120 })] });
});

describe("GoalsOverview", () => {
  it("loads debt payoff and savings goals", async () => {
    render(<GoalsOverview plan={plan()} />);
    expect(await screen.findByRole("region", { name: "Debt payoff" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Savings goals" })).toBeInTheDocument();
  });

  it("asks only for what the plan has", async () => {
    render(<GoalsOverview plan={plan({ debts: [], payoffStrategy: { order: [], totalMonthly: 0, rollover: false } })} />);
    expect(await screen.findByRole("region", { name: "Savings goals" })).toBeInTheDocument();
    expect(api.getDebt).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Debt payoff" })).not.toBeInTheDocument();
  });

  it("reports a section that fails to load and still shows the other", async () => {
    api.getGoals.mockRejectedValue(new Error("Cannot measure savings goals without a valid plan"));
    render(<GoalsOverview plan={plan()} />);
    expect(await screen.findByRole("heading", { name: "Could not load savings goals" })).toBeInTheDocument();
    expect(screen.getByText("Cannot measure savings goals without a valid plan")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Debt payoff" })).toBeInTheDocument();
  });
});
