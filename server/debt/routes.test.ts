import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { insertSnapshot, openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "../sync/__fixtures__/fakeConnector.js";
import type { DebtResponse } from "./routes.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const now = "2026-03-20T12:00:00.000Z";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "debt-"));
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness(clock = now) {
  const config = loadConfig({ DATA_DIR: dir });
  return createApp(config, createServices(config, { db, connector: fakeConnector(), now: () => clock }));
}

let n = 0;
function seed(accountId: number, date: string, amount: number, bucket: string | null, pending = false) {
  n += 1;
  const t = upsertTransaction(db, { accountId, connector: "fake", externalId: `tx-${n}`, date, pending, amount, description: `row ${n}` }, now).transaction;
  if (bucket !== null) setTransactionBucket(db, t.id, { bucketId: bucket, source: "manual" }, now);
  return t;
}

function card(externalId: string, debtId: string | null, role: "card" | "checking" = "card") {
  const account = upsertAccount(db, { connector: "fake", externalId, name: externalId, institution: "Issuer", type: "credit" }, now);
  setAccountRole(db, account.id, role);
  setAccountLinks(db, account.id, { linkedGoalIds: [], linkedDebtId: debtId });
  return account;
}

describe("GET /api/debt", () => {
  it("is 409 without a valid plan", async () => {
    const res = await harness().request("/api/debt");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "plan_missing" });
  });

  it("returns the comparison and progress from linked card snapshots and posted payments", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    const a = card("crd-a", "card-a");
    const unlinked = card("crd-x", null);
    const checking = card("chk", "card-a", "checking");
    insertSnapshot(db, { accountId: a.id, at: "2026-02-01T00:00:00.000Z", balance: -2600 });
    insertSnapshot(db, { accountId: a.id, at: "2026-03-15T00:00:00.000Z", balance: -2400 });
    insertSnapshot(db, { accountId: unlinked.id, at: "2026-03-15T00:00:00.000Z", balance: -500 });
    seed(a.id, "2026-01-05", 600, "_transfer");
    seed(a.id, "2026-02-05", 600, "_transfer");
    seed(a.id, "2026-03-05", 600, "_transfer", true);
    seed(a.id, "2026-02-10", -40, "meals");
    seed(a.id, "2026-02-12", 15, "meals");
    seed(checking.id, "2026-02-05", 600, "_transfer");

    const res = await harness().request("/api/debt");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DebtResponse;
    expect(body.planned.startMonth).toBe("2026-01");
    expect(body.baseline.payments).toBe("baseline");
    expect(body.monthsSaved).toBeGreaterThan(0);
    expect(body.progress.month).toBe("2026-03");
    expect(body.progress.debts[0]).toMatchObject({ id: "card-a", currentBalance: 2400, balanceSource: "snapshot", balanceAsOf: "2026-03-15T00:00:00.000Z", paidSoFar: 1200 });
    expect(body.progress.projection.months[0]!.debts[0]!.payment).toBe(600);
    expect(body.progress.debts[1]).toMatchObject({ id: "card-b", balanceSource: "plan", paidSoFar: 0 });
    expect(body.progress.projection.startMonth).toBe("2026-03");
  });

  it("takes interest charged from posted `_interest` rows on the linked card and says so", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    const a = card("crd-a", "card-a");
    const unlinked = card("crd-x", null);
    insertSnapshot(db, { accountId: a.id, at: "2026-03-15T00:00:00.000Z", balance: -3000 });
    seed(a.id, "2026-01-28", -40, "_interest");
    seed(a.id, "2026-02-28", -35, "_interest");
    seed(a.id, "2026-03-14", -500, "_interest", true);
    seed(unlinked.id, "2026-02-28", -900, "_interest");

    const body = (await (await harness().request("/api/debt")).json()) as DebtResponse;
    const baselineBeforeMarch = body.baseline.months.filter((m) => m.month < "2026-03").reduce((acc, m) => acc + m.debts[0]!.interest, 0);
    // The balance estimate would be 3000 − 3500 = −500, floored to nothing charged; the rows say 75.
    expect(body.progress.debts[0]).toMatchObject({ id: "card-a", interestSource: "rows" });
    expect(body.progress.debts[0]!.interestSavedSoFar).toBeCloseTo(baselineBeforeMarch - 75, 2);
    expect(body.progress.debts[1]).toMatchObject({ id: "card-b", interestSource: "estimate" });
  });

  it("keeps the balance estimate while another synced account linked to the debt has no interest rows", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    const oldCard = card("crd-a", "card-a");
    const newCard = card("crd-a2", "card-a");
    insertSnapshot(db, { accountId: oldCard.id, at: "2026-03-15T00:00:00.000Z", balance: -1000 });
    insertSnapshot(db, { accountId: newCard.id, at: "2026-03-15T00:00:00.000Z", balance: -2000 });
    seed(oldCard.id, "2026-01-28", -40, "_interest");

    const body = (await (await harness().request("/api/debt")).json()) as DebtResponse;
    expect(body.progress.debts[0]).toMatchObject({ id: "card-a", currentBalance: 3000, interestSource: "estimate" });
  });

  it("never reports a positive card balance as debt", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    const a = card("crd-a", "card-a");
    insertSnapshot(db, { accountId: a.id, at: "2026-03-15T00:00:00.000Z", balance: 25 });
    const body = (await (await harness().request("/api/debt")).json()) as DebtResponse;
    expect(body.progress.debts[0]).toMatchObject({ currentBalance: 0, paidOff: true, percent: 100 });
  });
});

describe("GET /api/debt progress month", () => {
  it("is the machine's calendar month, not UTC's", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    // 01:00 local on April 1st: still March 31st in UTC for any zone east of it (the suite runs in one).
    const res = await harness(new Date(2026, 3, 1, 1).toISOString()).request("/api/debt");
    expect(((await res.json()) as DebtResponse).progress.month).toBe("2026-04");
  });
});
