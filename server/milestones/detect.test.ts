import { describe, expect, it } from "vitest";
import { debtProgress, goalProgress, monthSummary } from "./__fixtures__/progress.js";
import type { Account } from "../db/accounts.js";
import type { Transaction } from "../db/transactions.js";
import { detectMilestones, isSettled, parseKey, type DetectInput, type SettleInput } from "./detect.js";

const keys = (input: Partial<DetectInput>) => detectMilestones({ settledMonths: [], debts: [], goals: [], ...input }).map((m) => `${m.kind}:${m.key}`);

describe("detectMilestones", () => {
  it("a closed month's bucket at or under a non-zero plan is month-under-plan, keyed bucket:month", () => {
    const settledMonths = [monthSummary("2026-07", [["meals", 500, 500], ["fun", 150, 150.01], ["retired", 0, 0], ["transit", 80, -10]])];
    expect(keys({ settledMonths })).toEqual(["month-under-plan:meals:2026-07", "month-under-plan:transit:2026-07"]);
  });

  it("an open month never counts", () => {
    expect(keys({ settledMonths: [monthSummary("2026-09", [["meals", 500, 0]], [["rainy-day", 100, 100]], false)] })).toEqual([]);
  });

  it("savings-month-met once a closed month's contributions reach a non-zero monthly", () => {
    const settledMonths = [monthSummary("2026-08", [], [["rainy-day", 100, 100], ["trip", 300, 299.99], ["idle", 0, 50]])];
    expect(keys({ settledMonths })).toEqual(["savings-month-met:rainy-day:2026-08"]);
  });

  it("debt-halfway at half the starting balance and debt-paid at zero, from synced balances only", () => {
    const debts = [debtProgress("a", 1000, 500), debtProgress("b", 1000, 500.01), debtProgress("c", 1000, 0), debtProgress("d", 1000, 0, "plan")];
    expect(keys({ debts })).toEqual(["debt-halfway:a", "debt-halfway:c", "debt-paid:c"]);
  });

  it("buffer-target-met once a synced balance reaches a non-zero target", () => {
    const goals = [goalProgress("buffer", 1000, 1000), goalProgress("short", 999.99, 1000), goalProgress("fund", 5000, null), goalProgress("unsynced", 1000, 1000, "none"), goalProgress("zero", 0, 0)];
    expect(keys({ goals })).toEqual(["buffer-target-met:buffer"]);
  });
});

describe("parseKey", () => {
  it("splits the month off a monthly key, even when the subject id holds a colon", () => {
    expect(parseKey("month-under-plan", "a:b:2026-10")).toEqual({ subjectId: "a:b", month: "2026-10" });
    expect(parseKey("savings-month-met", "rainy-day:2026-08")).toEqual({ subjectId: "rainy-day", month: "2026-08" });
    expect(parseKey("debt-paid", "card:a")).toEqual({ subjectId: "card:a", month: null });
  });
});

describe("isSettled", () => {
  const august = monthSummary("2026-08", [["meals", 500, 100]]);
  const accounts: Pick<Account, "id" | "role">[] = [{ id: 1, role: "checking" }, { id: 2, role: null }, { id: 3, role: "ignore" }];
  const row = (accountId: number, date: string, pending = false): Pick<Transaction, "accountId" | "date" | "pending"> => ({ accountId, date, pending });
  const settled = (over: Partial<SettleInput>) => isSettled({ summary: august, transactions: [], accounts, today: "2026-09-04", ...over });

  it("waits SETTLE_DAYS into the next month", () => {
    expect(settled({ today: "2026-08-31" })).toBe(false);
    expect(settled({ today: "2026-09-03" })).toBe(false);
    expect(settled({ today: "2026-09-04" })).toBe(true);
    expect(settled({ today: "2027-01-01" })).toBe(true);
  });

  it("is held open by a pending row, a row awaiting review, or a row on an account with no role", () => {
    expect(settled({ transactions: [row(1, "2026-08-30")] })).toBe(true);
    expect(settled({ transactions: [row(1, "2026-08-30", true)] })).toBe(false);
    expect(settled({ transactions: [row(2, "2026-08-30")] })).toBe(false);
    expect(settled({ summary: { ...august, uncategorizedCount: 1 } })).toBe(false);
    expect(settled({ transactions: [row(3, "2026-08-30", true), row(2, "2026-09-01", true), row(1, "2026-07-31", true)] })).toBe(true);
  });
});
