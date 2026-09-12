import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase, type Db } from "../db/index.js";
import { readSecrets, secretsPath } from "../secrets.js";
import { createServices } from "../services.js";

const HOST = "bridge.example.test";
const CLAIM_URL = `https://${HOST}/simplefin/claim/DEMO-CLAIM-TOKEN`;
const ACCESS_URL = "https://" + "demo-user:demo-pass" + `@${HOST}/simplefin`;
const setupToken = Buffer.from(CLAIM_URL, "utf8").toString("base64");

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "connectors-"));
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness(fetchImpl: typeof fetch) {
  const config = loadConfig({ DATA_DIR: dir });
  return createApp(config, createServices(config, { db, fetch: fetchImpl }));
}

const claim = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("SimpleFIN connection routes", () => {
  it("claims a setup token, stores the access URL and reports configured without echoing either", async () => {
    const impl = vi.fn(async () => new Response(ACCESS_URL, { status: 200 }));
    const app = harness(impl as unknown as typeof fetch);
    expect(await (await app.request("/api/connectors/simplefin")).json()).toEqual({ configured: false });

    const res = await app.request("/api/connectors/simplefin/claim", claim({ token: ` ${setupToken}\n` }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ configured: true });
    expect(text).not.toContain("demo-pass");
    expect(text).not.toContain(setupToken);
    expect(impl).toHaveBeenCalledWith(CLAIM_URL, expect.objectContaining({ method: "POST" }));
    expect(readSecrets(dir)).toEqual({ simplefin: { accessUrl: ACCESS_URL } });
    expect(await (await app.request("/api/connectors/simplefin")).json()).toEqual({ configured: true });
  });

  it("answers 400 for something that is not a setup token, without spending a request", async () => {
    const impl = vi.fn(async () => new Response(ACCESS_URL));
    const app = harness(impl as unknown as typeof fetch);
    const res = await app.request("/api/connectors/simplefin/claim", claim({ token: "not a token!!" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_setup_token");
    expect(impl).not.toHaveBeenCalled();
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });

  it("answers 422 when SimpleFIN refuses the token and 502 when its answer is unusable", async () => {
    const refused = harness((async () => new Response("already claimed", { status: 403 })) as typeof fetch);
    const res = await refused.request("/api/connectors/simplefin/claim", claim({ token: setupToken }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "claim_failed", message: expect.stringMatching(/rejected the setup token/) });

    const garbled = harness((async () => new Response("<html>oops</html>", { status: 200 })) as typeof fetch);
    const bad = await garbled.request("/api/connectors/simplefin/claim", claim({ token: setupToken }));
    expect(bad.status).toBe(502);
    expect((await bad.json()).error).toBe("claim_error");
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });

  it("answers 500 secrets_unreadable without spending the token when secrets.json is corrupt", async () => {
    fs.writeFileSync(secretsPath(dir), "{ nope");
    const fetchImpl = vi.fn(async () => new Response(ACCESS_URL));
    const res = await harness(fetchImpl as unknown as typeof fetch).request("/api/connectors/simplefin/claim", claim({ token: setupToken }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ error: "secrets_unreadable", message: expect.stringMatching(/reconnect SimpleFIN/i) });
    expect(body.message).not.toContain(dir);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    const app = harness((async () => new Response(ACCESS_URL)) as typeof fetch);
    for (const body of [{}, { token: "   " }, { token: 42 }]) {
      const res = await app.request("/api/connectors/simplefin/claim", claim(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_request");
    }
    const notJson = await app.request("/api/connectors/simplefin/claim", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(notJson.status).toBe(400);
  });
  it("refuses a claim that is not sent as JSON, so a cross-site simple POST cannot swap the connection", async () => {
    const impl = vi.fn(async () => new Response(ACCESS_URL));
    const app = harness(impl as unknown as typeof fetch);
    for (const headers of [{ "content-type": "text/plain" }, {}] as Record<string, string>[]) {
      const res = await app.request("/api/connectors/simplefin/claim", { method: "POST", body: JSON.stringify({ token: setupToken }), headers });
      expect(res.status).toBe(415);
      expect((await res.json()).error).toBe("unsupported_media_type");
    }
    expect(impl).not.toHaveBeenCalled();
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });
});
