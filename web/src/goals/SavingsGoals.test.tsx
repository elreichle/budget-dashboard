import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SavingsGoals } from "./SavingsGoals.js";
import { goal } from "./testData.js";

const row = (name: string) => screen.getByRole("listitem", { name });

describe("SavingsGoals", () => {
  it("measures a sinking fund against what the next bill needs, with its date", () => {
    render(<SavingsGoals goals={[goal({ id: "bills", name: "Bills fund", balance: 250, nextBill: { names: ["Laptop"], amount: 400, date: "2026-10-20", percent: 62.5 } })]} currency="USD" />);
    expect(screen.getByRole("region", { name: "Savings goals" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Bills fund: next bill" })).toHaveAttribute("aria-valuenow", "62.5");
    expect(row("Bills fund")).toHaveTextContent("$250.00");
    expect(row("Bills fund")).toHaveTextContent("$400 needed by Oct 20, 2026 for Laptop");
    expect(row("Bills fund")).toHaveTextContent("$150.00 to go");
  });

  it("measures a buffer against its target with a percent", () => {
    render(<SavingsGoals goals={[goal({ id: "buffer", name: "Buffer", balance: 500, target: { amount: 1000, percent: 50 } })]} currency="USD" />);
    expect(screen.getByRole("progressbar", { name: "Buffer: target" })).toHaveAttribute("aria-valuenow", "50");
    expect(row("Buffer")).toHaveTextContent("$500.00 of $1,000 target");
    expect(row("Buffer")).toHaveTextContent("50%");
    expect(screen.queryByRole("progressbar", { name: "Buffer: next bill" })).not.toBeInTheDocument();
  });

  it("badges a goal's streak of months met without renaming the goal", () => {
    render(<SavingsGoals goals={[goal({ id: "bills", name: "Bills fund" }), goal({ id: "buffer", name: "Buffer" })]} streaks={[{ id: "bills", name: "Bills fund", current: 2, best: 2 }]} currency="USD" />);
    expect(row("Bills fund")).toHaveTextContent("2-month streak");
    expect(row("Buffer")).not.toHaveTextContent("streak");
  });

  it("marks covered bills and reached targets, and says when nothing has synced or the plan sets nothing", () => {
    render(
      <SavingsGoals
        goals={[
          goal({ id: "bills", name: "Bills fund", balance: 1500, nextBill: { names: ["Holiday travel", "Laptop"], amount: 1400, date: "2027-01-15", percent: 100 }, target: { amount: 1000, percent: 100 } }),
          goal({ id: "fresh", name: "Fresh goal", balanceSource: "none", balanceAsOf: null }),
        ]}
        currency="USD"
      />,
    );
    expect(row("Bills fund")).toHaveTextContent("$1,400 needed by Jan 15, 2027 for Holiday travel and LaptopCovered");
    expect(row("Bills fund")).toHaveTextContent("Target reached");
    expect(row("Fresh goal")).toHaveTextContent("No linked savings account has synced yet.");
    expect(row("Fresh goal")).toHaveTextContent("The plan sets no bill or target for this goal.");
  });
});
