import type { Db } from "./index.js";

export interface BalanceSnapshot {
  id: number;
  accountId: number;
  /** ISO timestamp of the balance reading. */
  at: string;
  /** Dollars as the institution reports them: positive for assets, negative for card debt. */
  balance: number;
}

interface SnapshotRow {
  id: number;
  account_id: number;
  at: string;
  balance: number;
}

const COLUMNS = "id, account_id, at, balance";

function fromRow(r: SnapshotRow): BalanceSnapshot {
  return { id: r.id, accountId: r.account_id, at: r.at, balance: r.balance };
}

export function insertSnapshot(db: Db, input: Omit<BalanceSnapshot, "id">): BalanceSnapshot {
  const row = db
    .prepare<[number, string, number], SnapshotRow>(`insert into balance_snapshots (account_id, at, balance) values (?, ?, ?) returning ${COLUMNS}`)
    .get(input.accountId, input.at, input.balance);
  if (!row) throw new Error("insertSnapshot returned no row");
  return fromRow(row);
}

/** True when this exact reading (account, timestamp, balance) is already stored. */
export function hasSnapshot(db: Db, input: Omit<BalanceSnapshot, "id">): boolean {
  return (
    db
      .prepare<[number, string, number], { one: 1 }>("select 1 as one from balance_snapshots where account_id = ? and at = ? and balance = ? limit 1")
      .get(input.accountId, input.at, input.balance) !== undefined
  );
}

export function latestSnapshot(db: Db, accountId: number): BalanceSnapshot | undefined {
  const row = db
    .prepare<[number], SnapshotRow>(`select ${COLUMNS} from balance_snapshots where account_id = ? order by at desc, id desc limit 1`)
    .get(accountId);
  return row && fromRow(row);
}

/** Oldest first, optionally limited to an inclusive `[from, to]` range of ISO timestamps. */
export function listSnapshots(db: Db, accountId: number, range: { from?: string; to?: string } = {}): BalanceSnapshot[] {
  const where = ["account_id = ?"];
  const params: (string | number)[] = [accountId];
  if (range.from !== undefined) {
    where.push("at >= ?");
    params.push(range.from);
  }
  if (range.to !== undefined) {
    where.push("at <= ?");
    params.push(range.to);
  }
  return db
    .prepare<(string | number)[], SnapshotRow>(`select ${COLUMNS} from balance_snapshots where ${where.join(" and ")} order by at, id`)
    .all(...params)
    .map(fromRow);
}
