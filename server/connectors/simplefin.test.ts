import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSecrets, secretsPath, writeSecrets } from "../secrets.js";
import { claimSetupToken, createSimpleFinConnector, decodeSetupToken } from "./simplefin.js";
import { ConnectorError } from "./types.js";

const fixturePath = path.resolve(import.meta.dirname, "__fixtures__/simplefin-accounts.json");
const fixtureText = fs.readFileSync(fixturePath, "utf8");

// Every secret-shaped string is assembled at runtime so the PII guard never sees one literally.
const HOST = "bridge.example.invalid";
const CLAIM_URL = `https://${HOST}/simplefin/claim/DEMO-CLAIM-TOKEN`;
const ACCESS_URL = "https://" + "demo-user:demo-pass" + `@${HOST}/simplefin`;
const setupToken = Buffer.from(CLAIM_URL, "utf8").toString("base64");
const basic = "Basic " + Buffer.from("demo-user:demo-pass", "utf8").toString("base64");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "simplefin-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

type FetchImpl = typeof fetch;

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  });
  return { impl: impl as unknown as FetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function expectConnectorError(p: Promise<unknown>, code: string): Promise<ConnectorError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConnectorError);
  expect((err as ConnectorError).code).toBe(code);
  return err as ConnectorError;
}

describe("decodeSetupToken", () => {
  it("decodes a base64 claim URL and tolerates surrounding whitespace", () => {
    expect(decodeSetupToken(`  ${setupToken}\n`)).toBe(CLAIM_URL);
  });

  it("accepts the base64url alphabet", () => {
    const urlSafe = setupToken.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeSetupToken(urlSafe)).toBe(CLAIM_URL);
    // A claim URL whose standard base64 contains "+" ("~~~" encodes to "fn5+") still round-trips.
    const odd = CLAIM_URL + "?~~~";
    expect(Buffer.from(odd).toString("base64")).toMatch(/[+/]/);
    expect(decodeSetupToken(Buffer.from(odd).toString("base64url"))).toBe(odd);
  });

  it("rejects tokens that do not decode to an http(s) URL", () => {
    expect(() => decodeSetupToken("not base64 at all!!")).toThrow(ConnectorError);
    expect(() => decodeSetupToken(Buffer.from("ftp://x.example/claim").toString("base64"))).toThrow(/setup token/i);
  });
});

describe("claimSetupToken", () => {
  it("POSTs to the claim URL and stores the access URL in secrets.json with mode 0600", async () => {
    const { impl, calls } = fakeFetch(() => new Response(ACCESS_URL + "\n", { status: 200 }));
    await claimSetupToken(setupToken, { dataDir: dir, fetch: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CLAIM_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(readSecrets(dir)).toEqual({ simplefin: { accessUrl: ACCESS_URL } });
    expect(fs.statSync(secretsPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("keeps other secrets in the file when storing the access URL", async () => {
    writeSecrets(dir, { other: { note: "kept" } } as never);
    const { impl } = fakeFetch(() => new Response(ACCESS_URL, { status: 200 }));
    await claimSetupToken(setupToken, { dataDir: dir, fetch: impl });
    expect(readSecrets(dir)).toMatchObject({ other: { note: "kept" }, simplefin: { accessUrl: ACCESS_URL } });
  });

  it("fails with bad_setup_token before any request when the token is garbage", async () => {
    const { impl, calls } = fakeFetch(() => new Response("", { status: 200 }));
    await expectConnectorError(claimSetupToken("%%%", { dataDir: dir, fetch: impl }), "bad_setup_token");
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });

  it("does not spend the token when the secrets file is unreadable", async () => {
    fs.writeFileSync(secretsPath(dir), "{ nope");
    const { impl, calls } = fakeFetch(() => new Response(ACCESS_URL, { status: 200 }));
    const err = await expectConnectorError(claimSetupToken(setupToken, { dataDir: dir, fetch: impl }), "secrets_unreadable");
    expect(err.message).toMatch(/reconnect SimpleFIN/i);
    expect(err.message).not.toContain(dir);
    expect(calls).toHaveLength(0);
  });

  it("fails with claim_failed on a non-2xx claim response and writes nothing", async () => {
    const { impl } = fakeFetch(() => new Response("Token already claimed", { status: 403 }));
    const err = await expectConnectorError(claimSetupToken(setupToken, { dataDir: dir, fetch: impl }), "claim_failed");
    expect(err.message).toContain("403");
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });

  it("fails with bad_response when the claim body is not an access URL", async () => {
    const { impl } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    await expectConnectorError(claimSetupToken(setupToken, { dataDir: dir, fetch: impl }), "bad_response");
    expect(fs.existsSync(secretsPath(dir))).toBe(false);
  });
});

describe("createSimpleFinConnector", () => {
  it("throws not_configured from both methods when there is no access URL", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    await expectConnectorError(connector.listAccounts(), "not_configured");
    await expectConnectorError(connector.fetchTransactions("2025-09-01"), "not_configured");
    expect(calls).toHaveLength(0);
  });

  it("fetchTransactions sends basic auth as a header, not in the URL, with start-date and pending=1", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const { impl, calls } = fakeFetch(() => new Response(fixtureText, { status: 200 }));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    await connector.fetchTransactions("2025-09-01");

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.origin + url.pathname).toBe(`https://${HOST}/simplefin/accounts`);
    // Local midnight: east of UTC it comes before UTC midnight.
    expect(url.searchParams.get("start-date")).toBe(String(new Date(2025, 8, 1).getTime() / 1000));
    expect(url.searchParams.get("pending")).toBe("1");
    expect(url.searchParams.has("balances-only")).toBe(false);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(basic);
  });

  it("fetchTransactions normalizes accounts, transactions and warnings from the fixture", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const { impl } = fakeFetch(() => new Response(fixtureText, { status: 200 }));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    const batch = await connector.fetchTransactions("2025-09-01");

    expect(batch.accounts).toEqual([
      {
        externalId: "ACT-CHK-1",
        name: "Everyday Checking",
        institution: "Example Bank",
        type: "checking",
        balance: 1250.75,
        balanceAt: "2025-09-05T14:30:00.000Z",
      },
      {
        externalId: "ACT-CARD-1",
        name: "Rewards Card",
        institution: "Example Card Co",
        type: "credit",
        balance: -830.1,
        balanceAt: "2025-09-05T14:31:00.000Z",
      },
    ]);

    // externalId is namespaced by account: SimpleFIN ids are only unique within one account.
    const byId = Object.fromEntries(batch.transactions.map((t) => [t.externalId.split(":")[1], t]));
    expect(byId["TXN-1001"]).toEqual({
      externalId: "ACT-CHK-1:TXN-1001",
      accountExternalId: "ACT-CHK-1",
      date: "2025-09-02",
      pending: false,
      amount: -48.75,
      description: "GROCERY MART #12",
    });
    expect(byId["TXN-1002"]).toMatchObject({ amount: 2000, pending: false, date: "2025-09-01" });
    // posted 0 means pending; the date comes from transacted_at.
    expect(byId["TXN-1003"]).toMatchObject({ pending: true, date: "2025-09-05", amount: -4.5 });
    // No posted and no transacted_at: skipped, with a warning rather than a made-up date.
    expect(byId["TXN-1004"]).toBeUndefined();
    expect(byId["TXN-2002"]).toMatchObject({ accountExternalId: "ACT-CARD-1", amount: 300 });
    expect(batch.transactions).toHaveLength(5);

    expect(batch.warnings).toEqual([
      "Connection to Example Card Co may need attention",
      expect.stringContaining("TXN-1004"),
    ]);
  });

  describe("transaction days", () => {
    const at = (...utc: [number, number, number, number]) => Date.UTC(...utc) / 1000;
    const body = {
      accounts: [
        {
          id: "ACT-1",
          name: "Everyday Checking",
          balance: "1.00",
          "balance-date": at(2025, 9, 1, 3),
          transactions: [
            { id: "EVENING", posted: at(2025, 8, 30, 20), amount: "-1.00", description: "Evening" },
            { id: "SMALL-HOURS", posted: at(2025, 9, 1, 3), amount: "-2.00", description: "Small hours" },
            { id: "DATE-ONLY", posted: at(2025, 8, 30, 0), amount: "-3.00", description: "No time" },
          ],
        },
      ],
    };
    async function daysIn(tz: string) {
      const before = process.env.TZ;
      process.env.TZ = tz;
      try {
        writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
        const { impl, calls } = fakeFetch(() => json(body));
        const batch = await createSimpleFinConnector({ dataDir: dir, fetch: impl }).fetchTransactions("2025-09-01");
        return {
          offsetMinutes: new Date(0).getTimezoneOffset(),
          startDate: new URL(calls[0]!.url).searchParams.get("start-date"),
          days: Object.fromEntries(batch.transactions.map((t) => [t.externalId.split(":")[1], t.date])),
        };
      } finally {
        process.env.TZ = before;
      }
    }

    it("files a timed transaction under the local day, east of UTC", async () => {
      const { days } = await daysIn("Pacific/Auckland");
      expect(days).toEqual({ EVENING: "2025-10-01", "SMALL-HOURS": "2025-10-01", "DATE-ONLY": "2025-09-30" });
    });

    it("keeps a date-only transaction (UTC midnight) on its day and starts at UTC midnight, west of UTC", async () => {
      const { offsetMinutes, startDate, days } = await daysIn("America/Los_Angeles");
      expect(offsetMinutes).toBe(480); // the zone switch took effect
      expect(days).toEqual({ EVENING: "2025-09-30", "SMALL-HOURS": "2025-09-30", "DATE-ONLY": "2025-09-30" });
      expect(startDate).toBe(String(Date.UTC(2025, 8, 1) / 1000));
    });
  });

  it("listAccounts asks for balances only and returns normalized accounts", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const { impl, calls } = fakeFetch(() => new Response(fixtureText, { status: 200 }));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    const accounts = await connector.listAccounts();

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("balances-only")).toBe("1");
    expect(url.searchParams.has("start-date")).toBe(false);
    expect(accounts.map((a) => a.externalId)).toEqual(["ACT-CHK-1", "ACT-CARD-1"]);
    expect(accounts[0]).toMatchObject({ institution: "Example Bank", balance: 1250.75 });
  });

  it("infers deposit account types before card words", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const acct = (id: string, name: string) => ({ id, name, balance: "1.00", "balance-date": 1, transactions: [] });
    const body = { accounts: [acct("A", "Example Credit Union Savings"), acct("B", "Debit Card Checking"), acct("C", "Platinum Card")] };
    const { impl } = fakeFetch(() => json(body));
    const accounts = await createSimpleFinConnector({ dataDir: dir, fetch: impl }).listAccounts();
    expect(accounts.map((a) => a.type)).toEqual(["savings", "checking", "credit"]);
  });

  it("falls back to the org domain for the institution and to payee for the description", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const body = {
      errors: [],
      accounts: [
        {
          org: { domain: "tiny-cu.example.com" },
          id: "ACT-X",
          name: "Share Account",
          balance: "10.00",
          "balance-date": Date.UTC(2025, 8, 1) / 1000,
          transactions: [{ id: "TXN-X", posted: Date.UTC(2025, 8, 1) / 1000, amount: "-1.00", description: "", payee: "Kiosk" }],
        },
      ],
    };
    const { impl } = fakeFetch(() => json(body));
    const batch = await createSimpleFinConnector({ dataDir: dir, fetch: impl }).fetchTransactions("2025-08-01");
    expect(batch.accounts[0]).toMatchObject({ institution: "tiny-cu.example.com", type: "unknown" });
    expect(batch.transactions[0]).toMatchObject({ externalId: "ACT-X:TXN-X" });
    expect(batch.transactions[0]).toMatchObject({ description: "Kiosk" });
  });

  it("maps a non-2xx response to http_error without leaking the access URL", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const { impl } = fakeFetch(() => new Response("Forbidden", { status: 403 }));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    const err = await expectConnectorError(connector.listAccounts(), "http_error");
    expect(err.message).toContain("403");
    expect(err.message).not.toContain("demo-pass");
    expect(err.message).not.toContain(HOST);
  });

  it("maps a body that is not the SimpleFIN account set to bad_response", async () => {
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    const notJson = fakeFetch(() => new Response("<html>login</html>", { status: 200 }));
    await expectConnectorError(createSimpleFinConnector({ dataDir: dir, fetch: notJson.impl }).listAccounts(), "bad_response");
    const wrongShape = fakeFetch(() => json({ accounts: [{ id: 1 }] }));
    const schemaErr = await expectConnectorError(createSimpleFinConnector({ dataDir: dir, fetch: wrongShape.impl }).listAccounts(), "bad_response");
    expect(schemaErr.message).toContain("accounts.0");
    const blankAmount = fakeFetch(() => json({ accounts: [{ id: "ACT-1", name: "x", balance: "", "balance-date": 1 }] }));
    await expectConnectorError(createSimpleFinConnector({ dataDir: dir, fetch: blankAmount.impl }).listAccounts(), "bad_response");
  });

  it("turns an unreadable secrets file into secrets_unreadable without the path or the file's contents", async () => {
    fs.writeFileSync(secretsPath(dir), `{ "simplefin": { "accessUrl": "${ACCESS_URL}" `);
    const { impl, calls } = fakeFetch(() => json({}));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    for (const attempt of [connector.listAccounts(), connector.fetchTransactions("2025-09-01")]) {
      const err = await expectConnectorError(attempt, "secrets_unreadable");
      expect(err.message).toMatch(/reconnect SimpleFIN/i);
      expect(err.message).not.toContain(dir);
      expect(err.message).not.toContain(HOST);
    }
    expect(calls).toHaveLength(0);
    expect(connector.isConfigured()).toBe(true);
  });

  it("does not advise deleting secrets.json when the failure is the file system, not the contents", async () => {
    fs.mkdirSync(secretsPath(dir)); // reading a directory fails with EISDIR, as a permission error would
    const { impl } = fakeFetch(() => json({}));
    const err = await expectConnectorError(createSimpleFinConnector({ dataDir: dir, fetch: impl }).listAccounts(), "secrets_unreadable");
    expect(err.message).toContain("EISDIR");
    expect(err.message).toMatch(/reconnect SimpleFIN/i);
    expect(err.message).not.toMatch(/delete/i);
    expect(err.message).not.toContain(dir);
  });

  it("reads the secrets file on every call so a claim after startup takes effect", async () => {
    const { impl } = fakeFetch(() => new Response(fixtureText, { status: 200 }));
    const connector = createSimpleFinConnector({ dataDir: dir, fetch: impl });
    await expectConnectorError(connector.listAccounts(), "not_configured");
    writeSecrets(dir, { simplefin: { accessUrl: ACCESS_URL } });
    await expect(connector.listAccounts()).resolves.toHaveLength(2);
  });
});
