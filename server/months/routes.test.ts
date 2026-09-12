import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, setTransactionDebt, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "../sync/__fixtures__/fakeConnector.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const now = new Date(2026, 8, 10, 12).toISOString(); // noon local: September 10th in any zone

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "months-"));
  fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
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
function seed(accountId: number, date: string, amount: number, bucket: string | null, opts: { pending?: boolean; debtId?: string } = {}) {
  n += 1;
  const t = upsertTransaction(db, { accountId, connector: "fake", externalId: `tx-${n}`, date, pending: opts.pending ?? false, amount, description: `row ${n}` }, now).transaction;
  if (bucket !== null) setTransactionBucket(db, t.id, { bucketId: bucket, source: "manual" }, now);
  if (opts.debtId) setTransactionDebt(db, t.id, opts.debtId, now);
  return t;
}

function checkingAndCard() {
  const checking = upsertAccount(db, { connector: "fake", externalId: "chk", name: "Checking", institution: "Bank", type: "checking" }, now);
  setAccountRole(db, checking.id, "checking");
  const card = upsertAccount(db, { connector: "fake", externalId: "crd", name: "Card", institution: "Issuer", type: "credit" }, now);
  setAccountRole(db, card.id, "card");
  setAccountLinks(db, card.id, { linkedGoalIds: [], linkedDebtId: "card-a" });
  return { checking, card };
}

describe("GET /api/months", () => {
  it("lists months with transactions newest first and names the current month", async () => {
    const { checking } = checkingAndCard();
    seed(checking.id, "2026-07-15", -5, "meals");
    seed(checking.id, "2026-09-02", -5, "meals");
    seed(checking.id, "2026-09-20", -5, null, { pending: true });
    const res = await harness().request("/api/months");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ months: ["2026-09", "2026-07"], current: "2026-09" });
  });

  it("is empty with no data", async () => {
    const res = await harness().request("/api/months");
    expect(await res.json()).toEqual({ months: [], current: "2026-09" });
  });
});

describe("GET /api/months/:month", () => {
  it("summarizes the month from posted rows on role-assigned accounts", async () => {
    const { checking, card } = checkingAndCard();
    seed(checking.id, "2026-09-01", 3600, "_income");
    seed(checking.id, "2026-09-03", -120, "meals");
    seed(card.id, "2026-09-04", -30, "meals", { pending: true });
    seed(card.id, "2026-09-05", 600, "_transfer", { debtId: "card-a" });
    seed(checking.id, "2026-09-05", -600, "_transfer");
    seed(checking.id, "2026-09-06", -9, null);
    seed(checking.id, "2026-08-30", -999, "meals");
    const res = await harness().request("/api/months/2026-09");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ month: "2026-09", daysInMonth: 30, daysElapsed: 10, closed: false, uncategorizedCount: 1 });
    expect(body.buckets.find((b: { id: string }) => b.id === "meals")).toMatchObject({ planned: 500, posted: 120, pending: 30, expectedByToday: 166.67, pace: "on-pace", remaining: 380 });
    expect(body.income).toEqual({ planned: 4000, received: 3600, pending: 0 });
    expect(body.debts[0]).toEqual({ id: "card-a", name: "Card A", planned: 600, paid: 600 });
    expect(body.totals.posted).toBe(120);
  });

  it("rejects a malformed month", async () => {
    const res = await harness().request("/api/months/2026-9");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request" });
  });

  it("refuses without a valid plan", async () => {
    fs.rmSync(path.join(dir, "plan.json"));
    const res = await harness().request("/api/months/2026-09");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "plan_missing" });
  });
});

describe("the machine's calendar day", () => {
  // 01:00 local on October 1st: still September 30th in UTC for any zone east of it (the suite runs in one).
  const earlyFirst = new Date(2026, 9, 1, 1).toISOString();

  it("names the current month by local time", async () => {
    const res = await harness(earlyFirst).request("/api/months");
    expect(await res.json()).toEqual({ months: [], current: "2026-10" });
  });

  it("counts elapsed days and closes a month by local time", async () => {
    const app = harness(earlyFirst);
    expect(await (await app.request("/api/months/2026-10")).json()).toMatchObject({ daysElapsed: 1, closed: false });
    expect(await (await app.request("/api/months/2026-09")).json()).toMatchObject({ daysElapsed: 30, closed: true });
  });
});

describe("needs review", () => {
  it("the month's count is exactly the month's rows the review inbox lists", async () => {
    const { checking } = checkingAndCard();
    const ignored = upsertAccount(db, { connector: "fake", externalId: "old", name: "Old", institution: "Bank", type: "checking" }, now);
    setAccountRole(db, ignored.id, "ignore");
    seed(checking.id, "2026-09-02", -1, null);
    seed(checking.id, "2026-09-03", -1, "_uncategorized");
    seed(checking.id, "2026-09-04", -1, "removed-bucket", { pending: true });
    seed(checking.id, "2026-09-05", -1, "meals");
    seed(checking.id, "2026-09-06", -1, "_transfer");
    seed(ignored.id, "2026-09-07", -1, null);
    seed(ignored.id, "2026-09-08", -1, "removed-bucket");
    seed(checking.id, "2026-08-20", -1, "removed-bucket");
    const app = harness();
    const summary = await (await app.request("/api/months/2026-09")).json();
    const review = await (await app.request("/api/review")).json();
    expect(review.transactions.map((t: { date: string }) => t.date)).toEqual(["2026-09-04", "2026-09-03", "2026-09-02", "2026-08-20"]);
    expect(summary.uncategorizedCount).toBe(3);
  });
});
