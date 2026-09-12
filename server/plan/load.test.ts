import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlanLoader, loadPlan, planPath } from "./load.js";

const examplePath = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const exampleText = fs.readFileSync(examplePath, "utf8");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePlan(text: string, mtime?: Date): void {
  const file = planPath(dir);
  fs.writeFileSync(file, text);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

describe("loadPlan", () => {
  it("returns plan_missing with a hint when the file is absent", () => {
    const r = loadPlan(dir);
    expect(r).toMatchObject({ ok: false, error: "plan_missing", path: planPath(dir) });
    if (!r.ok && r.error === "plan_missing") expect(r.hint).toContain("plan.example.json");
  });

  it("returns plan_invalid for a file that is not JSON", () => {
    writePlan("{ not json");
    const r = loadPlan(dir);
    expect(r).toMatchObject({ ok: false, error: "plan_invalid" });
    if (!r.ok && r.error === "plan_invalid") {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ path: "", message: expect.stringContaining("Invalid JSON") });
    }
  });

  it("returns plan_invalid with field paths for a schema violation", () => {
    const bad = { ...JSON.parse(exampleText), income: { netMonthly: -1, paychecksPerMonth: 1 } };
    writePlan(JSON.stringify(bad));
    const r = loadPlan(dir);
    expect(r).toMatchObject({ ok: false, error: "plan_invalid" });
    if (!r.ok && r.error === "plan_invalid") expect(r.issues.map((i) => i.path)).toEqual(["income.netMonthly"]);
  });

  it("returns the typed plan for the committed example", () => {
    writePlan(exampleText);
    const r = loadPlan(dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.income.netMonthly).toBe(4000);
  });

  it("rethrows filesystem errors other than a missing file", () => {
    fs.mkdirSync(planPath(dir)); // a directory where the file should be -> EISDIR
    expect(() => loadPlan(dir)).toThrow();
  });
});

describe("createPlanLoader", () => {
  it("serves the cached plan while the file content is unchanged", () => {
    writePlan(exampleText);
    const loader = createPlanLoader(dir);
    const first = loader.load();
    expect(first.ok).toBe(true);
    // Rewriting identical bytes (new mtime) still returns the cached object, not a fresh parse.
    writePlan(exampleText, new Date(Date.now() + 5000));
    expect(loader.load()).toBe(first);
  });

  it("re-parses when the content changes, even with the same mtime and length", () => {
    const stamp = new Date("2026-01-01T00:00:00Z");
    const base = JSON.parse(exampleText);
    base.income.netMonthly = 4000;
    writePlan(JSON.stringify(base), stamp);
    const loader = createPlanLoader(dir);
    const first = loader.load();
    const edited = JSON.parse(exampleText);
    edited.income.netMonthly = 4321; // same digit count => same byte length
    writePlan(JSON.stringify(edited), stamp);
    const second = loader.load();
    expect(second).not.toBe(first);
    if (second.ok) expect(second.plan.income.netMonthly).toBe(4321);
    else throw new Error("expected ok");
  });

  it("caches an invalid result until the file changes", () => {
    writePlan("{ nope");
    const loader = createPlanLoader(dir);
    const first = loader.load();
    expect(first).toMatchObject({ ok: false, error: "plan_invalid" });
    expect(loader.load()).toBe(first);
    writePlan(exampleText);
    expect(loader.load().ok).toBe(true);
  });

  it("drops the cache when the file is deleted, and reloads after it comes back", () => {
    writePlan(exampleText);
    const loader = createPlanLoader(dir);
    expect(loader.load().ok).toBe(true);
    fs.rmSync(planPath(dir));
    expect(loader.load()).toMatchObject({ ok: false, error: "plan_missing" });
    writePlan(exampleText);
    expect(loader.load().ok).toBe(true);
  });

});
