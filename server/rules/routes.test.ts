import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { getTransaction, openDatabase, setAccountLinks, setAccountRole, setTransactionBucket, upsertAccount, upsertTransaction, type Db } from "../db/index.js";
import { createServices } from "../services.js";
import { account, fakeConnector, transaction } from "../sync/__fixtures__/fakeConnector.js";
import { rulesPath } from "./load.js";

const examplePlan = path.resolve(import.meta.dirname, "../../data/plan.example.json");
const now = "2026-09-08T12:00:00.000Z";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-"));
  fs.copyFileSync(examplePlan, path.join(dir, "plan.json"));
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function harness(connector = fakeConnector()) {
  const config = loadConfig({ DATA_DIR: dir });
  const services = createServices(config, { db, connector, now: () => now });
  return createApp(config, services);
}

let n = 0;
function seed(description: string, amount: number, opts: { pending?: boolean; accountId?: number } = {}) {
  n += 1;
  const accountId = opts.accountId ?? upsertAccount(db, { connector: "fake", externalId: "chk", name: "Checking", institution: "Bank", type: "checking" }, now).id;
  return upsertTransaction(db, { accountId, connector: "fake", externalId: `tx-${n}`, date: "2026-09-05", pending: opts.pending ?? false, amount, description }, now).transaction;
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const readRules = () => JSON.parse(fs.readFileSync(rulesPath(dir), "utf8"));

describe("GET /api/review", () => {
  it("lists posted and pending transactions without a bucket, newest first, with their account", async () => {
    const app = harness();
    const older = seed("MYSTERY SHOP", -12);
    const pending = seed("PENDING THING", -3, { pending: true });
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, rules: [{ match: "FARE", bucket: "transit" }] }));
    seed("BUS FARE", -40);
    await app.request("/api/sync", { method: "POST" }); // runs categorization
    const res = await app.request("/api/review");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions.map((t: { id: number }) => t.id)).toEqual([pending.id, older.id]);
    expect(body.transactions[0]).toMatchObject({ pending: true, bucketId: null, account: { name: "Checking", institution: "Bank" } });
    expect(body.buckets).toEqual(expect.arrayContaining(["rent", "meals", "_transfer", "_income", "_uncategorized"]));
  });

  it("also lists rows filed _uncategorized or into a bucket the plan lacks, and nothing from an ignored account", async () => {
    const app = harness();
    const unfiled = seed("UNFILED", -1);
    const parked = seed("PARKED", -2);
    const removed = seed("OLD BUCKET", -3);
    const filed = seed("GROCER", -4);
    const ignored = upsertAccount(db, { connector: "fake", externalId: "old", name: "Old", institution: "Bank", type: "checking" }, now).id;
    setAccountRole(db, ignored, "ignore");
    seed("IGNORED UNFILED", -5, { accountId: ignored });
    const ignoredRemoved = seed("IGNORED OLD BUCKET", -6, { accountId: ignored });
    setTransactionBucket(db, parked.id, { bucketId: "_uncategorized", source: "manual" }, now);
    setTransactionBucket(db, removed.id, { bucketId: "removed-bucket", source: "manual" }, now);
    setTransactionBucket(db, filed.id, { bucketId: "meals", source: "manual" }, now);
    setTransactionBucket(db, ignoredRemoved.id, { bucketId: "removed-bucket", source: "manual" }, now);
    const body = await (await app.request("/api/review")).json();
    expect(body.transactions.map((t: { id: number }) => t.id)).toEqual([removed.id, parked.id, unfiled.id]);
  });
});

describe("GET /api/transactions", () => {
  it("lists filed and unfiled transactions newest first with their account, filtered by month and account", async () => {
    const app = harness();
    const chk = upsertAccount(db, { connector: "fake", externalId: "chk", name: "Checking", institution: "Bank", type: "checking" }, now).id;
    const card = upsertAccount(db, { connector: "fake", externalId: "card", name: "Card", institution: "Issuer", type: "credit" }, now).id;
    const add = (externalId: string, accountId: number, date: string) =>
      upsertTransaction(db, { accountId, connector: "fake", externalId, date, pending: false, amount: -10, description: externalId }, now).transaction;
    const aug = add("aug", chk, "2026-08-30");
    const sepChk = add("sep-chk", chk, "2026-09-02");
    const sepCard = add("sep-card", card, "2026-09-03");
    setTransactionBucket(db, sepChk.id, { bucketId: "meals", source: "manual" }, now);
    const ids = (body: { transactions: { id: number }[] }) => body.transactions.map((t) => t.id);

    const all = await (await app.request("/api/transactions")).json();
    expect(ids(all)).toEqual([sepCard.id, sepChk.id, aug.id]);
    expect(all.transactions[1]).toMatchObject({ bucketId: "meals", bucketSource: "manual", account: { id: chk, name: "Checking", institution: "Bank" } });
    expect(all.accounts).toEqual([
      { id: chk, name: "Checking", institution: "Bank" },
      { id: card, name: "Card", institution: "Issuer" },
    ]);
    expect(all.buckets).toEqual(expect.arrayContaining(["meals", "_transfer", "_income"]));

    expect(ids(await (await app.request("/api/transactions?month=2026-09")).json())).toEqual([sepCard.id, sepChk.id]);
    const narrow = await (await app.request(`/api/transactions?month=2026-09&accountId=${card}`)).json();
    expect(ids(narrow)).toEqual([sepCard.id]);
    expect(narrow.accounts).toHaveLength(2); // the filter never narrows the account list
  });

  it("400s on a malformed month or account id", async () => {
    const app = harness();
    for (const query of ["month=2026-13", "month=september", "accountId=abc", "accountId=0"]) {
      const res = await app.request(`/api/transactions?${query}`);
      expect(res.status, query).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_request" });
    }
  });
});

describe("POST /api/transactions/:id/bucket", () => {
  it("files the transaction by hand and leaves the rules file alone", async () => {
    const app = harness();
    const t = seed("MYSTERY SHOP", -12);
    const res = await app.request(`/api/transactions/${t.id}/bucket`, json({ bucket: "fun-money" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transaction: { id: t.id, bucketId: "fun-money", bucketSource: "manual" }, rule: null, categorized: { applied: true } });
    expect(fs.existsSync(rulesPath(dir))).toBe(false);
    expect((await (await app.request("/api/review")).json()).transactions).toEqual([]);
  });

  it("with saveRule appends a rule matching the trimmed description and files the rest of the inbox", async () => {
    const app = harness();
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, rules: [{ match: "RENT", bucket: "rent", notes: "keep" }] }));
    const first = seed("  Grocery Mart #12 ", -50);
    const second = seed("GROCERY MART #77", -20);
    const res = await app.request(`/api/transactions/${first.id}/bucket`, json({ bucket: "meals", saveRule: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rule: { match: "Grocery Mart #12", bucket: "meals" }, categorized: { applied: true, counts: { filed: 0, unmatched: 1 } } });
    expect(readRules()).toEqual({ version: 1, rules: [{ match: "RENT", bucket: "rent", notes: "keep" }, { match: "Grocery Mart #12", bucket: "meals" }] });
    expect(getTransaction(db, first.id)).toMatchObject({ bucketId: "meals", bucketSource: "manual" });
    expect(getTransaction(db, second.id)).toMatchObject({ bucketId: null }); // "#12" is not in "#77"

    const again = await app.request(`/api/transactions/${second.id}/bucket`, json({ bucket: "meals", saveRule: true, match: "grocery mart" }));
    expect(again.status).toBe(200);
    expect(readRules().rules).toHaveLength(3);
    const third = seed("GROCERY MART #99", -5);
    await app.request("/api/sync", { method: "POST" });
    expect(getTransaction(db, third.id)).toMatchObject({ bucketId: "meals", bucketSource: "rule" });
  });

  it("accepts reserved ids and records a card transfer as a debt payment", async () => {
    const app = harness();
    const card = upsertAccount(db, { connector: "fake", externalId: "card", name: "Card", institution: "Issuer", type: "credit" }, now).id;
    setAccountRole(db, card, "card");
    setAccountLinks(db, card, { linkedGoalIds: [], linkedDebtId: "card-a" });
    const t = seed("ONLINE PAYMENT", 300, { accountId: card });
    const res = await app.request(`/api/transactions/${t.id}/bucket`, json({ bucket: "_transfer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transaction: { bucketId: "_transfer", debtId: "card-a" } });
  });

  it("422s on a bucket the plan does not know, before touching anything", async () => {
    const app = harness();
    const t = seed("MYSTERY SHOP", -12);
    const res = await app.request(`/api/transactions/${t.id}/bucket`, json({ bucket: "yachts", saveRule: true }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "unknown_bucket" });
    expect(getTransaction(db, t.id)).toMatchObject({ bucketSource: "none" });
    expect(fs.existsSync(rulesPath(dir))).toBe(false);
  });

  it("404s on an unknown transaction and 400s on bad ids and bodies", async () => {
    const app = harness();
    expect((await app.request("/api/transactions/999/bucket", json({ bucket: "meals" }))).status).toBe(404);
    expect((await app.request("/api/transactions/abc/bucket", json({ bucket: "meals" }))).status).toBe(400);
    expect((await app.request("/api/transactions/1/bucket", json({ bucket: "" }))).status).toBe(400);
    expect((await app.request("/api/transactions/1/bucket", json({ bucket: "meals", match: " " }))).status).toBe(400);
    const broken = await app.request("/api/transactions/1/bucket", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: "bad_request", message: expect.stringContaining("JSON") });
  });

  it("409s when there is no valid plan, or when saving into a broken rules file", async () => {
    const app = harness();
    const t = seed("MYSTERY SHOP", -12);
    fs.writeFileSync(rulesPath(dir), "{ nope");
    const rules = await app.request(`/api/transactions/${t.id}/bucket`, json({ bucket: "meals", saveRule: true }));
    expect(rules.status).toBe(409);
    expect(await rules.json()).toMatchObject({ error: "rules_invalid", path: rulesPath(dir) });
    expect(fs.readFileSync(rulesPath(dir), "utf8")).toBe("{ nope");
    expect(getTransaction(db, t.id)).toMatchObject({ bucketSource: "none" }); // still in the inbox

    fs.rmSync(path.join(dir, "plan.json"));
    const review = await (await app.request("/api/review")).json();
    expect(review.buckets).toEqual(["_transfer", "_income", "_interest", "_uncategorized"]);
    const plan = await app.request(`/api/transactions/${t.id}/bucket`, json({ bucket: "meals" }));
    expect(plan.status).toBe(409);
    expect(await plan.json()).toMatchObject({ error: "plan_missing" });
  });
});

describe("categorization at the end of a sync", () => {
  it("files what the connector brought using the rules file, and reports it on the result", async () => {
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, rules: [{ match: "COFFEE", bucket: "meals" }] }));
    const connector = fakeConnector({
      accounts: [account()],
      transactions: [transaction({ externalId: "a", description: "CORNER COFFEE" }), transaction({ externalId: "b", description: "UNKNOWN" })],
    });
    const app = harness(connector);
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 2, categorized: { applied: true, counts: { filed: 1, unmatched: 1 } }, warnings: [] });
    const review = await (await app.request("/api/review")).json();
    expect(review.transactions.map((t: { description: string }) => t.description)).toEqual(["UNKNOWN"]);
  });

  it("keeps the batch and warns when the rules file cannot be read at all", async () => {
    fs.mkdirSync(rulesPath(dir)); // a directory where the file should be -> EISDIR
    const app = harness(fakeConnector({ accounts: [account()], transactions: [transaction()] }));
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 1, categorized: { applied: false }, warnings: [expect.stringContaining("EISDIR")] });
  });

  it("warns instead of failing when the rules file names a bucket the plan lacks", async () => {
    fs.writeFileSync(rulesPath(dir), JSON.stringify({ version: 1, rules: [{ match: "COFFEE", bucket: "yachts" }] }));
    const app = harness(fakeConnector({ accounts: [account()], transactions: [transaction()] }));
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 1, categorized: { applied: false }, warnings: [expect.stringContaining("rules.0.bucket")] });
  });
});
