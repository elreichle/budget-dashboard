import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSimpleFinConnector } from "../connectors/simplefin.js";
import { finishSyncRun, listSyncRuns, openDatabase, startSyncRun } from "../db/index.js";
import { secretsPath } from "../secrets.js";
import { account, fakeConnector } from "./__fixtures__/fakeConnector.js";
import { createSyncService } from "./service.js";

describe("createSyncService", () => {
  it("runs one sync at a time: a second trigger while running is refused", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFetch = connector.fetchTransactions.bind(connector);
    connector.fetchTransactions = async (since) => {
      await gate;
      return slowFetch(since);
    };
    const service = createSyncService(db, connector, { now: () => "2026-09-08T12:00:00.000Z" });

    const first = service.trigger({ since: "2026-08-01" });
    expect(first).toBeDefined();
    expect(service.status().running).toBe(true);
    expect(service.trigger({ since: "2026-08-01" })).toBeUndefined();

    release();
    const result = await first!;
    expect(result.failure).toBeUndefined();
    expect(service.status()).toEqual({ running: false, last: result.run });
    expect(listSyncRuns(db)).toHaveLength(1);

    expect(service.trigger({ since: "2026-08-01" })).toBeDefined();
  });

  it("releases the lock after a failed run and reports the failed run as last", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector();
    connector.failWith = new Error("boom");
    const service = createSyncService(db, connector, { now: () => "2026-09-08T12:00:00.000Z" });
    const result = await service.trigger({ since: "2026-08-01" })!;
    expect(result.failure?.message).toBe("boom");
    expect(service.status()).toEqual({ running: false, last: expect.objectContaining({ error: "boom" }) });
    expect(service.trigger({ since: "2026-08-01" })).toBeDefined();
  });

  it("reports no last run on an empty database", () => {
    const service = createSyncService(openDatabase(":memory:"), fakeConnector());
    expect(service.status()).toEqual({ running: false, last: null });
  });

  it("finishes runs a previous process left open with error interrupted, and leaves finished runs alone", () => {
    const db = openDatabase(":memory:");
    const done = finishSyncRun(db, startSyncRun(db, "fake", "2026-09-07T10:00:00.000Z").id, { finishedAt: "2026-09-07T10:01:00.000Z" });
    const openSync = startSyncRun(db, "fake", "2026-09-08T10:00:00.000Z");
    const openImport = startSyncRun(db, "csv", "2026-09-08T11:00:00.000Z");

    const service = createSyncService(db, fakeConnector(), { now: () => "2026-09-09T08:00:00.000Z" });

    const byId = new Map(listSyncRuns(db).map((r) => [r.id, r]));
    expect(byId.get(done.id)).toEqual(done);
    for (const id of [openSync.id, openImport.id]) {
      expect(byId.get(id)).toMatchObject({ finishedAt: "2026-09-09T08:00:00.000Z", error: "interrupted" });
    }
    expect(service.status().last).toMatchObject({ id: openSync.id, error: "interrupted" });
  });

  it("stores the reconnect message, not a path, when SimpleFIN's secrets file is unreadable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-service-"));
    try {
      fs.writeFileSync(secretsPath(dir), "{ nope");
      const db = openDatabase(":memory:");
      const service = createSyncService(db, createSimpleFinConnector({ dataDir: dir }), { now: () => "2026-09-08T12:00:00.000Z" });
      const result = await service.trigger({ since: "2026-08-01" })!;
      expect(result.failure?.code).toBe("secrets_unreadable");
      const [run] = listSyncRuns(db);
      expect(run?.error).toMatch(/reconnect SimpleFIN/i);
      expect(run?.error).not.toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
