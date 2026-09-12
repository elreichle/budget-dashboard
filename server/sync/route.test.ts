import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/index.js";
import { createServices } from "../services.js";
import { ConnectorError } from "../connectors/types.js";
import { account, fakeConnector, notConfigured, transaction, type FakeConnector } from "./__fixtures__/fakeConnector.js";

function harness(connector: FakeConnector = fakeConnector({ accounts: [account()], transactions: [transaction()] })) {
  const config = loadConfig({ DATA_DIR: "/nonexistent/never-touched" });
  const services = createServices(config, { db: openDatabase(":memory:"), connector, now: () => new Date(2026, 8, 8, 12).toISOString() });
  return { app: createApp(config, services), connector };
}

describe("POST /api/sync", () => {
  it("runs a sync and returns the run summary", async () => {
    const { app, connector } = harness();
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ inserted: 1, updated: 0, snapshots: 1, categorized: { applied: false }, warnings: [expect.stringContaining("Categorization skipped: no plan file")], run: { connector: "fake", accountsN: 1, transactionsN: 1, error: null } });
    expect(connector.calls).toEqual(["2025-09-08"]);
  });

  it("accepts a `since` date in the body and rejects a malformed one", async () => {
    const { app, connector } = harness();
    const ok = await app.request("/api/sync", { method: "POST", body: JSON.stringify({ since: "2026-01-01" }), headers: { "content-type": "application/json" } });
    expect(ok.status).toBe(200);
    expect(connector.calls).toEqual(["2026-01-01"]);

    const bad = await app.request("/api/sync", { method: "POST", body: JSON.stringify({ since: "yesterday" }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_request" });

    const broken = await app.request("/api/sync", { method: "POST", body: "{since: 2026-01-01}", headers: { "content-type": "application/json" } });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: "bad_request", message: expect.stringContaining("JSON") });
    expect(connector.calls).toHaveLength(1);
  });

  it("409s with not_configured when the connector has no credentials, and still records the run", async () => {
    const connector = fakeConnector();
    connector.failWith = notConfigured();
    const { app } = harness(connector);
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "not_configured", message: "Fake is not connected yet.", run: { error: "Fake is not connected yet." } });
    const status = await (await app.request("/api/sync/status")).json();
    expect(status.last.error).toBe("Fake is not connected yet.");
  });

  it("502s with sync_failed when the source errors", async () => {
    const connector = fakeConnector();
    connector.failWith = new ConnectorError("fake", "http_error", "source answered 503");
    const { app } = harness(connector);
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "sync_failed", message: "source answered 503", run: { error: "source answered 503" } });
  });

  it("500s with internal when our own code fails, and the run still records it", async () => {
    const connector = fakeConnector();
    connector.failWith = new TypeError("fetch failed");
    const { app } = harness(connector);
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal", message: "fetch failed", run: { error: "fetch failed" } });
  });

  it("409s with sync_in_progress while a run is going", async () => {
    const connector = fakeConnector({ accounts: [account()] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = connector.fetchTransactions.bind(connector);
    connector.fetchTransactions = async (since) => {
      await gate;
      return fetch(since);
    };
    const { app } = harness(connector);
    const first = app.request("/api/sync", { method: "POST" });
    await Promise.resolve();
    const second = await app.request("/api/sync", { method: "POST" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "sync_in_progress" });
    expect((await (await app.request("/api/sync/status")).json()).running).toBe(true);
    release();
    expect((await first).status).toBe(200);
  });
});

describe("GET /api/sync/status", () => {
  it("returns running=false and last=null before any sync", async () => {
    const { app } = harness();
    const res = await app.request("/api/sync/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ running: false, last: null });
  });

  it("returns the last run after a sync", async () => {
    const { app } = harness();
    await app.request("/api/sync", { method: "POST" });
    const body = await (await app.request("/api/sync/status")).json();
    expect(body.running).toBe(false);
    expect(body.last).toMatchObject({ connector: "fake", accountsN: 1, transactionsN: 1, error: null });
  });
});
