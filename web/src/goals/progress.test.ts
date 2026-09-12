import { describe, expect, it } from "vitest";
import { aheadLabel, joinNames, monthsBetween, payoffOutlook, percentLabel } from "./progress.js";
import { debtProgress, debtResponse, twoCards } from "./testData.js";

describe("monthsBetween", () => {
  it("counts calendar months across a year boundary, signed", () => {
    expect(monthsBetween("2026-11", "2027-02")).toBe(3);
    expect(monthsBetween("2027-02", "2026-11")).toBe(-3);
    expect(monthsBetween("2026-11", "2026-11")).toBe(0);
  });
});

describe("payoffOutlook", () => {
  it("compares the live debt-free month with the plan's", () => {
    expect(payoffOutlook(debtResponse(twoCards()))).toEqual({ kind: "projected", month: "2027-06", monthsAhead: 2 });
    expect(payoffOutlook(debtResponse(twoCards(), { live: { debtFreeMonth: "2027-09" } }))).toEqual({ kind: "projected", month: "2027-09", monthsAhead: -1 });
    expect(payoffOutlook(debtResponse(twoCards(), { planned: { debtFreeMonth: null, neverPaysOff: true } }))).toEqual({ kind: "projected", month: "2027-06", monthsAhead: null });
  });

  it("uses the plan's own date until every card still owing has synced", () => {
    const unsynced = twoCards().map((d) => ({ ...d, balanceSource: "plan" as const, balanceAsOf: null, currentBalance: d.startingBalance }));
    expect(payoffOutlook(debtResponse(unsynced))).toEqual({ kind: "planned", month: "2027-08" });
    const [synced, notYet] = twoCards();
    expect(payoffOutlook(debtResponse([synced!, { ...notYet!, balanceSource: "plan", balanceAsOf: null }]))).toEqual({ kind: "planned", month: "2027-08" });
    expect(payoffOutlook(debtResponse([synced!, { ...notYet!, balanceSource: "plan", balanceAsOf: null, currentBalance: 0, percent: 100, paidOff: true }]))).toEqual({ kind: "projected", month: "2027-06", monthsAhead: 2 });
  });

  it("says when the payments never clear it, and when it is already gone", () => {
    expect(payoffOutlook(debtResponse(twoCards(), { live: { debtFreeMonth: null, neverPaysOff: true } }))).toEqual({ kind: "never" });
    const cleared = [debtProgress({ id: "card-a", name: "Card A", currentBalance: 0, percent: 100, paidOff: true })];
    expect(payoffOutlook(debtResponse(cleared, { live: { debtFreeMonth: null } }))).toEqual({ kind: "debt-free" });
  });
});

describe("labels", () => {
  it("words the schedule, rounds percent down, and joins names", () => {
    expect([aheadLabel(2), aheadLabel(1), aheadLabel(0), aheadLabel(-1), aheadLabel(-4)]).toEqual(["2 months ahead of plan", "1 month ahead of plan", "On schedule", "1 month behind plan", "4 months behind plan"]);
    expect([percentLabel(99.9), percentLabel(120), percentLabel(-3), percentLabel(42)]).toEqual(["99%", "100%", "0%", "42%"]);
    expect([joinNames(["A"]), joinNames(["A", "B"]), joinNames(["A", "B", "C"])]).toEqual(["A", "A and B", "A, B and C"]);
  });
});
