import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { getAccount, getTransaction, insertSnapshot, openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "../sync/__fixtures__/fakeConnector.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const now = "2026-09-08T12:00:00.000Z";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-"));
  fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness() {
  const config = loadConfig({ DATA_DIR: dir });
  return createApp(config, createServices(config, { db, connector: fakeConnector(), now: () => now }));
}

const addAccount = (externalId: string, type: string) => upsertAccount(db, { connector: "fake", externalId, name: `Acct ${externalId}`, institution: "Example Bank", type }, now).id;
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("GET /api/accounts", () => {
  it("lists accounts with their latest balance and the plan's debts and goals", async () => {
    const chk = addAccount("chk", "checking");
    const card = addAccount("card", "credit");
    insertSnapshot(db, { accountId: chk, at: "2026-09-01T00:00:00.000Z", balance: 900 });
    insertSnapshot(db, { accountId: chk, at: "2026-09-07T00:00:00.000Z", balance: 1200 });
    setAccountRole(db, card, "card");
    setAccountLinks(db, card, { linkedDebtId: "card-a", linkedGoalIds: [] });

    const res = await harness().request("/api/accounts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts.find((a: { id: number }) => a.id === chk)).toMatchObject({ role: null, type: "checking", balance: { amount: 1200, at: "2026-09-07T00:00:00.000Z" } });
    expect(body.accounts.find((a: { id: number }) => a.id === card)).toMatchObject({ role: "card", linkedDebtId: "card-a", balance: null });
    expect(body.debts).toEqual([{ id: "card-a", name: "Card A" }, { id: "card-b", name: "Card B" }, { id: "card-c", name: "Card C" }]);
    expect(body.goals.map((g: { id: string }) => g.id)).toEqual(["irregular-costs", "rainy-day"]);
    expect(body).toMatchObject({ planOk: true, currency: "USD" });
  });

  it("still lists accounts when the plan is missing", async () => {
    addAccount("chk", "checking");
    fs.rmSync(path.join(dir, "plan.json"));
    const body = await (await harness().request("/api/accounts")).json();
    expect(body).toMatchObject({ debts: [], goals: [], planOk: false });
    expect(body.accounts).toHaveLength(1);
  });
});

describe("PATCH /api/accounts/:id", () => {
  it("sets a card's role and debt link and re-derives its payments' debt id", async () => {
    const app = harness();
    const card = addAccount("card", "credit");
    const payment = upsertTransaction(db, { accountId: card, connector: "fake", externalId: "pay", date: "2026-09-03", pending: false, amount: 300, description: "PAYMENT THANK YOU" }, now).transaction;
    setTransactionBucket(db, payment.id, { bucketId: "_transfer", source: "manual" }, now);

    const role = await app.request(`/api/accounts/${card}`, patch({ role: "card" }));
    expect(role.status).toBe(200);
    expect((await role.json()).account).toMatchObject({ role: "card", linkedDebtId: null });
    expect(getTransaction(db, payment.id)?.debtId).toBeNull();

    const link = await app.request(`/api/accounts/${card}`, patch({ linkedDebtId: "card-a" }));
    expect(link.status).toBe(200);
    const body = await link.json();
    expect(body.account).toMatchObject({ id: card, role: "card", linkedDebtId: "card-a" });
    expect(body.categorized.applied).toBe(true);
    expect(getAccount(db, card)).toMatchObject({ role: "card", linkedDebtId: "card-a" });
    expect(getTransaction(db, payment.id)?.debtId).toBe("card-a");
  });

  it("links a savings account to goals and clears links a new role cannot have", async () => {
    const app = harness();
    const sav = addAccount("sav", "savings");
    const linked = await app.request(`/api/accounts/${sav}`, patch({ role: "savings", linkedGoalIds: ["rainy-day", "rainy-day", "irregular-costs"] }));
    expect(linked.status).toBe(200);
    expect(getAccount(db, sav)?.linkedGoalIds).toEqual(["rainy-day", "irregular-costs"]);

    const ignored = await app.request(`/api/accounts/${sav}`, patch({ role: "ignore" }));
    expect(ignored.status).toBe(200);
    expect(getAccount(db, sav)).toMatchObject({ role: "ignore", linkedGoalIds: [], linkedDebtId: null });
  });

  it("refuses links that do not fit the role or the plan", async () => {
    const app = harness();
    const sav = addAccount("sav", "savings");
    setAccountRole(db, sav, "savings");
    const card = addAccount("card", "credit");
    setAccountRole(db, card, "card");

    const cases: [number, unknown, number, string][] = [
      [sav, { linkedDebtId: "card-a" }, 422, "link_role_mismatch"],
      [card, { linkedGoalIds: ["rainy-day"] }, 422, "link_role_mismatch"],
      [card, { linkedDebtId: "no-such-debt" }, 422, "unknown_debt"],
      [sav, { linkedGoalIds: ["no-such-goal"] }, 422, "unknown_goal"],
      [card, { role: "loan" }, 400, "bad_request"],
      [card, {}, 400, "bad_request"],
      [card, { role: "card", extra: 1 }, 400, "bad_request"],
      [999, { role: "card" }, 404, "unknown_account"],
    ];
    for (const [id, body, status, error] of cases) {
      const res = await app.request(`/api/accounts/${id}`, patch(body));
      expect({ body, status: res.status, error: (await res.json()).error }).toEqual({ body, status, error });
    }
    expect(getAccount(db, card)).toMatchObject({ role: "card", linkedDebtId: null, linkedGoalIds: [] });
    expect(getAccount(db, sav)).toMatchObject({ role: "savings", linkedDebtId: null, linkedGoalIds: [] });
  });

  it("sets roles without a plan but refuses links until it loads", async () => {
    const app = harness();
    const card = addAccount("card", "credit");
    fs.rmSync(path.join(dir, "plan.json"));
    expect((await app.request(`/api/accounts/${card}`, patch({ role: "card" }))).status).toBe(200);
    const res = await app.request(`/api/accounts/${card}`, patch({ linkedDebtId: "card-a" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("plan_missing");
    expect(getAccount(db, card)).toMatchObject({ role: "card", linkedDebtId: null });
  });
});
