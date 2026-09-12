import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("app", () => {
  it("answers the health check and opens the database under DATA_DIR", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-"));
    const config = loadConfig({ PORT: "1", DATA_DIR: dir });
    const app = createApp(config, createServices(config));
    expect(fs.existsSync(path.join(dir, "budget.db"))).toBe(true);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("answers an unknown /api path or method with a JSON 404 instead of the dashboard", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-"));
    const config = loadConfig({ PORT: "1", DATA_DIR: dir });
    const app = createApp(config, createServices(config));
    const cases: [string, string][] = [
      ["GET", "/api/nope"],
      ["GET", "/api/sync/nope/deeper"],
      ["POST", "/api/health"],
      ["DELETE", "/api/plan"],
      ["GET", "/api"],
    ];
    for (const [method, url] of cases) {
      const res = await app.request(url, { method });
      expect(res.status, `${method} ${url}`).toBe(404);
      expect(await res.json(), `${method} ${url}`).toEqual({ error: "not_found" });
    }
  });
});

describe("loadConfig", () => {
  it("uses defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(8420);
    expect(c.syncIntervalMinutes).toBe(60);
    expect(c.dataDir.endsWith("/data")).toBe(true);
  });
  it("rejects a bad port", () => {
    expect(() => loadConfig({ PORT: "nope" })).toThrow(/PORT/);
  });
  it("listens on 127.0.0.1 with no extra hosts by default", () => {
    const c = loadConfig({});
    expect(c.host).toBe("127.0.0.1");
    expect(c.allowedHosts).toEqual([]);
  });
  it("reads HOST and a comma-separated ALLOWED_HOSTS", () => {
    const c = loadConfig({ HOST: "0.0.0.0", ALLOWED_HOSTS: " Budget.lan, server.home.arpa:8420 ,," });
    expect(c.host).toBe("0.0.0.0");
    expect(c.allowedHosts).toEqual(["budget.lan", "server.home.arpa"]);
  });
  it("takes HOST only as an IP address or localhost", () => {
    expect(loadConfig({ HOST: "::1" }).host).toBe("::1");
    expect(loadConfig({ HOST: "localhost" }).host).toBe("localhost");
    expect(() => loadConfig({ HOST: "workstation" })).toThrow(/HOST/);
  });
  it("rejects an ALLOWED_HOSTS entry that is not a host", () => {
    expect(() => loadConfig({ ALLOWED_HOSTS: "http://budget.lan/" })).toThrow(/ALLOWED_HOSTS/);
  });
});
