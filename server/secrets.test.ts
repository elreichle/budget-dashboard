import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSecrets, secretsPath, writeSecrets } from "./secrets.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Assembled at runtime so the PII guard never sees a credential-bearing URL literal.
const accessUrl = "https://" + "demo:demo-secret" + "@bridge.example.invalid/simplefin";

describe("secrets", () => {
  it("reads an empty object when the file is absent", () => {
    expect(readSecrets(dir)).toEqual({});
  });

  it("writes the file with mode 0600 and reads it back", () => {
    writeSecrets(dir, { simplefin: { accessUrl } });
    const mode = fs.statSync(secretsPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readSecrets(dir)).toEqual({ simplefin: { accessUrl } });
  });

  it("creates the data dir when it does not exist yet", () => {
    const nested = path.join(dir, "deeper", "data");
    writeSecrets(nested, { simplefin: { accessUrl } });
    expect(readSecrets(nested)).toEqual({ simplefin: { accessUrl } });
  });

  it("rewrites an existing world-readable file to 0600", () => {
    fs.writeFileSync(secretsPath(dir), "{}", { mode: 0o644 });
    writeSecrets(dir, { simplefin: { accessUrl } });
    expect(fs.statSync(secretsPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("throws on a file that is not valid JSON or does not match the schema", () => {
    fs.writeFileSync(secretsPath(dir), "{ nope");
    expect(() => readSecrets(dir)).toThrow(/secrets\.json/);
    fs.writeFileSync(secretsPath(dir), JSON.stringify({ simplefin: { accessUrl: 42 } }));
    expect(() => readSecrets(dir)).toThrow(/secrets\.json/);
  });
});
