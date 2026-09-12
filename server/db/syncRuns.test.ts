import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./index.js";
import { finishSyncRun, latestSuccessfulSyncRun, latestSyncRun, listSyncRuns, startSyncRun } from "./syncRuns.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

describe("sync runs", () => {
  it("starts open and finishes with counts", () => {
    const run = startSyncRun(db, "simplefin", "2026-09-01T00:00:00.000Z");
    expect(run).toMatchObject({ connector: "simplefin", finishedAt: null, accountsN: 0, transactionsN: 0, error: null, requestedSince: null });
    const done = finishSyncRun(db, run.id, { finishedAt: "2026-09-01T00:00:05.000Z", accountsN: 4, transactionsN: 120 });
    expect(done).toMatchObject({ id: run.id, finishedAt: "2026-09-01T00:00:05.000Z", accountsN: 4, transactionsN: 120, error: null });
  });

  it("records an error message on failure", () => {
    const run = startSyncRun(db, "simplefin", "2026-09-01T00:00:00.000Z");
    const failed = finishSyncRun(db, run.id, { finishedAt: "2026-09-01T00:00:01.000Z", error: "upstream 503" });
    expect(failed).toMatchObject({ error: "upstream 503", accountsN: 0, transactionsN: 0 });
  });

  it("latest is by started_at and can be scoped to a connector", () => {
    startSyncRun(db, "simplefin", "2026-09-01T00:00:00.000Z");
    startSyncRun(db, "csv", "2026-09-03T00:00:00.000Z");
    startSyncRun(db, "simplefin", "2026-09-02T00:00:00.000Z");
    expect(latestSyncRun(db)?.connector).toBe("csv");
    expect(latestSyncRun(db, "simplefin")?.startedAt).toBe("2026-09-02T00:00:00.000Z");
    expect(latestSyncRun(db, "plaid")).toBeUndefined();
    expect(listSyncRuns(db, { limit: 2 }).map((r) => r.startedAt)).toEqual(["2026-09-03T00:00:00.000Z", "2026-09-02T00:00:00.000Z"]);
  });

  it("stores the since a run was explicitly asked for", () => {
    const run = startSyncRun(db, "simplefin", "2026-09-10T00:00:00.000Z", "2026-09-09");
    expect(run.requestedSince).toBe("2026-09-09");
    expect(finishSyncRun(db, run.id, { finishedAt: "2026-09-10T00:00:05.000Z" }).requestedSince).toBe("2026-09-09");
  });

  it("finishing an unknown run throws", () => {
    expect(() => finishSyncRun(db, 7, { finishedAt: "2026-09-01T00:00:00.000Z" })).toThrow(/sync run 7/);
  });
});

describe("latestSuccessfulSyncRun", () => {
  it("skips failed and unfinished runs and other connectors", () => {
    const db = openDatabase(":memory:");
    expect(latestSuccessfulSyncRun(db, "a")).toBeUndefined();
    const ok = startSyncRun(db, "a", "2026-09-01T00:00:00.000Z");
    finishSyncRun(db, ok.id, { finishedAt: "2026-09-01T00:00:01.000Z", accountsN: 1 });
    const failed = startSyncRun(db, "a", "2026-09-02T00:00:00.000Z");
    finishSyncRun(db, failed.id, { finishedAt: "2026-09-02T00:00:01.000Z", error: "boom" });
    startSyncRun(db, "a", "2026-09-03T00:00:00.000Z"); // still running
    const other = startSyncRun(db, "b", "2026-09-04T00:00:00.000Z");
    finishSyncRun(db, other.id, { finishedAt: "2026-09-04T00:00:01.000Z" });
    expect(latestSuccessfulSyncRun(db, "a")?.id).toBe(ok.id);
  });

  it("with defaultWindowOnly, skips runs started with an explicit since", () => {
    const def = startSyncRun(db, "a", "2026-09-01T00:00:00.000Z");
    finishSyncRun(db, def.id, { finishedAt: "2026-09-01T00:00:01.000Z" });
    const manual = startSyncRun(db, "a", "2026-09-10T00:00:00.000Z", "2026-09-09");
    finishSyncRun(db, manual.id, { finishedAt: "2026-09-10T00:00:01.000Z" });
    expect(latestSuccessfulSyncRun(db, "a")?.id).toBe(manual.id);
    expect(latestSuccessfulSyncRun(db, "a", { defaultWindowOnly: true })?.id).toBe(def.id);
  });
});
