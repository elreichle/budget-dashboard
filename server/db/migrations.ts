import type { Db } from "./index.js";

/**
 * Schema migrations, applied in order and recorded in the `migrations` table so that running
 * them twice is a no-op. Append a new entry to change the schema; never edit an applied one.
 *
 * Conventions: money is REAL dollars, dates are ISO strings (`YYYY-MM-DD` for transaction
 * dates, full timestamps elsewhere), booleans are 0/1 integers.
 */
export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial",
    up: `
      create table accounts (
        id              integer primary key,
        connector       text    not null,
        external_id     text    not null,
        name            text    not null,
        institution     text    not null,
        type            text    not null,
        role            text    check (role in ('checking', 'savings', 'card', 'ignore')),
        linked_goal_ids text    not null default '[]',
        linked_debt_id  text,
        created_at      text    not null,
        unique (connector, external_id)
      );

      create table transactions (
        id            integer primary key,
        account_id    integer not null references accounts (id),
        connector     text    not null,
        external_id   text    not null,
        date          text    not null,
        pending       integer not null check (pending in (0, 1)),
        amount        real    not null,
        description   text    not null,
        bucket_id     text,
        bucket_source text    not null default 'none' check (bucket_source in ('rule', 'manual', 'none')),
        created_at    text    not null,
        updated_at    text    not null,
        unique (connector, external_id),
        check ((bucket_source = 'none') = (bucket_id is null))
      );
      create index transactions_date on transactions (date);
      create index transactions_account_date on transactions (account_id, date);

      create table balance_snapshots (
        id         integer primary key,
        account_id integer not null references accounts (id),
        at         text    not null,
        balance    real    not null
      );
      create index balance_snapshots_account_at on balance_snapshots (account_id, at);

      create table sync_runs (
        id             integer primary key,
        connector      text    not null,
        started_at     text    not null,
        finished_at    text,
        accounts_n     integer not null default 0,
        transactions_n integer not null default 0,
        error          text
      );
      create index sync_runs_started on sync_runs (started_at);

      create table milestones (
        id         integer primary key,
        kind       text    not null,
        key        text    not null,
        first_seen text    not null,
        dismissed  integer not null default 0 check (dismissed in (0, 1)),
        unique (kind, key)
      );
    `,
  },
  {
    version: 2,
    name: "transaction_debt_id",
    // A card payment (`_transfer` on a card account linked to a plan debt) is also a debt payment;
    // categorization derives this column from the bucket and the account link.
    up: "alter table transactions add column debt_id text",
  },
  {
    version: 3,
    name: "sync_run_requested_since",
    // The `since` a run was explicitly asked for; null when it used the default window, which
    // only such runs may anchor.
    up: "alter table sync_runs add column requested_since text",
  },
];

/** Applies every migration not yet recorded, each in its own transaction. Returns the versions applied. */
export function migrate(db: Db, list: Migration[] = migrations): number[] {
  db.exec("create table if not exists migrations (version integer primary key, name text not null, applied_at text not null)");
  const done = new Set(appliedVersions(db));
  const record = db.prepare<[number, string, string]>("insert into migrations (version, name, applied_at) values (?, ?, ?)");
  const applied: number[] = [];
  for (const m of list) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.up);
      record.run(m.version, m.name, new Date().toISOString());
    })();
    applied.push(m.version);
  }
  return applied;
}

export function appliedVersions(db: Db): number[] {
  return db
    .prepare<[], { version: number }>("select version from migrations order by version")
    .all()
    .map((r) => r.version);
}
