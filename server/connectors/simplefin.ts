import { z } from "zod";
import { localDate } from "../clock.js";
import { issueMessage } from "../http/errors.js";
import { readSecrets, writeSecrets, type Secrets } from "../secrets.js";
import { ConnectorError, type Connector, type ConnectorBatch, type NormalizedAccount, type NormalizedTransaction } from "./types.js";

/**
 * SimpleFIN Bridge connector (https://www.simplefin.org/protocol.html).
 *
 * Setup: the user pastes a one-time setup token, the base64 of a claim URL. POSTing to it once
 * returns an access URL of the form `https://<user>:<password>@<host>/simplefin`, which is the
 * only credential and is kept in `<DATA_DIR>/secrets.json`. Reading data is a GET on
 * `<accessUrl>/accounts`. Nothing in this module logs or throws the access URL.
 */

export const SIMPLEFIN_CONNECTOR_ID = "simplefin";

export interface SimpleFinOptions {
  dataDir: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const SfTransaction = z.object({
  id: z.string(),
  /** Unix seconds; 0 while the transaction is pending. */
  posted: z.number(),
  /** Decimal string, spending negative. */
  amount: z.string(),
  description: z.string().default(""),
  payee: z.string().optional(),
  memo: z.string().optional(),
  /** Unix seconds of the authorization; the only date a pending transaction has. */
  transacted_at: z.number().optional(),
  pending: z.boolean().optional(),
});

const SfAccount = z.object({
  org: z.object({ domain: z.string().optional(), name: z.string().optional() }).default({}),
  id: z.string(),
  name: z.string(),
  balance: z.string(),
  "balance-date": z.number(),
  transactions: z.array(SfTransaction).default([]),
});

const SfAccountSet = z.object({
  errors: z.array(z.string()).default([]),
  accounts: z.array(SfAccount),
});

/** Decodes a pasted setup token into its claim URL, or throws `bad_setup_token`. */
export function decodeSetupToken(token: string): string {
  // Pasted tokens often carry a newline or a wrap, and some clients emit the base64url alphabet.
  const normalized = token.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  const url = parseHttpUrl(decoded);
  // base64 decoding never fails, so also require the token to be well-formed base64 of that URL.
  if (!url || Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "") !== normalized) {
    throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "bad_setup_token", "That is not a SimpleFIN setup token: it should decode to a claim URL.");
  }
  return url.toString();
}

/**
 * Exchanges a setup token for an access URL and stores it in secrets.json. A token can be
 * claimed exactly once; failures leave the secrets file untouched.
 */
export async function claimSetupToken(token: string, opts: SimpleFinOptions): Promise<void> {
  const claimUrl = decodeSetupToken(token);
  // A token can be claimed once, so fail on an unreadable secrets file before spending it.
  const current = readStoredSecrets(opts.dataDir);
  const fetchImpl = opts.fetch ?? fetch;
  // The protocol requires an empty POST; an empty string body yields Content-Length: 0.
  const res = await fetchImpl(claimUrl, { method: "POST", body: "" });
  const body = (await res.text()).trim();
  if (!res.ok) {
    throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "claim_failed", `SimpleFIN rejected the setup token (HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}). Generate a new one; each token can be claimed once.`);
  }
  const accessUrl = parseHttpUrl(body);
  if (!accessUrl || !accessUrl.username) {
    throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "bad_response", "SimpleFIN's claim response was not an access URL.");
  }
  writeSecrets(opts.dataDir, { ...current, simplefin: { accessUrl: accessUrl.toString() } });
}

export function createSimpleFinConnector(opts: SimpleFinOptions): Connector {
  const fetchImpl = opts.fetch ?? fetch;

  // Read per call, not at construction: claiming a token while the server runs must take effect.
  function accessUrl(): URL {
    const stored = readStoredSecrets(opts.dataDir).simplefin?.accessUrl;
    if (!stored) {
      throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "not_configured", "SimpleFIN is not connected yet. Paste a setup token from your SimpleFIN Bridge account.");
    }
    return new URL(stored);
  }

  async function getAccountSet(params: Record<string, string>): Promise<z.infer<typeof SfAccountSet>> {
    const url = accessUrl();
    // Node's fetch refuses URLs with embedded credentials; move them to a Basic auth header.
    const authorization = "Basic " + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`, "utf8").toString("base64");
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(/\/$/, "") + "/accounts";
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetchImpl(url, { headers: { authorization, accept: "application/json" } });
    if (!res.ok) {
      const hint = res.status === 403 ? " Access was revoked or expired; claim a new setup token." : "";
      throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "http_error", `SimpleFIN returned HTTP ${res.status}.${hint}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "bad_response", "SimpleFIN returned a body that is not JSON.");
    }
    const parsed = SfAccountSet.safeParse(json);
    if (!parsed.success) {
      throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "bad_response", `SimpleFIN returned an unexpected account set at ${issueMessage(parsed.error)}`);
    }
    return parsed.data;
  }

  return {
    id: SIMPLEFIN_CONNECTOR_ID,

    isConfigured() {
      try {
        return readSecrets(opts.dataDir).simplefin?.accessUrl !== undefined;
      } catch {
        return true; // a corrupt secrets file is a problem to report, not "not set up yet"
      }
    },

    async listAccounts() {
      const set = await getAccountSet({ "balances-only": "1" });
      return set.accounts.map(normalizeAccount);
    },

    async fetchTransactions(since) {
      const set = await getAccountSet({ "start-date": String(dayToUnixSeconds(since)), pending: "1" });
      const warnings = [...set.errors];
      const transactions: NormalizedTransaction[] = [];
      for (const account of set.accounts) {
        for (const tx of account.transactions) {
          const normalized = normalizeTransaction(account.id, tx);
          if (normalized) transactions.push(normalized);
          else warnings.push(`Skipped transaction ${tx.id} on account ${account.name}: it has no posted or transacted date.`);
        }
      }
      return { accounts: set.accounts.map(normalizeAccount), transactions, warnings } satisfies ConnectorBatch;
    },
  };
}

/**
 * `readSecrets` as a `ConnectorError`. Its own errors name the file's full path and can quote a
 * fragment of the file, which may hold the access URL, so neither reaches sync_runs or the UI.
 * Only a corrupt file is worth deleting; a file-system error (permissions) keeps working credentials.
 */
function readStoredSecrets(dataDir: string): Secrets {
  try {
    return readSecrets(dataDir);
  } catch (err) {
    const fsCode = (err as NodeJS.ErrnoException).code;
    const message = fsCode
      ? `The stored SimpleFIN credentials cannot be read (${fsCode}). Check that the server can read secrets.json in the data directory, or reconnect SimpleFIN with a new setup token.`
      : "The stored SimpleFIN credentials are corrupt. Reconnect SimpleFIN: delete secrets.json from the data directory, then paste a new setup token.";
    throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "secrets_unreadable", message);
  }
}

function normalizeAccount(a: z.infer<typeof SfAccount>): NormalizedAccount {
  return {
    externalId: a.id,
    name: a.name,
    institution: a.org.name ?? a.org.domain ?? "Unknown institution",
    type: inferAccountType(a.name),
    balance: parseAmount(a.balance, `balance of account ${a.id}`),
    balanceAt: new Date(a["balance-date"] * 1000).toISOString(),
  };
}

function normalizeTransaction(accountExternalId: string, tx: z.infer<typeof SfTransaction>): NormalizedTransaction | undefined {
  const pending = tx.posted === 0 || tx.pending === true;
  const seconds = tx.posted || tx.transacted_at || 0;
  if (seconds === 0) return undefined;
  return {
    // SimpleFIN transaction ids are only unique within an account; ours must be unique per connector.
    externalId: `${accountExternalId}:${tx.id}`,
    accountExternalId,
    date: dayOf(seconds),
    pending,
    amount: parseAmount(tx.amount, `amount of transaction ${tx.id}`),
    description: tx.description || tx.payee || tx.memo || "",
  };
}

/** SimpleFIN gives no account type; a hint from the name saves a click on the roles screen. */
function inferAccountType(name: string): string {
  const n = name.toLowerCase();
  // Deposit words first: "Credit Union Savings" and "Debit Card Checking" are not cards.
  if (/saving/.test(n)) return "savings";
  if (/checking|chequing/.test(n)) return "checking";
  if (/credit|card|visa|mastercard|amex/.test(n)) return "credit";
  return "unknown";
}

/** Only plain decimals: `Number("")` is 0, and a blank amount from a failed refresh must not become $0. */
function parseAmount(s: string, what: string): number {
  const n = /^[-+]?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN;
  if (!Number.isFinite(n)) throw new ConnectorError(SIMPLEFIN_CONNECTOR_ID, "bad_response", `SimpleFIN returned a non-numeric ${what}.`);
  return n;
}

/**
 * Calendar day of a SimpleFIN timestamp. Exactly UTC midnight is how a bank's date without a time
 * arrives, so that is its UTC day (a local day would move it to the day before west of UTC); any
 * other instant is filed under the machine's local day, the same day "today" uses.
 */
function dayOf(seconds: number): string {
  const at = new Date(seconds * 1000);
  return seconds % 86_400 === 0 ? at.toISOString().slice(0, 10) : localDate(at);
}

/**
 * `YYYY-MM-DD` → unix seconds for SimpleFIN's `start-date`: local midnight of that day, or UTC
 * midnight when earlier, so neither a timed row nor a date-only one (see `dayOf`) is cut off.
 */
function dayToUnixSeconds(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const [y, mon, d] = m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : [NaN, NaN, NaN];
  const ms = Math.min(Date.UTC(y, mon, d), new Date(y, mon, d).getTime());
  if (!Number.isFinite(ms)) throw new Error(`Invalid day ${JSON.stringify(day)}; expected YYYY-MM-DD`);
  return ms / 1000;
}

function parseHttpUrl(s: string): URL | undefined {
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}
