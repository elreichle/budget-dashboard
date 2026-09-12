import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan } from "../plan/schema.js";
import { goalProgress, nextDueDate } from "./progress.js";

const parsed = parsePlan(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/plan.example.json"), "utf8")));
if (!parsed.ok) throw new Error("example plan does not validate");
const example = parsed.plan;

describe("nextDueDate", () => {
  it("keeps a date still to come, including today", () => {
    expect(nextDueDate({ nextDue: "2026-10-01", timesPerYear: 2 }, "2026-09-11")).toBe("2026-10-01");
    expect(nextDueDate({ nextDue: "2026-09-11", timesPerYear: 2 }, "2026-09-11")).toBe("2026-09-11");
  });

  it("rolls a past date forward by whole billing periods", () => {
    expect(nextDueDate({ nextDue: "2026-04-01", timesPerYear: 2 }, "2026-09-11")).toBe("2026-10-01");
    expect(nextDueDate({ nextDue: "2023-06-30", timesPerYear: 2 }, "2026-09-11")).toBe("2026-12-30");
    expect(nextDueDate({ nextDue: "2025-03-15", timesPerYear: 1 }, "2026-03-16")).toBe("2027-03-15");
  });

  it("keeps the day of the month, clamped in shorter months without drifting", () => {
    expect(nextDueDate({ nextDue: "2026-01-31", timesPerYear: 12 }, "2026-02-10")).toBe("2026-02-28");
    expect(nextDueDate({ nextDue: "2026-01-31", timesPerYear: 12 }, "2026-03-01")).toBe("2026-03-31");
  });
});

describe("goalProgress", () => {
  it("measures the sinking fund against its next bill and the buffer against its target", () => {
    const at = "2026-09-10T08:00:00.000Z";
    const result = goalProgress({ plan: example, today: "2026-09-11", snapshots: [{ goalIds: ["irregular-costs", "rainy-day"], balance: 2000, at }] });
    expect(result).toEqual({
      today: "2026-09-11",
      goals: [
        { id: "irregular-costs", name: "Irregular costs fund", balance: 1500, balanceSource: "snapshot", balanceAsOf: at, nextBill: { names: ["Bike repair"], amount: 60, date: "2026-10-01", percent: 100 }, target: null },
        { id: "rainy-day", name: "Rainy day fund", balance: 500, balanceSource: "snapshot", balanceAsOf: at, nextBill: null, target: { amount: 1000, percent: 50 } },
      ],
    });
  });

  it("adds up linked accounts, keeps the newest reading, and sums bills due the same day", () => {
    const [fund] = example.savingsGoals;
    const plan = {
      ...example,
      savingsGoals: [
        {
          ...fund!,
          items: [
            { name: "Holiday travel", perBill: 1000, timesPerYear: 1, nextDue: "2025-10-01" },
            { name: "Bike repair", perBill: 60, timesPerYear: 4, nextDue: "2026-07-01" },
            { name: "Domain renewal", perBill: 100, timesPerYear: 1, nextDue: "2026-11-15" },
          ],
        },
      ],
    };
    const result = goalProgress({
      plan,
      today: "2026-09-11",
      snapshots: [
        { goalIds: ["irregular-costs"], balance: 300, at: "2026-09-09T08:00:00.000Z" },
        { goalIds: ["irregular-costs"], balance: 400, at: "2026-09-01T08:00:00.000Z" },
      ],
    });
    expect(result.goals).toEqual([
      expect.objectContaining({ balance: 700, balanceAsOf: "2026-09-09T08:00:00.000Z", nextBill: { names: ["Holiday travel", "Bike repair"], amount: 1060, date: "2026-10-01", percent: 66 } }),
    ]);
  });

  it("never rounds a goal that is a few cents short up to 100%", () => {
    const at = "2026-09-10T08:00:00.000Z";
    const result = goalProgress({
      plan: example,
      today: "2026-09-11",
      snapshots: [
        { goalIds: ["irregular-costs"], balance: 59.99, at },
        { goalIds: ["rainy-day"], balance: 999.5, at },
      ],
    });
    expect(result.goals[0]!.nextBill!.percent).toBe(99.9);
    expect(result.goals[1]!.target!.percent).toBe(99.9);
  });

  it("starts a goal with no synced account at zero, ignoring accounts linked to goals the plan lacks", () => {
    const result = goalProgress({ plan: example, today: "2026-09-11", snapshots: [{ goalIds: ["gone"], balance: 900, at: "2026-09-10T08:00:00.000Z" }] });
    expect(result.goals).toEqual([
      expect.objectContaining({ id: "irregular-costs", balance: 0, balanceSource: "none", balanceAsOf: null, nextBill: expect.objectContaining({ percent: 0 }) }),
      expect.objectContaining({ id: "rainy-day", balance: 0, balanceSource: "none", target: { amount: 1000, percent: 0 } }),
    ]);
  });
});
