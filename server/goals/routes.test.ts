import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { insertSnapshot, openDatabase, setAccountLinks, setAccountRole, upsertAccount, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "../sync/__fixtures__/fakeConnector.js";
import type { GoalsProgress } from "./progress.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const now = new Date(2026, 8, 11, 12).toISOString(); // noon local: September 11th in any zone

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goals-"));
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

function account(externalId: string, role: "savings" | "checking", goalIds: string[]) {
  const a = upsertAccount(db, { connector: "fake", externalId, name: externalId, institution: "Bank", type: "savings" }, now);
  setAccountRole(db, a.id, role);
  setAccountLinks(db, a.id, { linkedGoalIds: goalIds, linkedDebtId: null });
  return a;
}

describe("GET /api/goals", () => {
  it("is 409 without a valid plan", async () => {
    const res = await harness().request("/api/goals");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "plan_missing" });
  });

  it("reads each goal's balance from the latest snapshot of its linked savings accounts", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    const savings = account("sav", "savings", ["irregular-costs", "rainy-day"]);
    const checking = account("chk", "checking", ["rainy-day"]);
    const unlinked = account("sav-2", "savings", []);
    insertSnapshot(db, { accountId: savings.id, at: "2026-08-01T00:00:00.000Z", balance: 800 });
    insertSnapshot(db, { accountId: savings.id, at: "2026-09-10T00:00:00.000Z", balance: 2000 });
    insertSnapshot(db, { accountId: checking.id, at: "2026-09-10T00:00:00.000Z", balance: 3000 });
    insertSnapshot(db, { accountId: unlinked.id, at: "2026-09-10T00:00:00.000Z", balance: 5000 });

    const res = await harness().request("/api/goals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GoalsProgress;
    expect(body.today).toBe("2026-09-11");
    expect(body.goals[0]).toMatchObject({ id: "irregular-costs", balance: 1500, balanceSource: "snapshot", nextBill: { names: ["Bike repair"], date: "2026-10-01" } });
    expect(body.goals[1]).toMatchObject({ id: "rainy-day", balance: 500, target: { amount: 1000, percent: 50 } });
  });
});

describe("GET /api/goals today", () => {
  it("is the machine's calendar day, not UTC's", async () => {
    fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
    // 01:00 local: still the day before in UTC for any zone east of it (the suite runs in one).
    const res = await harness(new Date(2026, 8, 11, 1).toISOString()).request("/api/goals");
    expect(((await res.json()) as GoalsProgress).today).toBe("2026-09-11");
  });
});
