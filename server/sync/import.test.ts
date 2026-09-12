import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { GENERIC_WITH_BAD_ROWS, SIGNED_CARD, SPLIT_WITH_STATUS } from "../connectors/__fixtures__/csvFiles.js";
import { CSV_PRESETS_FILENAME } from "../connectors/csvPresets.js";
import { CSV_TEMPLATES } from "../connectors/csvTemplates.js";
import { listAccounts, listSyncRuns, listTransactions, openDatabase, upsertAccount, upsertTransaction } from "../db/index.js";
import { createServices } from "../services.js";
import { fakeConnector } from "./__fixtures__/fakeConnector.js";
import { importCsv } from "./import.js";

/** A presets file: a split-amount card built on `generic`, and an account that only renames the institution. */
const PRESETS = {
  version: 1,
  presets: {
    card: { template: "generic", label: "Example card", institution: "Example Card Co", accountType: "credit", amount: { kind: "split", debit: ["Debit"], credit: ["Credit"] }, pending: { columns: ["Status"], value: "Pending" } },
    everyday: { template: "generic", institution: "Example Bank" },
  },
};

/** With `presets`, the data dir is a fresh temp dir holding them as csv-presets.json; without, it does not exist. */
function harness(presets?: unknown) {
  let dataDir = "/nonexistent/never-touched";
  if (presets !== undefined) {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "csv-import-"));
    writeFileSync(path.join(dataDir, CSV_PRESETS_FILENAME), JSON.stringify(presets));
  }
  const config = loadConfig({ DATA_DIR: dataDir });
  const db = openDatabase(":memory:");
  const services = createServices(config, { db, connector: fakeConnector(), now: () => "2026-09-09T12:00:00.000Z" });
  return { app: createApp(config, services), db };
}

function upload(app: ReturnType<typeof harness>["app"], fields: Record<string, string>, file?: string | Blob) {
  const form = new FormData();
  if (file !== undefined) form.append("file", file instanceof Blob ? file : new File([file], "export.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return app.request("/api/import/csv", { method: "POST", body: form });
}

describe("POST /api/import/csv", () => {
  it("imports into an existing account and re-importing the same file changes nothing", async () => {
    const { app, db } = harness();
    const acct = upsertAccount(db, { connector: "simplefin", externalId: "x", name: "Rewards Card", institution: "Example Bank", type: "credit" }, "2026-09-01T00:00:00.000Z");

    const first = await upload(app, { preset: "generic", accountId: String(acct.id) }, SIGNED_CARD);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ inserted: 3, updated: 0, skipped: 0, skippedOverlap: 0, categorized: { applied: false }, warnings: [expect.stringContaining("no plan file")], account: { id: acct.id, name: "Rewards Card" }, run: { connector: "csv", accountsN: 1, transactionsN: 3, error: null } });

    const again = await upload(app, { preset: "generic", accountId: String(acct.id) }, SIGNED_CARD);
    expect(await again.json()).toMatchObject({ inserted: 0, updated: 3 });
    const rows = listTransactions(db, { accountId: acct.id });
    expect(rows).toHaveLength(3);
    expect(rows.every((t) => t.connector === "csv")).toBe(true);
    expect(rows.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-82.13, -4.5, 250]);
  });

  it("into an account SimpleFIN syncs, imports only rows dated before its first SimpleFIN transaction, idempotently", async () => {
    const { app, db } = harness();
    const acct = upsertAccount(db, { connector: "simplefin", externalId: "x", name: "Rewards Card", institution: "Example Bank", type: "credit" }, "2026-09-01T00:00:00.000Z");
    upsertTransaction(db, { accountId: acct.id, connector: "simplefin", externalId: "sf-1", date: "2026-09-02", pending: false, amount: -82.13, description: "GROCERY MART" }, "2026-09-05T00:00:00.000Z");

    const first = await (await upload(app, { preset: "generic", accountId: String(acct.id) }, SIGNED_CARD)).json();
    expect(first).toMatchObject({ inserted: 1, updated: 0, skippedOverlap: 2, run: { transactionsN: 1 } });
    expect(first.warnings).toContainEqual(expect.stringContaining("dated 2026-09-02 or later"));

    const again = await (await upload(app, { preset: "generic", accountId: String(acct.id) }, SIGNED_CARD)).json();
    expect(again).toMatchObject({ inserted: 0, updated: 1, skippedOverlap: 2 });
    expect(listTransactions(db, { accountId: acct.id }).map((t) => [t.connector, t.date])).toEqual([
      ["simplefin", "2026-09-02"],
      ["csv", "2026-09-01"],
    ]);
  });

  it("imports every row into an account without SimpleFIN rows, even when another account has them", async () => {
    const { app, db } = harness();
    const synced = upsertAccount(db, { connector: "simplefin", externalId: "x", name: "Checking", institution: "Example Bank", type: "checking" }, "2026-09-01T00:00:00.000Z");
    upsertTransaction(db, { accountId: synced.id, connector: "simplefin", externalId: "sf-1", date: "2026-08-01", pending: false, amount: -10, description: "Garden Center" }, "2026-09-05T00:00:00.000Z");

    const body = await (await upload(app, { preset: "generic", accountName: "Wallet" }, SIGNED_CARD)).json();
    expect(body).toMatchObject({ inserted: 3, skippedOverlap: 0 });
    expect(body.warnings).not.toContainEqual(expect.stringContaining("SimpleFIN"));
  });

  it("creates a csv account from accountName once, reuses it without renaming, and skips pending rows", async () => {
    const { app, db } = harness(PRESETS);
    const res = await upload(app, { preset: "card", accountName: "Travel Card" }, SPLIT_WITH_STATUS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ inserted: 2, pendingIgnored: 1, account: { name: "Travel Card", institution: "Example Card Co" } });
    const accounts = listAccounts(db, { connector: "csv" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ externalId: "card:travel-card", type: "credit", role: null });

    await upload(app, { preset: "card", accountName: "  travel card " }, SPLIT_WITH_STATUS);
    expect(listAccounts(db, { connector: "csv" })).toEqual([expect.objectContaining({ name: "Travel Card" })]);
    expect(listTransactions(db, { accountId: accounts[0]!.id })).toHaveLength(2);
    expect(listTransactions(db, { pending: true })).toEqual([]);
  });

  it("treats blank form fields as absent, so a form with both inputs can leave one empty", async () => {
    const { app, db } = harness();
    const byName = await upload(app, { preset: "generic", accountId: "", accountName: "Wallet" }, GENERIC_WITH_BAD_ROWS);
    expect(byName.status).toBe(200);
    const id = listAccounts(db, { connector: "csv" })[0]!.id;
    const byId = await upload(app, { preset: "generic", accountId: String(id), accountName: "   " }, GENERIC_WITH_BAD_ROWS);
    expect(byId.status).toBe(200);
    expect(await byId.json()).toMatchObject({ updated: 1, account: { id } });
  });

  it("rejects an account name with no letters or digits", async () => {
    const { app, db } = harness();
    const res = await upload(app, { preset: "generic", accountName: "***" }, SIGNED_CARD);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: expect.stringContaining("accountName") });
    expect(listAccounts(db)).toEqual([]);
  });

  it("reports skipped rows with warnings and still records a run", async () => {
    const { app, db } = harness();
    const res = await upload(app, { preset: "generic", accountName: "Wallet" }, GENERIC_WITH_BAD_ROWS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 1, skipped: 3, warnings: [expect.stringContaining("line 3"), expect.stringContaining("line 4"), expect.stringContaining("line 5"), expect.stringContaining("no plan file")] });
    expect(listSyncRuns(db)[0]).toMatchObject({ connector: "csv", transactionsN: 1, error: null });
  });

  it("422s with bad_file when the header does not match the preset, recording the failed run and no account", async () => {
    const { app, db } = harness(PRESETS);
    const res = await upload(app, { preset: "card", accountName: "Cash Back" }, "Date,Description,Amount\n2026-09-01,x,1\n");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: "bad_file", message: expect.stringContaining('"card" preset expects') });
    expect(listSyncRuns(db)[0]).toMatchObject({ connector: "csv", error: body.message });
    expect(listTransactions(db)).toEqual([]);
    expect(listAccounts(db, { connector: "csv" })).toEqual([]);
  });

  it("400s on a missing file, an unknown preset, or neither/both account fields; 404s on an unknown account", async () => {
    const { app } = harness();
    const noFile = await upload(app, { preset: "generic", accountId: "1" });
    expect(noFile.status).toBe(400);
    expect(await noFile.json()).toMatchObject({ error: "bad_request", message: expect.stringContaining("file") });

    const badPreset = await upload(app, { preset: "plaid", accountId: "1" }, SIGNED_CARD);
    expect(badPreset.status).toBe(400);
    expect(await badPreset.json()).toMatchObject({ message: expect.stringContaining("preset") });

    const neither = await upload(app, { preset: "generic" }, SIGNED_CARD);
    expect(neither.status).toBe(400);
    const both = await upload(app, { preset: "generic", accountId: "1", accountName: "x" }, SIGNED_CARD);
    expect(both.status).toBe(400);

    const unknown = await upload(app, { preset: "generic", accountId: "999" }, SIGNED_CARD);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "unknown_account" });

    const notMultipart = await app.request("/api/import/csv", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(notMultipart.status).toBe(400);
  });

  it("accepts only presets the data dir's presets file names", async () => {
    const { app, db } = harness(PRESETS);
    const res = await upload(app, { preset: "generic", accountName: "Wallet" }, SIGNED_CARD);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request", message: expect.stringContaining('no preset named "generic"') });
    expect(listSyncRuns(db)).toEqual([]);
  });

  it("422s csv_presets_invalid when the presets file is invalid, before recording a run", async () => {
    const { app, db } = harness({ version: 1, presets: {} });
    const res = await upload(app, { preset: "generic", accountName: "Wallet" }, SIGNED_CARD);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "csv_presets_invalid", path: expect.stringContaining(CSV_PRESETS_FILENAME), issues: [expect.objectContaining({ message: expect.stringContaining("at least one") })] });
    expect(listSyncRuns(db)).toEqual([]);
  });

  it("413s an oversized upload, by Content-Length and by stream", async () => {
    const { app } = harness();
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.csv");
    const streamed = await upload(app, { preset: "generic", accountName: "Wallet" }, big);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toMatchObject({ error: "file_too_large" });

    const declared = await app.request("/api/import/csv", { method: "POST", body: "x", headers: { "content-length": String(9 * 1024 * 1024), "content-type": "text/plain" } });
    expect(declared.status).toBe(413);
  });

  it("does not disturb the SimpleFIN sync status", async () => {
    const { app } = harness();
    await upload(app, { preset: "generic", accountName: "Rewards" }, SIGNED_CARD);
    const status = await (await app.request("/api/sync/status")).json();
    expect(status).toEqual({ running: false, last: null });
  });
});

describe("GET /api/import/csv/presets", () => {
  it("lists every template when the data dir has no presets file", async () => {
    const { app } = harness();
    const res = await app.request("/api/import/csv/presets");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((p: { name: string }) => p.name)).toEqual(Object.keys(CSV_TEMPLATES));
    const [first] = Object.entries(CSV_TEMPLATES);
    expect(body[0]).toEqual({ name: first![0], label: first![1].label, institution: first![1].institution });
  });

  it("lists only the presets file's presets, in its order, with their overrides", async () => {
    const { app } = harness(PRESETS);
    const body = await (await app.request("/api/import/csv/presets")).json();
    expect(body).toEqual([
      { name: "card", label: "Example card", institution: "Example Card Co" },
      { name: "everyday", label: CSV_TEMPLATES.generic!.label, institution: "Example Bank" },
    ]);
  });

  it("422s with the file's problems when the presets file is invalid", async () => {
    const { app } = harness({ version: 1, presets: { card: { template: "nope" } } });
    const res = await app.request("/api/import/csv/presets");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "csv_presets_invalid", issues: [expect.objectContaining({ message: expect.stringContaining("unknown template") })] });
  });
});

describe("importCsv", () => {
  it("throws on an unknown account before writing anything", () => {
    const { db } = harness();
    expect(() => importCsv(db, { text: SIGNED_CARD, preset: { name: "generic", ...CSV_TEMPLATES.generic! }, target: { accountId: 42 } }, () => "2026-09-09T12:00:00.000Z")).toThrow(/No account 42/);
    expect(listSyncRuns(db)).toEqual([]);
  });
});
