import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan, type Plan } from "../plan/schema.js";
import { isKnownBucket, parseRules, RESERVED_BUCKET_IDS } from "./schema.js";

const examplePlan = (): Plan => {
  const r = parsePlan(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/plan.example.json"), "utf8")));
  if (!r.ok) throw new Error("plan.example.json does not validate");
  return r.plan;
};
const exampleRules = () => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/rules.example.json"), "utf8")) as unknown;

describe("parseRules", () => {
  it("accepts data/rules.example.json, also against the example plan's buckets", () => {
    expect(parseRules(exampleRules())).toMatchObject({ ok: true });
    expect(parseRules(exampleRules(), examplePlan())).toMatchObject({ ok: true });
  });

  it("rejects a blank match, an empty bucket and a wrong version with paths", () => {
    const r = parseRules({ version: 2, rules: [{ match: "   ", bucket: "" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["version", "rules.0.match", "rules.0.bucket"]));
  });

  it("with a plan, rejects a bucket that is neither in the plan nor reserved", () => {
    const r = parseRules({ version: 1, rules: [{ match: "A", bucket: "meals" }, { match: "B", bucket: "_income" }, { match: "C", bucket: "yachts" }] }, examplePlan());
    expect(r).toMatchObject({ ok: false, issues: [{ path: "rules.2.bucket", message: expect.stringContaining('unknown bucket "yachts"') }] });
  });

  it("keeps keys it does not know so a rewrite loses nothing", () => {
    const r = parseRules({ version: 1, comment: "mine", rules: [{ match: "A", bucket: "meals", notes: "n", priority: 9 }] });
    expect(r).toMatchObject({ ok: true, rules: { comment: "mine", rules: [{ notes: "n", priority: 9 }] } });
  });

  it("isKnownBucket covers plan buckets and every reserved id", () => {
    const plan = examplePlan();
    expect(isKnownBucket("meals", plan)).toBe(true);
    for (const id of RESERVED_BUCKET_IDS) expect(isKnownBucket(id, plan)).toBe(true);
    expect(isKnownBucket("_other", plan)).toBe(false);
  });
});
