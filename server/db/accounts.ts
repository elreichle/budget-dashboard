import type { Db } from "./index.js";

/** How the user told us to read this account. `null` until assigned in the UI. */
export type AccountRole = "checking" | "savings" | "card" | "ignore";

export interface Account {
  id: number;
  connector: string;
  externalId: string;
  name: string;
  institution: string;
  /** Connector-reported kind (free text, e.g. "checking", "credit"). */
  type: string;
  role: AccountRole | null;
  /** Savings goal ids from the plan this account funds. */
  linkedGoalIds: string[];
  /** Debt id from the plan this card account pays down. */
  linkedDebtId: string | null;
  createdAt: string;
}

/** What a connector knows about an account; everything else is user-assigned. */
export type AccountInput = Pick<Account, "connector" | "externalId" | "name" | "institution" | "type">;

interface AccountRow {
  id: number;
  connector: string;
  external_id: string;
  name: string;
  institution: string;
  type: string;
  role: AccountRole | null;
  linked_goal_ids: string;
  linked_debt_id: string | null;
  created_at: string;
}

const COLUMNS = "id, connector, external_id, name, institution, type, role, linked_goal_ids, linked_debt_id, created_at";

function fromRow(r: AccountRow): Account {
  return {
    id: r.id,
    connector: r.connector,
    externalId: r.external_id,
    name: r.name,
    institution: r.institution,
    type: r.type,
    role: r.role,
    linkedGoalIds: JSON.parse(r.linked_goal_ids) as string[],
    linkedDebtId: r.linked_debt_id,
    createdAt: r.created_at,
  };
}

/**
 * Inserts the account or, when `connector + externalId` already exists, refreshes the
 * connector-reported fields. Role, links and created_at are the user's and are left alone.
 */
export function upsertAccount(db: Db, input: AccountInput, now: string): Account {
  const row = db
    .prepare<[string, string, string, string, string, string], AccountRow>(
      `insert into accounts (connector, external_id, name, institution, type, created_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict (connector, external_id) do update set
         name = excluded.name, institution = excluded.institution, type = excluded.type
       returning ${COLUMNS}`,
    )
    .get(input.connector, input.externalId, input.name, input.institution, input.type, now);
  if (!row) throw new Error("upsertAccount returned no row");
  return fromRow(row);
}

export function findAccount(db: Db, connector: string, externalId: string): Account | undefined {
  const row = db.prepare<[string, string], AccountRow>(`select ${COLUMNS} from accounts where connector = ? and external_id = ?`).get(connector, externalId);
  return row && fromRow(row);
}

export function getAccount(db: Db, id: number): Account | undefined {
  const row = db.prepare<[number], AccountRow>(`select ${COLUMNS} from accounts where id = ?`).get(id);
  return row && fromRow(row);
}

export function listAccounts(db: Db, filter: { connector?: string } = {}): Account[] {
  const rows =
    filter.connector === undefined
      ? db.prepare<[], AccountRow>(`select ${COLUMNS} from accounts order by institution, name, id`).all()
      : db.prepare<[string], AccountRow>(`select ${COLUMNS} from accounts where connector = ? order by institution, name, id`).all(filter.connector);
  return rows.map(fromRow);
}

export function setAccountRole(db: Db, id: number, role: AccountRole | null): void {
  const { changes } = db.prepare<[AccountRole | null, number]>("update accounts set role = ? where id = ?").run(role, id);
  if (changes === 0) throw new Error(`No account ${id}`);
}

export function setAccountLinks(db: Db, id: number, links: Pick<Account, "linkedGoalIds" | "linkedDebtId">): void {
  const { changes } = db
    .prepare<[string, string | null, number]>("update accounts set linked_goal_ids = ?, linked_debt_id = ? where id = ?")
    .run(JSON.stringify(links.linkedGoalIds), links.linkedDebtId, id);
  if (changes === 0) throw new Error(`No account ${id}`);
}
