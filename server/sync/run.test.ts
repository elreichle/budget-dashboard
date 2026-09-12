import { describe, expect, it } from "vitest";
import { getAccount, insertSnapshot, latestSyncRun, listAccounts, listSnapshots, listSyncRuns, listTransactions, openDatabase, setAccountRole, upsertAccount } from "../db/index.js";
import { account, fakeConnector, notConfigured, transaction } from "./__fixtures__/fakeConnector.js";
import { runSync } from "./run.js";

const NOW = new Date(2026, 8, 8, 12).toISOString(); // noon local: September 8th in any zone
const now = () => NOW;

describe("runSync", () => {
  it("upserts accounts, transactions and one snapshot per account, and records the run", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({
      accounts: [account(), account({ externalId: "acc-2", name: "Rewards Card", type: "credit", balance: -300 })],
      transactions: [transaction(), transaction({ externalId: "tx-2", accountExternalId: "acc-2", amount: -12, description: "COFFEE PLACE" })],
      warnings: ["Example Bank: statement delayed"],
    });

    const result = await runSync(db, connector, { now, since: "2026-08-01" });

    expect(connector.calls).toEqual(["2026-08-01"]);
    expect(result.failure).toBeUndefined();
    expect(result).toMatchObject({ inserted: 2, updated: 0, snapshots: 2, warnings: ["Example Bank: statement delayed"] });
    expect(result.run).toMatchObject({ connector: "fake", startedAt: NOW, finishedAt: NOW, accountsN: 2, transactionsN: 2, error: null });

    const accounts = listAccounts(db);
    expect(accounts.map((a) => a.externalId).sort()).toEqual(["acc-1", "acc-2"]);
    const txs = listTransactions(db);
    expect(txs).toHaveLength(2);
    const card = accounts.find((a) => a.externalId === "acc-2")!;
    expect(txs.find((t) => t.externalId === "tx-2")?.accountId).toBe(card.id);
    expect(listSnapshots(db, card.id)).toMatchObject([{ balance: -300, at: "2026-09-08T12:00:00.000Z" }]);
    expect(latestSyncRun(db)).toEqual(result.run);
  });

  it("is idempotent: a second identical reading changes no rows and adds no snapshot", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()], transactions: [transaction()] });
    await runSync(db, connector, { now, since: "2026-08-01" });
    const second = await runSync(db, connector, { now: () => "2026-09-08T13:00:00.000Z", since: "2026-08-01" });

    expect(second).toMatchObject({ inserted: 0, updated: 1, snapshots: 0 });
    expect(listTransactions(db)).toHaveLength(1);
    expect(listSnapshots(db, listAccounts(db)[0]!.id)).toHaveLength(1);
    expect(listSyncRuns(db)).toHaveLength(2);
  });

  it("appends a snapshot when the balance reading changes", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account({ balance: 1200 })] });
    await runSync(db, connector, { now, since: "2026-08-01" });
    connector.batch.accounts = [account({ balance: 1150, balanceAt: "2026-09-09T12:00:00.000Z" })];
    const second = await runSync(db, connector, { now, since: "2026-08-01" });
    expect(second.snapshots).toBe(1);
    expect(listSnapshots(db, listAccounts(db)[0]!.id).map((s) => s.balance)).toEqual([1200, 1150]);
  });

  it("preserves a user-assigned role and links when the account is seen again", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()] });
    await runSync(db, connector, { now, since: "2026-08-01" });
    const id = listAccounts(db)[0]!.id;
    setAccountRole(db, id, "checking");

    connector.batch.accounts = [account({ name: "Everyday Checking (renamed)" })];
    await runSync(db, connector, { now, since: "2026-08-01" });

    expect(getAccount(db, id)).toMatchObject({ role: "checking", name: "Everyday Checking (renamed)" });
    expect(listAccounts(db)).toHaveLength(1);
  });

  it("promotes a pending transaction to posted in place", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()], transactions: [transaction({ pending: true, date: "2026-09-05", amount: -40 })] });
    await runSync(db, connector, { now, since: "2026-08-01" });
    const pendingId = listTransactions(db)[0]!.id;

    connector.batch.transactions = [transaction({ pending: false, date: "2026-09-07", amount: -42.5 })];
    const result = await runSync(db, connector, { now, since: "2026-08-01" });

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    expect(listTransactions(db)).toMatchObject([{ id: pendingId, pending: false, date: "2026-09-07", amount: -42.5 }]);
  });

  it("skips a transaction whose account is not in the reading and says so in warnings", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()], transactions: [transaction(), transaction({ externalId: "tx-x", accountExternalId: "ghost" })] });
    const result = await runSync(db, connector, { now, since: "2026-08-01" });
    expect(result).toMatchObject({ inserted: 1, skipped: 1 });
    expect(result.warnings.join("\n")).toContain("ghost");
    expect(result.run.transactionsN).toBe(1);
  });

  it("records a failed run with the connector's message and writes nothing else", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()], transactions: [transaction()] });
    connector.failWith = notConfigured();

    const result = await runSync(db, connector, { now, since: "2026-08-01" });

    expect(result.failure).toEqual({ code: "not_configured", message: "Fake is not connected yet." });
    expect(result.run).toMatchObject({ finishedAt: NOW, accountsN: 0, transactionsN: 0, error: "Fake is not connected yet." });
    expect(listAccounts(db)).toHaveLength(0);
    expect(listTransactions(db)).toHaveLength(0);
    expect(latestSyncRun(db)?.error).toBe("Fake is not connected yet.");
  });

  it("records an unexpected error as internal", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector();
    connector.failWith = new TypeError("fetch failed");
    const result = await runSync(db, connector, { now, since: "2026-08-01" });
    expect(result.failure).toEqual({ code: "internal", message: "fetch failed" });
    expect(result.run.error).toBe("fetch failed");
  });

  it("defaults `since` to a year back on the first run, then to two weeks before the last good run", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()] });
    await runSync(db, connector, { now });
    expect(connector.calls).toEqual(["2025-09-08"]);

    connector.failWith = notConfigured();
    await runSync(db, connector, { now: () => new Date(2026, 8, 10, 12).toISOString() }); // fails: does not move the window
    await runSync(db, connector, { now: () => new Date(2026, 8, 12, 12).toISOString() });
    expect(connector.calls.slice(1)).toEqual(["2026-08-25", "2026-08-25"]);
  });

  it("does not re-append a reading older than the latest snapshot on every sync", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account({ balance: 1200, balanceAt: "2026-09-08T12:00:00.000Z" })] });
    await runSync(db, connector, { now, since: "2026-08-01" });
    connector.batch.accounts = [account({ balance: 1300, balanceAt: "2026-09-01T12:00:00.000Z" })]; // source's balance date went backwards
    expect((await runSync(db, connector, { now, since: "2026-08-01" })).snapshots).toBe(1);
    expect((await runSync(db, connector, { now, since: "2026-08-01" })).snapshots).toBe(0);
    expect(listSnapshots(db, listAccounts(db)[0]!.id)).toHaveLength(2);
  });

  it("does not add a snapshot identical to one already stored, even from before this sync", async () => {
    const db = openDatabase(":memory:");
    const existing = upsertAccount(db, { connector: "fake", externalId: "acc-1", name: "x", institution: "y", type: "checking" }, NOW);
    insertSnapshot(db, { accountId: existing.id, at: "2026-09-08T12:00:00.000Z", balance: 1200 });
    const result = await runSync(db, fakeConnector({ accounts: [account()] }), { now, since: "2026-08-01" });
    expect(result.snapshots).toBe(0);
  });
});

describe("default since", () => {
  it("counts back from the machine's calendar day, not UTC's", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()] });
    // 01:00 local: still the day before in UTC for any zone east of it (the suite runs in one).
    await runSync(db, connector, { now: () => new Date(2026, 8, 8, 1).toISOString() });
    await runSync(db, connector, { now: () => new Date(2026, 8, 12, 1).toISOString() });
    expect(connector.calls).toEqual(["2025-09-08", "2026-08-25"]);
  });

  it("a manual run with an explicit since does not move the default window", async () => {
    const db = openDatabase(":memory:");
    const connector = fakeConnector({ accounts: [account()] });
    const first = await runSync(db, connector, { now: () => new Date(2026, 8, 1, 12).toISOString() });
    const manual = await runSync(db, connector, { now: () => new Date(2026, 8, 10, 12).toISOString(), since: "2026-09-09" });
    await runSync(db, connector, { now: () => new Date(2026, 8, 12, 12).toISOString() });
    expect(connector.calls).toEqual(["2025-09-01", "2026-09-09", "2026-08-18"]);
    expect(first.run.requestedSince).toBeNull();
    expect(manual.run.requestedSince).toBe("2026-09-09");
  });
});
