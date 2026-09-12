import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "../sync/__fixtures__/fakeConnector.js";
import { crossSiteGuard, hostForAddress, hostGuard, hostnameOf } from "./guards.js";

function guarded(allowedHosts: string[] = []) {
  const app = new Hono();
  app.use("/api/*", hostGuard(allowedHosts));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

const withHost = (app: Hono, host: string, url = "/api/ping") => app.request(url, { headers: { host } });

describe("hostGuard", () => {
  it("lets the loopback names through, with or without a port", async () => {
    for (const host of ["localhost", "localhost:8420", "LOCALHOST:8420", "127.0.0.1:8420", "[::1]:8420"]) {
      expect((await withHost(guarded(), host)).status, host).toBe(200);
    }
  });

  it("refuses a foreign Host, as a DNS-rebinding page sends it", async () => {
    const res = await withHost(guarded(), "rebind.example.com:8420");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_host" });
  });

  it("refuses look-alikes of the loopback names and values that are not a host", async () => {
    for (const host of ["localhost.example.com", "127.0.0.1.example.com", "localhost.", "localhost/api", ""]) {
      expect((await withHost(guarded(), host)).status, host).toBe(403);
    }
  });

  it("lets through a host listed in ALLOWED_HOSTS, whatever its case or port", async () => {
    const app = guarded(loadConfig({ ALLOWED_HOSTS: "Budget.lan" }).allowedHosts);
    expect((await withHost(app, "budget.lan:8420")).status).toBe(200);
    expect((await withHost(app, "BUDGET.LAN")).status).toBe(200);
    expect((await withHost(app, "other.lan")).status).toBe(403);
  });

  it("reads the request URL when there is no Host header", async () => {
    expect((await guarded().request("/api/ping")).status).toBe(200);
    expect((await guarded().request("http://rebind.example.com/api/ping")).status).toBe(403);
  });
});

const LOCAL = "localhost:8420";
const sameOrigin = { host: LOCAL, origin: `http://${LOCAL}`, "sec-fetch-site": "same-origin" };
const crossSite = { host: LOCAL, origin: "https://evil.example.com", "sec-fetch-site": "cross-site" };

function crossSiteGuarded() {
  const app = new Hono();
  app.use("/api/*", crossSiteGuard());
  app.on(["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"], "/api/thing", (c) => c.json({ ok: true }));
  return app;
}

const send = (method: string, headers: Record<string, string>) => crossSiteGuarded().request("/api/thing", { method, headers });

describe("crossSiteGuard", () => {
  it("lets a state change with neither Sec-Fetch-Site nor Origin through, as curl sends it", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect((await send(method, { host: LOCAL })).status, method).toBe(200);
    }
  });

  it("refuses a state change the browser marks as not same-origin", async () => {
    for (const site of ["cross-site", "same-site", "Cross-Site"]) {
      const res = await send("POST", { host: LOCAL, "sec-fetch-site": site });
      expect(res.status, site).toBe(403);
      expect(await res.json()).toEqual({ error: "cross_site" });
    }
    for (const site of ["same-origin", "none"]) {
      expect((await send("POST", { host: LOCAL, "sec-fetch-site": site })).status, site).toBe(200);
    }
  });

  it("refuses an Origin whose host or port differs from Host, and an opaque one", async () => {
    for (const origin of ["https://evil.example.com", "http://localhost:5173", "http://localhost.example.com:8420", "null", "not a url"]) {
      expect((await send("PATCH", { host: LOCAL, origin })).status, origin).toBe(403);
    }
    expect((await send("PATCH", { ...sameOrigin, origin: "https://evil.example.com" })).status).toBe(403);
    expect((await send("PATCH", { host: "localhost/api", origin: "http://localhost" })).status).toBe(403);
  });

  it("lets an Origin through that names the Host, whatever its case or default port", async () => {
    for (const [host, origin] of [[LOCAL, `http://${LOCAL}`], ["Budget.lan:8420", "http://budget.lan:8420"], ["budget.lan", "http://budget.lan"], ["budget.lan:80", "http://budget.lan"], ["[::1]:8420", "http://[::1]:8420"]]) {
      expect((await send("POST", { host, origin, "sec-fetch-site": "same-origin" })).status, `${host} ${origin}`).toBe(200);
    }
  });

  it("reads the request URL when there is no Host header", async () => {
    const app = crossSiteGuarded();
    expect((await app.request("http://budget.lan/api/thing", { method: "POST", headers: { origin: "http://budget.lan" } })).status).toBe(200);
    expect((await app.request("http://budget.lan/api/thing", { method: "POST", headers: { origin: "http://other.lan" } })).status).toBe(403);
  });

  it("never checks reads", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect((await send(method, crossSite)).status, method).toBe(200);
    }
  });
});

describe("hostnameOf", () => {
  it("reads the lower-cased hostname out of a Host value", () => {
    expect(hostnameOf("Budget.lan:8420")).toBe("budget.lan");
    expect(hostnameOf("[::1]:8420")).toBe("[::1]");
    expect(hostnameOf("http://budget.lan/")).toBeNull();
    expect(hostnameOf("")).toBeNull();
  });
});

describe("hostForAddress", () => {
  it("names a specific listen address and nothing for a wildcard", () => {
    expect(hostForAddress("192.0.2.10")).toBe("192.0.2.10");
    expect(hostForAddress("::1")).toBe("[::1]");
    expect(hostForAddress("localhost")).toBe("localhost");
    expect(hostForAddress("0.0.0.0")).toBeNull();
    expect(hostForAddress("::")).toBeNull();
  });
});

describe("app", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function appFor(env: Record<string, string | undefined>) {
    const config = loadConfig(env);
    return createApp(config, createServices(config));
  }

  it("guards every /api route but not the dashboard shell", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guards-"));
    const app = appFor({ DATA_DIR: dir });
    expect((await app.request("/api/health")).status).toBe(200);
    for (const url of ["/api/health", "/api/plan", "/api/no-such-route"]) {
      expect((await withHost(app, "rebind.example.com", url)).status, url).toBe(403);
    }
    expect((await withHost(app, "rebind.example.com", "/")).status).not.toBe(403);
  });

  it("answers the specific address HOST listens on without listing it in ALLOWED_HOSTS", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guards-"));
    expect((await withHost(appFor({ DATA_DIR: dir, HOST: "192.0.2.10" }), "192.0.2.10:8420", "/api/health")).status).toBe(200);
    expect((await withHost(appFor({ DATA_DIR: dir, HOST: "0.0.0.0" }), "192.0.2.10:8420", "/api/health")).status).toBe(403);
  });

  it("refuses cross-site state changes on the API and lets the dashboard's own through", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guards-"));
    fs.copyFileSync(path.resolve(import.meta.dirname, "../../data/plan.example.json"), path.join(dir, "plan.json"));
    const config = loadConfig({ DATA_DIR: dir });
    const connector = fakeConnector();
    const app = createApp(config, createServices(config, { db: openDatabase(":memory:"), connector, now: () => "2026-09-08T12:00:00.000Z" }));
    const json = { "content-type": "application/json" };
    const requests: [string, () => RequestInit][] = [
      ["/api/sync", () => ({ method: "POST" })],
      ["/api/import/csv", () => ({ method: "POST", body: formWithFile() })],
      ["/api/transactions/999/bucket", () => ({ method: "POST", body: JSON.stringify({ bucket: "groceries" }), headers: json })],
      ["/api/accounts/999", () => ({ method: "PATCH", body: JSON.stringify({ role: "checking" }), headers: json })],
    ];
    for (const [url, init] of requests) {
      const base = init();
      const refused = await app.request(url, { ...base, headers: { ...(base.headers as Record<string, string>), ...crossSite } });
      expect(refused.status, url).toBe(403);
      expect(await refused.json(), url).toEqual({ error: "cross_site" });
    }
    expect(connector.calls).toEqual([]);
    for (const [url, init] of requests) {
      const base = init();
      const res = await app.request(url, { ...base, headers: { ...(base.headers as Record<string, string>), ...sameOrigin } });
      expect(res.status, url).not.toBe(403);
    }
    expect(connector.calls).toHaveLength(1);
  });
});

function formWithFile() {
  const form = new FormData();
  form.set("file", new File(["Date,Amount,Description\n"], "export.txt", { type: "text/plain" }));
  form.set("preset", "no-such-preset");
  form.set("accountName", "Checking");
  return form;
}
