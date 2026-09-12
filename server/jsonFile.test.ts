import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonText, readJsonFile, writeJsonFileAtomic } from "./jsonFile.js";

const Schema = z.object({ version: z.literal(1), items: z.array(z.object({ n: z.number() })) });

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-file-"));
  file = path.join(dir, "thing.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readJsonFile", () => {
  it("reports a missing file without creating it", () => {
    expect(readJsonFile(file, Schema)).toEqual({ ok: false, error: "missing" });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports text that is not JSON with the parser's message, also as one root issue", () => {
    fs.writeFileSync(file, "{ nope");
    const r = readJsonFile(file, Schema);
    if (r.ok || r.error !== "invalid_json") throw new Error(`expected invalid_json, got ${JSON.stringify(r)}`);
    expect(r.message).not.toBe("");
    expect(r.issues).toEqual([{ path: "", message: `Invalid JSON: ${r.message}` }]);
  });

  it("reports every schema violation with a dotted path", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2, items: [{ n: 1 }, { n: "two" }] }));
    const r = readJsonFile(file, Schema);
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    if (!r.ok && r.error === "invalid") expect(r.issues.map((i) => i.path)).toEqual(["version", "items.1.n"]);
  });

  it("returns the validated value", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ n: 3 }] }));
    expect(readJsonFile(file, Schema)).toEqual({ ok: true, value: { version: 1, items: [{ n: 3 }] } });
  });

  it("rethrows filesystem errors other than a missing file", () => {
    fs.mkdirSync(file); // a directory where the file should be -> EISDIR
    expect(() => readJsonFile(file, Schema)).toThrow();
  });
});

describe("parseJsonText", () => {
  it("validates text already read, like readJsonFile", () => {
    expect(parseJsonText('{"version":1,"items":[]}', Schema)).toEqual({ ok: true, value: { version: 1, items: [] } });
    expect(parseJsonText("[", Schema)).toMatchObject({ ok: false, error: "invalid_json" });
  });
});

describe("writeJsonFileAtomic", () => {
  it("creates the directory, writes indented JSON with a trailing newline, and leaves no temp file", () => {
    const nested = path.join(dir, "deeper", "data", "thing.json");
    writeJsonFileAtomic(nested, { version: 1, items: [{ n: 1 }] });
    expect(fs.readFileSync(nested, "utf8")).toBe(JSON.stringify({ version: 1, items: [{ n: 1 }] }, null, 2) + "\n");
    expect(fs.readdirSync(path.dirname(nested))).toEqual(["thing.json"]);
    expect(readJsonFile(nested, Schema)).toMatchObject({ ok: true });
  });

  it("sets the mode even when replacing a file that had another", () => {
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    writeJsonFileAtomic(file, { version: 1, items: [] }, { mode: 0o600 });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("removes the temp file and rethrows when the rename fails", () => {
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "child"), "x"); // a non-empty directory cannot be replaced by a file
    expect(() => writeJsonFileAtomic(file, { version: 1, items: [] })).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["thing.json"]);
  });
});
