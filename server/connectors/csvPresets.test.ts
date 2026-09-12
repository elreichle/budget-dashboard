import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_PRESETS_FILENAME, loadCsvPresets } from "./csvPresets.js";
import { CSV_TEMPLATES } from "./csvTemplates.js";

/** A fresh temp data dir; `contents` (a string is written as-is) becomes its presets file. */
function dataDir(contents?: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csv-presets-"));
  if (contents !== undefined) writeFileSync(path.join(dir, CSV_PRESETS_FILENAME), typeof contents === "string" ? contents : JSON.stringify(contents));
  return dir;
}

describe("loadCsvPresets", () => {
  it("offers every template under its own name when there is no presets file", () => {
    const r = loadCsvPresets(dataDir());
    expect(r).toMatchObject({ ok: true, source: "templates" });
    expect(r.ok && r.presets.map((p) => p.name)).toEqual(Object.keys(CSV_TEMPLATES));
    expect(r.ok && r.presets[0]).toEqual({ name: Object.keys(CSV_TEMPLATES)[0], ...Object.values(CSV_TEMPLATES)[0] });
  });

  it("offers only the file's presets, in file order, each its template with the entry's fields replacing the template's", () => {
    const split = { kind: "split", debit: ["Debit"], credit: ["Credit"] };
    const r = loadCsvPresets(
      dataDir({
        version: 1,
        presets: {
          "travel-card": { template: "generic", label: "Travel card", institution: "Example Card Co", accountType: "credit", date: ["Posted"], amount: split },
          everyday: { template: "generic" },
        },
      }),
    );
    expect(r).toMatchObject({ ok: true, source: "file" });
    if (!r.ok) return;
    expect(r.presets.map((p) => p.name)).toEqual(["travel-card", "everyday"]);
    expect(r.presets[0]).toEqual({ ...CSV_TEMPLATES.generic, name: "travel-card", label: "Travel card", institution: "Example Card Co", accountType: "credit", date: ["Posted"], amount: split });
    expect(r.presets[1]).toEqual({ name: "everyday", ...CSV_TEMPLATES.generic });
  });

  it("rejects bad JSON, unknown templates and keys, bad names, an empty list and a wrong version, naming the file", () => {
    const cases: [unknown, RegExp][] = [
      ["{not json", /Invalid JSON/],
      [{ version: 1, presets: { card: { template: "nope" } } }, /unknown template/],
      [{ version: 1, presets: { card: { template: "generic", descripton: ["Memo"] } } }, /descripton/],
      [{ version: 1, presets: { "My Card": { template: "generic" } } }, /lower-case letters/],
      [{ version: 1, presets: {} }, /at least one preset/],
      [{ version: 2, presets: { card: { template: "generic" } } }, /version/],
      [{ version: 1, presets: { card: { template: "generic", amount: { kind: "split", debit: ["Out"] } } } }, /amount/],
    ];
    for (const [contents, expected] of cases) {
      const dir = dataDir(contents);
      const r = loadCsvPresets(dir);
      expect(r.ok, String(expected)).toBe(false);
      if (r.ok) continue;
      expect(r).toMatchObject({ error: "csv_presets_invalid", path: path.join(dir, CSV_PRESETS_FILENAME) });
      expect(r.issues.map((i) => `${i.path} ${i.message}`).join("; ")).toMatch(expected);
    }
  });
});
