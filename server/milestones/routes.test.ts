import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { insertSnapshot, listAccounts, listMilestones, listTransactions, openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { account as fakeAccount, fakeConnector, transaction as fakeTransaction, type FakeConnector } from "../sync/__fixtures__/fakeConnector.js";
import { SETTLE_DAYS } from "./detect.js";
import type { MilestonesResponse } from "./routes.js";
import type { Streaks } from "./streaks.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");

let dir: string;
let db: Db;
let clock: string;
let seq = 0;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "milestones-"));
  db = openDatabase(":memory:");
  clock = "2026-09-11T12:00:00.000Z";
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness(connector: FakeConnector = fakeConnector()) {
  const config = loadConfig({ DATA_DIR: dir });
  return createApp(config, createServices(config, { db, connector, now: () => clock }));
}

const withPlan = () => fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
const ids = (list: { kind: string; key: string }[]) => list.map((m) => `${m.kind}:${m.key}`);

function account(externalId: string, role: "checking" | "savings" | "card", links: { linkedGoalIds?: string[]; linkedDebtId?: string } = {}) {
  const a = upsertAccount(db, { connector: "fake", externalId, name: externalId, institution: "Bank", type: role }, clock);
  setAccountRole(db, a.id, role);
  setAccountLinks(db, a.id, { linkedGoalIds: links.linkedGoalIds ?? [], linkedDebtId: links.linkedDebtId ?? null });
  return a;
}

function filed(accountId: number, date: string, amount: number, bucketId: string) {
  seq += 1;
  const { transaction } = upsertTransaction(db, { accountId, connector: "fake", externalId: `t${seq}`, date, pending: false, amount, description: "SHOP" }, clock);
  setTransactionBucket(db, transaction.id, { bucketId, source: "manual" }, clock);
}

/** History from July 1st. July: every bucket under plan. August: meals over, the rainy-day goal met. Card A synced at zero, the buffer full. */
function seed() {
  withPlan();
  const checking = account("chk", "checking");
  const savings = account("sav", "savings", { linkedGoalIds: ["rainy-day"] });
  const card = account("card", "card", { linkedDebtId: "card-a" });
  filed(checking.id, "2026-07-01", -1200, "rent");
  filed(checking.id, "2026-07-10", -100, "meals");
  filed(checking.id, "2026-08-10", -600, "meals");
  filed(savings.id, "2026-08-01", 100, "_transfer");
  filed(checking.id, "2026-09-02", -10, "meals");
  insertSnapshot(db, { accountId: savings.id, at: "2026-09-10T00:00:00.000Z", balance: 1000 });
  insertSnapshot(db, { accountId: card.id, at: "2026-09-10T00:00:00.000Z", balance: 0 });
}

async function milestones(app: ReturnType<typeof harness>): Promise<MilestonesResponse> {
  const res = await app.request("/api/milestones");
  expect(res.status).toBe(200);
  return (await res.json()) as MilestonesResponse;
}

describe("milestone routes", () => {
  it("are 409 without a valid plan", async () => {
    const app = harness();
    for (const url of ["/api/milestones", "/api/streaks"]) {
      const res = await app.request(url);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "plan_missing" });
    }
  });

  it("GET /api/milestones detects, records each once and names it from the plan", async () => {
    seed();
    const app = harness();
    const body = await milestones(app);
    const found = ids(body.undismissed);
    expect(found).toEqual(expect.arrayContaining(["debt-halfway:card-a", "debt-paid:card-a", "buffer-target-met:rainy-day", "month-under-plan:meals:2026-07", "month-under-plan:rent:2026-08", "savings-month-met:rainy-day:2026-08"]));
    expect(found).not.toContain("month-under-plan:meals:2026-08");
    expect(found.filter((id) => id.endsWith("2026-09") || id.includes("card-b"))).toEqual([]);
    expect(found).toHaveLength(2 + 1 + 10 + 9 + 1);
    expect(body.undismissed.find((m) => m.key === "meals:2026-07")).toMatchObject({ kind: "month-under-plan", subject: { type: "bucket", id: "meals", name: "Meals" }, month: "2026-07", dismissed: false, firstSeen: clock });
    expect(body.undismissed.find((m) => m.kind === "debt-paid")).toMatchObject({ subject: { type: "debt", id: "card-a", name: "Card A" }, month: null });

    clock = "2026-09-12T12:00:00.000Z";
    expect((await milestones(app)).undismissed).toEqual(body.undismissed);
    expect(listMilestones(db)).toHaveLength(found.length);
  });

  it("POST /api/milestones/:id/dismiss moves one into history only; it needs JSON and a known id", async () => {
    seed();
    const app = harness();
    const before = await milestones(app);
    const paid = before.undismissed.find((m) => m.kind === "debt-paid");
    const dismiss = (id: string | number, headers: Record<string, string> = { "content-type": "application/json" }) => app.request(`/api/milestones/${id}/dismiss`, { method: "POST", headers });

    expect((await dismiss(paid?.id ?? 0, {})).status).toBe(415);
    expect((await dismiss("abc")).status).toBe(400);
    expect((await dismiss(9999)).status).toBe(404);
    const res = await dismiss(paid?.id ?? 0);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ milestone: { id: paid?.id, dismissed: true } });
    expect((await dismiss(paid?.id ?? 0)).status).toBe(200);

    const after = await milestones(app);
    expect(after.undismissed.map((m) => m.id)).not.toContain(paid?.id);
    expect(after.undismissed).toHaveLength(before.undismissed.length - 1);
    expect(after.history.map((m) => m.id)).toEqual([...before.undismissed.map((m) => m.id)].reverse());
    expect(after.history.find((m) => m.id === paid?.id)).toMatchObject({ dismissed: true });
  });

  it("GET /api/streaks counts consecutive closed months per bucket and goal", async () => {
    seed();
    const res = await harness().request("/api/streaks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Streaks;
    expect(body.through).toBe("2026-08");
    expect(body.buckets.find((b) => b.id === "rent")).toEqual({ id: "rent", name: "Rent", current: 2, best: 2 });
    expect(body.buckets.find((b) => b.id === "meals")).toEqual({ id: "meals", name: "Meals", current: 0, best: 1 });
    expect(body.goals).toEqual([
      { id: "irregular-costs", name: "Irregular costs fund", current: 0, best: 0 },
      { id: "rainy-day", name: "Rainy day fund", current: 1, best: 1 },
    ]);
  });
});

describe("detection after sync and import", () => {
  it("a successful sync records milestones before any GET", async () => {
    withPlan();
    account("card-1", "card", { linkedDebtId: "card-a" });
    const connector = fakeConnector({ accounts: [fakeAccount({ externalId: "card-1", type: "card", balance: 0, balanceAt: "2026-09-10T00:00:00.000Z" })] });
    const res = await harness(connector).request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(ids(listMilestones(db))).toEqual(["debt-halfway:card-a", "debt-paid:card-a"]);
  });

  it("records no monthly milestone while an account with activity in the month has no role or a row awaits review", async () => {
    withPlan();
    const connector = fakeConnector({ accounts: [fakeAccount()], transactions: [fakeTransaction({ date: "2026-08-01" })] });
    const app = harness(connector);
    expect((await app.request("/api/sync", { method: "POST" })).status).toBe(200);
    expect(listMilestones(db)).toEqual([]);

    const [synced] = listAccounts(db);
    setAccountRole(db, synced?.id ?? 0, "checking");
    expect((await milestones(app)).undismissed).toEqual([]);

    const [row] = listTransactions(db);
    setTransactionBucket(db, row?.id ?? 0, { bucketId: "meals", source: "manual" }, clock);
    const settled = ids((await milestones(app)).undismissed);
    expect(settled).toContain("month-under-plan:meals:2026-08");
    expect(settled).toHaveLength(10);
  });

  it("a sync without a plan still succeeds, with only the categorizer's plan warning", async () => {
    const res = await harness(fakeConnector({ accounts: [fakeAccount()] })).request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { warnings: string[] }).warnings).toEqual([expect.stringContaining("Categorization skipped: no plan file")]);
    expect(listMilestones(db)).toEqual([]);
  });

  it("a successful CSV import records milestones", async () => {
    withPlan();
    fs.writeFileSync(path.join(dir, "rules.json"), JSON.stringify({ version: 1, rules: [{ match: "SHOP", bucket: "meals" }] }));
    const wallet = account("wallet", "checking");
    const form = new FormData();
    form.append("file", new File(["Date,Description,Amount\n2026-08-01,SHOP,-20\n2026-08-20,SHOP,-600\n"], "export.csv", { type: "text/csv" }));
    form.append("preset", "generic");
    form.append("accountId", String(wallet.id));
    const res = await harness().request("/api/import/csv", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const found = ids(listMilestones(db));
    expect(found).toContain("month-under-plan:rent:2026-08");
    expect(found).not.toContain("month-under-plan:meals:2026-08");
    expect(found).toHaveLength(9);
  });
});

describe("the machine's calendar day", () => {
  // 01:00 local: still the day before in UTC for any zone east of it (the suite runs in one).
  const earlyOn = (month: number, day: number) => new Date(2026, month - 1, day, 1).toISOString();

  it("closes a month for streaks at local midnight", async () => {
    clock = earlyOn(9, 1);
    seed();
    const body = (await (await harness().request("/api/streaks")).json()) as Streaks;
    expect(body.through).toBe("2026-08");
  });

  it("settles a month by the local day on GET /api/milestones", async () => {
    clock = earlyOn(9, SETTLE_DAYS + 1);
    seed();
    expect(ids((await milestones(harness())).undismissed)).toContain("month-under-plan:rent:2026-08");
  });

  it("settles a month by the local day in detection after a sync", async () => {
    clock = earlyOn(9, SETTLE_DAYS + 1);
    seed();
    expect((await harness().request("/api/sync", { method: "POST" })).status).toBe(200);
    expect(ids(listMilestones(db))).toContain("month-under-plan:rent:2026-08");
  });
});
