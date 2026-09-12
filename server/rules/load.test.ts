import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRule, loadRules, RulesFileError, rulesPath, writeRules } from "./load.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const plan = { buckets: [{ id: "meals" }, { id: "transit" }] };

describe("loadRules", () => {
  it("reads no rules from a missing file, without creating it", () => {
    expect(loadRules(dir)).toEqual({ ok: true, rules: { version: 1, rules: [] }, exists: false });
    expect(fs.existsSync(rulesPath(dir))).toBe(false);
  });

  it("reads and validates a file, checking buckets against the plan when given", () => {
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, rules: [{ match: "FARE", bucket: "transit" }, { match: "X", bucket: "yachts" }] }));
    expect(loadRules(dir)).toMatchObject({ ok: true, exists: true, rules: { rules: [{ match: "FARE", bucket: "transit" }, { bucket: "yachts" }] } });
    expect(loadRules(dir, plan)).toMatchObject({ ok: false, error: "rules_invalid", path: rulesPath(dir), issues: [{ path: "rules.1.bucket" }] });
  });

  it("reports invalid JSON as rules_invalid rather than throwing", () => {
    fs.writeFileSync(rulesPath(dir), "{ nope");
    expect(loadRules(dir)).toMatchObject({ ok: false, error: "rules_invalid", issues: [{ path: "", message: expect.stringContaining("Invalid JSON") }] });
  });
});

describe("appendRule", () => {
  it("creates the file (and the data dir) on first append, and appends after existing entries", () => {
    const nested = path.join(dir, "data");
    appendRule(nested, { match: "BUS FARE", bucket: "transit" });
    appendRule(nested, { match: "GROCERY", bucket: "meals", notes: "weekly" });
    const text = fs.readFileSync(rulesPath(nested), "utf8");
    expect(JSON.parse(text)).toEqual({ version: 1, rules: [{ match: "BUS FARE", bucket: "transit" }, { match: "GROCERY", bucket: "meals", notes: "weekly" }] });
    expect(text.endsWith("\n")).toBe(true);
  });

  it("preserves hand-written entries, their notes and unknown keys, and top-level extras", () => {
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, comment: "keep me", rules: [{ match: "RENT", bucket: "rent", notes: "monthly", weight: 3 }] }));
    const written = appendRule(dir, { match: "FARE", bucket: "transit" });
    expect(written).toEqual(JSON.parse(fs.readFileSync(rulesPath(dir), "utf8")));
    expect(written).toEqual({ version: 1, comment: "keep me", rules: [{ match: "RENT", bucket: "rent", notes: "monthly", weight: 3 }, { match: "FARE", bucket: "transit" }] });
  });

  it("refuses to overwrite an invalid file", () => {
    fs.writeFileSync(rulesPath(dir), "{ nope");
    expect(() => appendRule(dir, { match: "FARE", bucket: "transit" })).toThrow(RulesFileError);
    expect(fs.readFileSync(rulesPath(dir), "utf8")).toBe("{ nope");
  });

  it("writes through a temp file that is gone afterwards", () => {
    writeRules(dir, { version: 1, rules: [] });
    expect(fs.readdirSync(dir)).toEqual(["rules.json"]);
  });
});
