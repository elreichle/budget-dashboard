import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DebtPayoff } from "./DebtPayoff.js";
import { debtProgress, debtResponse, twoCards } from "./testData.js";

const stat = (label: string) => screen.getByText(label, { selector: "dt" }).closest("div")!;

describe("DebtPayoff", () => {
  it("draws each debt and the total from the starting balance down to zero", () => {
    const { container } = render(<DebtPayoff debt={debtResponse(twoCards())} currency="USD" />);
    const section = screen.getByRole("region", { name: "Debt payoff" });
    expect(within(section).getByRole("progressbar", { name: "All debt" })).toHaveAttribute("aria-valuenow", "16");
    const cardA = screen.getByRole("progressbar", { name: "Card A" });
    expect(cardA).toHaveAttribute("aria-valuenow", "25");
    const row = cardA.closest(".payoff-row")!;
    expect(row).toHaveTextContent("25% paid");
    expect(row).toHaveTextContent("Paid $1,200.00 so far");
    expect(row).toHaveTextContent("$3,000.00 left of $4,000");
    expect(container.textContent).not.toContain("!");
  });

  it("leads with the projected debt-free month, the schedule against the plan, and what was saved", () => {
    render(<DebtPayoff debt={debtResponse(twoCards())} currency="USD" />);
    expect(stat("Projected debt-free")).toHaveTextContent("June 2027");
    expect(stat("Projected debt-free")).toHaveTextContent("2 months ahead of plan");
    expect(stat("Paid so far")).toHaveTextContent("$2,100.00");
    expect(stat("Interest saved so far")).toHaveTextContent("$100.00");
    expect(screen.queryByText(/not synced/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated/i)).not.toBeInTheDocument();
  });

  it("labels interest saved as an estimate for a synced card with no interest rows, naming it when another card has rows", () => {
    const { rerender } = render(<DebtPayoff debt={debtResponse(twoCards().map((d) => ({ ...d, interestSource: "estimate" as const })))} currency="USD" />);
    expect(stat("Interest saved so far")).toHaveTextContent("Estimated from balance changes until interest charges are filed as Interest.");
    rerender(<DebtPayoff debt={debtResponse([debtProgress({ id: "card-a", name: "Card A", interestSource: "estimate" }), debtProgress({ id: "card-b", name: "Card B" })])} currency="USD" />);
    expect(stat("Interest saved so far")).toHaveTextContent("Card A: estimated from balance changes until its interest charges are filed as Interest.");
  });

  it("before any card syncs, shows the plan's starting balances and planned date and says so", () => {
    const unsynced = twoCards().map((d) => ({ ...d, balanceSource: "plan" as const, balanceAsOf: null, currentBalance: d.startingBalance, paidSoFar: 0, percent: 0, interestSavedSoFar: 0, interestSource: "estimate" as const }));
    render(<DebtPayoff debt={debtResponse(unsynced)} currency="USD" />);
    expect(stat("Planned debt-free")).toHaveTextContent("August 2027");
    expect(screen.getByText("No card balance has synced yet, so these are the plan's starting balances and its debt-free date.")).toBeInTheDocument();
    expect(screen.queryByText(/ahead of plan|behind plan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Card B" }).closest(".payoff-row")).toHaveTextContent("$6,000.00 left of $6,000");
  });

  it("names a card that has not synced, falls back to the planned date, and marks a paid-off card", () => {
    const debts = [
      debtProgress({ id: "card-a", name: "Card A", currentBalance: 0, percent: 100, paidOff: true }),
      debtProgress({ id: "card-b", name: "Card B", startingBalance: 6000, currentBalance: 6000, balanceSource: "plan", balanceAsOf: null, paidSoFar: 0, percent: 0 }),
    ];
    render(<DebtPayoff debt={debtResponse(debts)} currency="USD" />);
    expect(screen.getByText("Card B has not synced yet, so it shows its plan starting balance and the debt-free date is the plan's.")).toBeInTheDocument();
    expect(stat("Planned debt-free")).toHaveTextContent("August 2027");
    expect(screen.getByRole("progressbar", { name: "Card A" }).closest(".payoff-row")).toHaveTextContent("Paid off");
  });

  it("says plainly when the payments never clear the debt, and skips the total for a single debt", () => {
    render(<DebtPayoff debt={debtResponse([debtProgress({ id: "card-a", name: "Card A" })], { live: { debtFreeMonth: null, neverPaysOff: true } })} currency="USD" />);
    expect(stat("Projected debt-free")).toHaveTextContent("Not at current payments");
    expect(screen.queryByRole("progressbar", { name: "All debt" })).not.toBeInTheDocument();
  });
});
