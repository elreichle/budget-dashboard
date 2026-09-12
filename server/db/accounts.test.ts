import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./index.js";
import { getAccount, listAccounts, setAccountLinks, setAccountRole, upsertAccount } from "./accounts.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

const now = "2026-09-01T12:00:00.000Z";
const base = { connector: "simplefin", externalId: "acc-1", name: "Everyday Checking", institution: "Sample Bank", type: "checking" };

describe("accounts", () => {
  it("inserts a new account with no role and no links", () => {
    const a = upsertAccount(db, base, now);
    expect(a).toMatchObject({ ...base, id: expect.any(Number), role: null, linkedGoalIds: [], linkedDebtId: null, createdAt: now });
    expect(listAccounts(db)).toEqual([a]);
  });

  it("upserting the same connector+external id updates the connector fields but keeps role, links and created_at", () => {
    const a = upsertAccount(db, base, now);
    setAccountRole(db, a.id, "checking");
    setAccountLinks(db, a.id, { linkedGoalIds: ["buffer"], linkedDebtId: null });
    const later = "2026-09-02T12:00:00.000Z";
    const b = upsertAccount(db, { ...base, name: "Renamed Checking", institution: "Sample Bank Corp" }, later);
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ name: "Renamed Checking", institution: "Sample Bank Corp", role: "checking", linkedGoalIds: ["buffer"], createdAt: now });
    expect(listAccounts(db)).toHaveLength(1);
  });

  it("stores role and links per account", () => {
    const a = upsertAccount(db, base, now);
    const card = upsertAccount(db, { ...base, externalId: "acc-2", name: "Rewards Card", type: "credit" }, now);
    setAccountRole(db, card.id, "card");
    setAccountLinks(db, card.id, { linkedGoalIds: [], linkedDebtId: "card-a" });
    expect(getAccount(db, card.id)).toMatchObject({ role: "card", linkedDebtId: "card-a", linkedGoalIds: [] });
    expect(getAccount(db, a.id)).toMatchObject({ role: null });
    expect(getAccount(db, 999)).toBeUndefined();
  });

  it("lists accounts ordered by institution then name and can filter by connector", () => {
    upsertAccount(db, { ...base, externalId: "z", name: "Zed", institution: "Alpha Bank" }, now);
    upsertAccount(db, { ...base, externalId: "a", name: "Alpha", institution: "Alpha Bank" }, now);
    upsertAccount(db, { ...base, connector: "csv", externalId: "c", name: "CSV Card", institution: "Beta Cards" }, now);
    expect(listAccounts(db).map((a) => a.name)).toEqual(["Alpha", "Zed", "CSV Card"]);
    expect(listAccounts(db, { connector: "csv" }).map((a) => a.name)).toEqual(["CSV Card"]);
  });
});
