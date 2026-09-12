/**
 * The shapes every bank connector produces. The sync pipeline only ever sees these, so a
 * new source (CSV preset, another aggregator) is a new file here and nothing else.
 */

export interface NormalizedAccount {
  /** The connector's own stable id for the account. Unique per connector. */
  externalId: string;
  name: string;
  /** Bank or issuer name as the connector reports it. */
  institution: string;
  /** Connector-reported kind, free text: "checking", "savings", "credit" or "unknown". */
  type: string;
  /** Dollars as the institution reports them: positive for assets, negative for card debt. */
  balance: number;
  /** ISO timestamp of the balance reading. */
  balanceAt: string;
}

export interface NormalizedTransaction {
  /** The connector's own stable id for the transaction. Unique per connector. */
  externalId: string;
  accountExternalId: string;
  /** Posted date (authorization date while pending), `YYYY-MM-DD`. */
  date: string;
  pending: boolean;
  /** Dollars, signed: spending is negative, income and refunds positive. */
  amount: number;
  description: string;
}

/** One reading of a source: balances and the transactions since the requested date. */
export interface ConnectorBatch {
  accounts: NormalizedAccount[];
  transactions: NormalizedTransaction[];
  /** Non-fatal notices from the source (an institution needing re-auth, a skipped record). */
  warnings: string[];
}

export interface Connector {
  /** Stable id stored on every account and transaction row, e.g. "simplefin". */
  readonly id: string;
  /**
   * Whether credentials are present, so a scheduler can skip a source the user has not set up
   * yet. Cheap and synchronous; must not contact the source. When credentials exist but look
   * broken, answer true so the run surfaces the error.
   */
  isConfigured(): boolean;
  /** Accounts with current balances, no transactions. For the account-roles screen. */
  listAccounts(): Promise<NormalizedAccount[]>;
  /**
   * Balances plus every transaction on or after `since` (`YYYY-MM-DD`), including pending ones.
   * Balances ride along because most sources return both in one call and the sync must
   * snapshot them from the same reading.
   */
  fetchTransactions(since: string): Promise<ConnectorBatch>;
}

export type ConnectorErrorCode =
  /** No credentials stored yet; the API maps this to 409 and the UI shows the setup flow. */
  | "not_configured"
  /** The pasted setup token is not the base64 of a claim URL. */
  | "bad_setup_token"
  /** The claim request was rejected (already claimed, expired). */
  | "claim_failed"
  /** The source answered with a non-2xx status. */
  | "http_error"
  /** The source answered with something we cannot parse. */
  | "bad_response"
  /** An uploaded file (CSV import) is not in the shape the chosen preset expects. */
  | "bad_file"
  /** The stored credentials exist but cannot be read or parsed; the user has to reconnect. */
  | "secrets_unreadable";

/** Every failure a connector raises on purpose. Messages never contain credentials or access URLs. */
export class ConnectorError extends Error {
  constructor(
    readonly connector: string,
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
