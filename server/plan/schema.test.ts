import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan, PlanSchema } from "./schema.js";

const examplePath = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const example = JSON.parse(fs.readFileSync(examplePath, "utf8")) as Record<string, unknown>;

/** Deep copy of the committed example so each test can mutate its own instance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests poke arbitrary invalid values into the tree
function plan(): Record<string, any> {
  return structuredClone(example);
}

function issuePaths(input: unknown): string[] {
  const r = parsePlan(input);
  return r.ok ? [] : r.issues.map((i) => i.path);
}

describe("PlanSchema", () => {
  it("accepts data/plan.example.json", () => {
    const r = parsePlan(example);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.buckets.map((b) => b.id)).toContain("meals");
      expect(r.plan.payoffStrategy.order).toEqual(["card-a", "card-b", "card-c"]);
    }
  });

  it("reports the path of a wrong-typed field", () => {
    const p = plan();
    p.buckets[1].planned = "two hundred";
    expect(issuePaths(p)).toEqual(["buckets.1.planned"]);
  });

  it("rejects duplicate bucket ids", () => {
    const p = plan();
    p.buckets[2].id = p.buckets[0].id;
    const r = parsePlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "buckets.2.id", message: expect.stringContaining("duplicate") }]);
  });

  it("rejects bucket ids that start with the reserved underscore", () => {
    const p = plan();
    p.buckets[0].id = "_transfer";
    expect(issuePaths(p)).toEqual(["buckets.0.id"]);
  });

  it("rejects payoff order ids that are not debts", () => {
    const p = plan();
    p.payoffStrategy.order = ["card-a", "card-z"];
    const r = parsePlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "payoffStrategy.order.1", message: expect.stringContaining("card-z") }]);
  });

  it("rejects a debt listed twice in the payoff order", () => {
    const p = plan();
    p.payoffStrategy.order = ["card-a", "card-a"];
    expect(issuePaths(p)).toEqual(["payoffStrategy.order.1"]);
  });

  it("rejects malformed months, dates and APRs", () => {
    const p = plan();
    p.planStartMonth = "2026-13";
    p.savingsGoals[0].items[0].nextDue = "06/30/2026";
    p.debts[0].segments[0].apr = 25;
    expect(issuePaths(p).sort()).toEqual(
      ["debts.0.segments.0.apr", "planStartMonth", "savingsGoals.0.items.0.nextDue"].sort(),
    );
  });

  it("allows a nullable savings target and optional notes", () => {
    const p = plan();
    delete p.buckets[0].notes;
    p.savingsGoals[1].targetBalance = null;
    expect(PlanSchema.safeParse(p).success).toBe(true);
  });

  it("rejects calendar-impossible dates", () => {
    const p = plan();
    p.debts[0].asOf = "2026-02-30";
    expect(issuePaths(p)).toEqual(["debts.0.asOf"]);
    p.debts[0].asOf = "2024-02-29";
    expect(issuePaths(p)).toEqual([]);
  });

  it("rejects an unsupported version", () => {
    const p = plan();
    p.version = 2;
    expect(issuePaths(p)).toEqual(["version"]);
  });
});
