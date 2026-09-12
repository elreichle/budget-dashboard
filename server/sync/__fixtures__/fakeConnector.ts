import { ConnectorError, type Connector, type ConnectorBatch, type NormalizedAccount, type NormalizedTransaction } from "../../connectors/types.js";

/** An in-memory Connector for sync tests. Mutate `batch` between runs; `calls` records every `since`. */
export interface FakeConnector extends Connector {
  batch: ConnectorBatch;
  calls: string[];
  /** When set, the next `fetchTransactions` rejects with this error (and clears it). */
  failWith?: Error;
  /** What `isConfigured()` answers; defaults to true. */
  configured: boolean;
}

export function fakeConnector(batch: Partial<ConnectorBatch> = {}): FakeConnector {
  const fake: FakeConnector = {
    id: "fake",
    batch: { accounts: [], transactions: [], warnings: [], ...batch },
    calls: [],
    configured: true,
    isConfigured() {
      return fake.configured;
    },
    async listAccounts() {
      return fake.batch.accounts;
    },
    async fetchTransactions(since) {
      fake.calls.push(since);
      if (fake.failWith) {
        const err = fake.failWith;
        fake.failWith = undefined;
        throw err;
      }
      return structuredClone(fake.batch);
    },
  };
  return fake;
}

export function notConfigured(): ConnectorError {
  return new ConnectorError("fake", "not_configured", "Fake is not connected yet.");
}

export function account(overrides: Partial<NormalizedAccount> = {}): NormalizedAccount {
  return {
    externalId: "acc-1",
    name: "Everyday Checking",
    institution: "Example Bank",
    type: "checking",
    balance: 1200,
    balanceAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

export function transaction(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    externalId: "tx-1",
    accountExternalId: "acc-1",
    date: "2026-09-05",
    pending: false,
    amount: -42.5,
    description: "GROCERY MART",
    ...overrides,
  };
}
