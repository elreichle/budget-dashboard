import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan, type Plan } from "../plan/schema.js";
import { monthSummary } from "./__fixtures__/progress.js";
import { closedMonthRange, computeStreaks, type Streak } from "./streaks.js";

const parsed = parsePlan(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/plan.example.json"), "utf8")));
if (!parsed.ok) throw new Error("example plan invalid");
const plan: Plan = parsed.plan;

const runs = (streaks: Streak[]) => Object.fromEntries(streaks.map((s) => [s.id, [s.current, s.best]]));

describe("closedMonthRange", () => {
  it("runs from the later of plan start and the first fully covered month through the month before today", () => {
    expect(closedMonthRange("2026-01", "2026-06-01", "2026-09-11")).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(closedMonthRange("2026-07", "2026-03-15", "2026-09-01")).toEqual(["2026-07", "2026-08"]);
    expect(closedMonthRange("2025-11", "2025-11-01", "2026-02-28")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("skips a first month whose history starts after the 1st", () => {
    expect(closedMonthRange("2026-01", "2026-05-20", "2026-09-11")).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(closedMonthRange("2026-01", "2026-12-02", "2027-02-01")).toEqual(["2027-01"]);
  });

  it("is empty with no transactions or no closed month yet", () => {
    expect(closedMonthRange("2026-01", undefined, "2026-09-11")).toEqual([]);
    expect(closedMonthRange("2026-01", "2026-09-01", "2026-09-11")).toEqual([]);
    expect(closedMonthRange("2026-01", "2026-08-02", "2026-09-11")).toEqual([]);
    expect(closedMonthRange("2026-10", "2026-01-01", "2026-09-11")).toEqual([]);
  });
});

describe("computeStreaks", () => {
  it("counts the run ending with the latest closed month and the best run, in month order", () => {
    const closedMonths = [
      monthSummary("2026-08", [["meals", 500, 400], ["rent", 1200, 1200]], [["rainy-day", 100, 50]]),
      monthSummary("2026-05", [["meals", 500, 450], ["rent", 1200, 1200]], [["rainy-day", 100, 100]]),
      monthSummary("2026-07", [["meals", 500, 300], ["rent", 1200, 1300]], [["rainy-day", 100, 120]]),
      monthSummary("2026-06", [["meals", 500, 900], ["rent", 1200, 1200]], [["rainy-day", 100, 0]]),
    ];
    const streaks = computeStreaks({ plan, closedMonths });
    expect(streaks.through).toBe("2026-08");
    expect(runs(streaks.buckets)).toMatchObject({ meals: [2, 2], rent: [1, 2], power: [0, 0] });
    expect(streaks.goals).toEqual([
      { id: "irregular-costs", name: "Irregular costs fund", current: 0, best: 0 },
      { id: "rainy-day", name: "Rainy day fund", current: 0, best: 1 },
    ]);
  });

  it("lists every plan bucket and goal at zero before any closed month", () => {
    const streaks = computeStreaks({ plan, closedMonths: [] });
    expect(streaks.through).toBeNull();
    expect(streaks.buckets.map((s) => s.id)).toEqual(plan.buckets.map((b) => b.id));
    expect(streaks.buckets.every((s) => s.current === 0 && s.best === 0)).toBe(true);
  });
});
