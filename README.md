# budget-dashboard

Self-hosted personal budget dashboard. One Node process serves a JSON API and the built React
dashboard on a local port. Bank data arrives via [SimpleFIN Bridge](https://www.simplefin.org/)
or CSV import, lands in SQLite, and is rolled up into monthly buckets, debt payoff progress and
savings goals.

Everything personal (plan, rules, credentials, database) lives in the gitignored `data/`
directory; the repo holds only code and the `*.example.json` files.

## First run

The server needs your budget plan and categorization rules in the data directory. Start from the
examples and replace the numbers and merchants with your own:

```
cp data/plan.example.json data/plan.json
cp data/rules.example.json data/rules.json
```

### With npm

Node 22.9 or later.

```
npm install
npm run build && npm start                    # http://localhost:8420
```

Settings are environment variables, listed with their defaults in `.env.example`: `PORT`, `HOST`,
`ALLOWED_HOSTS`, `DATA_DIR` and `SYNC_INTERVAL_MINUTES`. Copy the example to `.env` to set them;
`npm start` and `npm run dev` load it when it exists, and a variable set in the shell wins
(`PORT=9000 npm start`). `npm run dev` runs the server with reload and
`npm run dev:web` the Vite dev server; see `CLAUDE.md` for the full command list and layout.

Days and months follow the machine's timezone: "today", the current month and the day a synced
transaction is filed under. Stored timestamps stay UTC. To use another zone, set `TZ`
(`TZ=Europe/Berlin npm start`); a container runs in UTC unless you set it (the compose example has a
commented `TZ` line).

There is no login, so the server listens on `127.0.0.1` only; `HOST=0.0.0.0` opens it to your
network (`HOST` must be an IP address or `localhost`; a name, such as the one tcsh puts in `HOST`,
stops the server at startup). Either way `/api` answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`,
which stops a web page from reaching it by pointing its own domain at your machine (DNS
rebinding), plus the address in `HOST` when it is a specific one. Add the name or address you
browse to from another device to `ALLOWED_HOSTS`
(comma-separated, for example `ALLOWED_HOSTS=budget.lan`); any other Host gets
`403 forbidden_host`. A request that changes data and comes from another site's page (its
`Sec-Fetch-Site` or `Origin` header says so) gets `403 cross_site`; curl and scripts send neither
header and are not affected.

### With Docker

```
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build                  # http://localhost:8420
```

or without Compose:

```
docker build -t budget-dashboard .
docker run -d --init --name budget-dashboard -p 127.0.0.1:8420:8420 -v "$PWD/data:/data" budget-dashboard
```

The image holds code only: `.dockerignore` keeps `data/` and `.env` out of the build context, and
the container reads everything personal from the `/data` volume (`DATA_DIR=/data`; leave that
as is). Pass other settings with `-e` or the compose `environment:` block. The container runs as
uid 1000, so the mounted directory must be writable by that user; the compose file has a `user:`
line for a `data/` owned by someone else. Keep `--init` (`init: true` in Compose): without it
Node runs as PID 1, ignores `docker stop` and is killed after a 10-second wait. There is no
login, which is why both examples publish the port on `127.0.0.1` only (inside the container the
image sets `HOST=0.0.0.0` so the published port reaches Node; to open it to your network see `HOST`
and `ALLOWED_HOSTS` above). To upgrade, pull and
run `docker compose up -d --build` again; the data stays in `./data`.

## SimpleFIN setup

[SimpleFIN Bridge](https://bridge.simplefin.org/) is a read-only aggregator: it logs in to your
banks and hands this app transactions and balances, never your bank credentials.

1. Create a SimpleFIN Bridge account and connect each institution there.
2. In SimpleFIN Bridge, create a new app connection and copy the setup token it shows.
3. In the dashboard, open **Settings → SimpleFIN**, paste the token and connect. The server claims
   it once, stores the resulting access URL in `data/secrets.json` (file mode 0600) and never
   returns or displays it. A setup token works once; to reconnect, create a new one.
4. Open **Accounts** and give each account a role (see [Accounts](#accounts-and-connections)
   below); link cards to plan debts and savings accounts to savings goals.
5. Run a sync from **Settings**, or wait for the automatic one (`SYNC_INTERVAL_MINUTES`). The first
   sync reaches back a year so past months have data; later syncs re-fetch the last two weeks so
   pending charges that post late are picked up.

The access URL can read all connected accounts. To cut it off, remove the app connection in
SimpleFIN Bridge; to forget it locally, delete `data/secrets.json`.

## Where your personal files live

Everything below is gitignored and never baked into the Docker image. `DATA_DIR` (default
`./data`) can point outside the checkout, for example to a folder you already back up.

| file                     | holds                                                    | written by                       |
|--------------------------|----------------------------------------------------------|----------------------------------|
| `data/plan.json`         | your budget plan                                         | you (start from the example)     |
| `data/rules.json`        | categorization rules                                     | you, and the review inbox        |
| `data/csv-presets.json`  | the bank export formats the CSV import offers            | you (start from the example)     |
| `data/secrets.json`      | the SimpleFIN access URL                                 | Settings → SimpleFIN             |
| `data/budget.db`         | accounts, transactions, balance snapshots, milestones    | the server (plus `-wal`/`-shm`)  |
| `data/pii-denylist.txt`  | optional terms for the PII guard                         | you                              |
| `.env`                   | optional settings file                                   | you                              |

Back up by copying the data directory while the server is stopped, so the database and its
write-ahead log are consistent. Keep bank CSV exports out of the repository (or delete them after
importing); CSV, OFX, QFX and XLSX files are gitignored anyway.

## PII guard

The repository is meant to be publishable at any time, so a guard refuses personal data before it
is committed. `npm run lint` ends with `node scripts/pii-guard.mjs`, and `npm install` points
`core.hooksPath` at `.githooks`, whose pre-commit hook runs the same guard on staged content and
whose pre-push hook runs it over the commits being pushed (see [History](#history)). It fails on:

- **paths:** anything under `data/` except `.gitkeep` and `*.example.json`, any `.env*` except
  `.env.example`, and any file `.gitignore` excludes (databases, bank exports), even if force-added;
- **content** in tracked and staged files: card or account last-4 fragments, runs of 12 or more
  digits, 4-4-4-4 digit groups, email addresses (placeholder domains such as `example.com` pass),
  URLs with embedded credentials (the shape of a SimpleFIN access URL), SimpleFIN claim URLs and
  setup tokens, bearer tokens, and absolute home directories that carry a user name
  (`/home/<name>`, `/Users/<name>`, `C:\Users\<name>`);
- **your own terms:** each line of `data/pii-denylist.txt`, matched case-insensitively. Put your
  name, street, employer and the merchants that would identify you there; the report masks what
  it found.
- **your commit identity:** the author and committer email git will record must be a GitHub
  noreply address (`<id>+<login>@users.noreply.github.com`) or a documentation placeholder. A
  commit's email is published with every push, and a commit already pushed cannot be fixed
  without rewriting history. Set it with `git config user.email`.

Exit code 0 is clean, 1 means findings, 2 means it could not run. The fix for a finding is to move
the data into `data/` or `.env` or replace it with invented values, never `git commit --no-verify`.
Tests that need a matching string assemble it at runtime so the test file itself stays clean.

### History

A push publishes every commit, not just the current tree: a file deleted later, an old commit
message and the email on every past commit all go with it. `npm run pii-guard:history` (or
`node scripts/pii-guard.mjs --history [rev…]`) applies the same rules to every file version and
path reachable from the given revisions (default: all refs), to every commit message, and to every
author and committer email. The pre-push hook runs it on exactly the commits being pushed. A new
commit cannot fix a finding there; publish a fresh history instead (a new repository started from a
clean tree).

## CSV import

When SimpleFIN cannot reach a bank, upload that bank's transaction export instead, from
**Settings → Import a CSV** or the API:

```
POST /api/import/csv   (multipart form)
  file         the export
  preset       a preset name from GET /api/import/csv/presets
  accountId    an existing account id, or
  accountName  a name; creates (once) a "csv" account for this preset
```

Re-importing a file, or a later export that overlaps it, updates rows rather than duplicating
them: each row's id is a hash of account, date, amount and description. Rows the export marks
pending are left out (they post later, often under a different date or descriptor) and counted
in `pendingIgnored`.

Use `accountName` for a bank SimpleFIN does not reach. Importing into an account SimpleFIN
also syncs is meant for a gap SimpleFIN missed: rows from the two sources are keyed separately,
so a statement that overlaps what SimpleFIN already fetched (or fetches later) counts those
transactions twice.

Dates may be `YYYY-MM-DD`, `M/D/YYYY` or `M/D/YY`. Amounts may carry `$`, thousands separators
or parentheses for negatives. A row that cannot be read is skipped and reported as a warning;
a header missing a needed column, or a quoted field left open by a truncated download,
rejects the whole file (`422 bad_file`).

### Presets and `data/csv-presets.json`

A preset says which columns hold the date, description and amount, how the amount is signed and
which column, if any, marks a row pending. The code ships templates for common bank exports.
Which presets the import form offers is set by `data/csv-presets.json`, gitignored like the rest
of the data directory because the banks you use are personal. Without that file every template
is offered under its own name. Start from the example:

```
cp data/csv-presets.example.json data/csv-presets.json
```

```json
{
  "version": 1,
  "presets": {
    "everyday": { "template": "ally" },
    "travel-card": { "template": "capital-one", "label": "Travel card" },
    "credit-union": {
      "template": "generic",
      "label": "Credit union checking",
      "institution": "Credit Union",
      "date": ["Posted"],
      "amount": { "kind": "split", "debit": ["Withdrawal"], "credit": ["Deposit"] }
    }
  }
}
```

Each key is a preset name: lower-case letters, digits and dashes. It also keys accounts created
from `accountName` (`<preset>:<name>`), so keep a name once you have imported with it.
`template` is required. Any of `label`, `institution`, `accountType` (`checking`, `credit`,
`unknown`), `date`, `description`, `amount` (`{ "kind": "signed", "columns": [...],
"spendingPositive": false }` or `{ "kind": "split", "debit": [...], "credit": [...] }`) and
`pending` (`{ "columns": ["Status"], "value": "Pending" }`) replaces the template's value. Column
lists are candidates: header matching is case-insensitive and the first one present wins. The
file is re-read on every import; an invalid one makes the preset list and every upload answer
`422 csv_presets_invalid` with the file's path and what is wrong.

The templates live in `server/connectors/csvTemplates.ts`. Their column names are best-effort
from each bank's public export format, and banks change them, so compare a template with your
file's header row and override what differs:

| template          | date column                     | description | amount                                | pending                      |
|-------------------|---------------------------------|-------------|---------------------------------------|------------------------------|
| `ally`            | Date                            | Description | `Amount`, withdrawals negative        | not in export                |
| `amex`            | Date                            | Description | `Amount`, charges **positive**        | not in export                |
| `apple-card`      | Transaction Date                | Merchant    | `Amount (USD)`, charges **positive**  | not in export                |
| `bank-of-america` | Posted Date                     | Payee       | `Amount`, charges negative            | not in export                |
| `capital-one`     | Transaction Date / Posted Date  | Description | `Debit` and `Credit` columns          | not in export                |
| `chase`           | Transaction Date / Posting Date | Description | `Amount`, charges negative            | not in export                |
| `citi`            | Date                            | Description | `Debit` and `Credit` columns          | `Status` = Pending           |
| `discover`        | Trans. Date                     | Description | `Amount`, charges **positive**        | not in export                |
| `schwab`          | Date                            | Description | `Withdrawal` and `Deposit` columns    | `Status` = Pending           |
| `sofi`            | Date                            | Description | `Amount`, withdrawals negative        | `Status` = Pending           |
| `us-bank`         | Date                            | Name        | `Amount`, charges negative            | not in export                |
| `generic`         | Date                            | Description | `Amount`, spending negative           | `Status`/`Pending` = Pending |

### Exporting CSVs from your bank

- Export account activity as **CSV**, not a PDF statement or a Quicken/QFX/OFX file. Look for
  Download or Export on the account's activity or transactions page; card sites usually ask for
  a file type and a date range.
- Pick a date range that overlaps the previous import by a week or so; overlapping rows update
  instead of duplicating.
- Charges still pending are skipped, so an export taken a few days after month end files the
  whole month.
- Some exports put a summary block above the header row, or have no header row at all. Delete the
  summary lines, or add a `Date,Description,Amount` style header, before importing.
- A bank with no template: add a preset built on `generic` with its column names.

## Categorization and the review inbox

`data/rules.json` files transactions into buckets: `match` is a case-insensitive substring of
the description, the first matching rule wins, and a rule's `bucket` must be a plan bucket id
or one of `_transfer`, `_income`, `_interest`, `_uncategorized`. Categorization runs at the end of every
sync and CSV import; the file is re-read each time, so an edit needs no restart. A bucket set
by hand is never overwritten by a rule. A `_transfer` paid into a card account linked to a plan
debt is also recorded as a payment toward that debt.

```
GET  /api/review                        transactions with no bucket (posted and pending)
GET  /api/transactions?month=&accountId= every transaction with its account, plus accounts and bucket ids
POST /api/transactions/:id/bucket       { "bucket": "meals", "saveRule": true, "match": "GROCERY" }
```

`saveRule` appends `{ match, bucket }` to `rules.json` (`match` defaults to the transaction's
description, trimmed) and re-runs categorization, so one filing can clear the rest of the inbox.

## Accounts and connections

The Accounts page gives each synced or imported account a role: `checking` (income is read here),
`savings` (link it to the plan's savings goals it funds), `card` (link it to the plan debt it pays
down) or `ignore`. The Settings page connects SimpleFIN, runs a sync by hand and imports CSVs.

```
GET   /api/accounts                   accounts with latest balance, plus plan debts and goals to link
PATCH /api/accounts/:id               { "role": "card", "linkedDebtId": "card-a" } or { "linkedGoalIds": [...] }
GET   /api/connectors/simplefin       { "configured": true | false }
POST  /api/connectors/simplefin/claim { "token": "<setup token>" }
```

A debt link only fits a card and goal links only a savings account (422 otherwise); changing the
role clears links the new role cannot have, and every change re-runs categorization so card
payments pick up the linked debt. Linking needs a valid plan (409 without one); roles do not. The
setup token is sent once and exchanged for an access URL kept in `secrets.json`; neither is ever
returned by the API or shown in the dashboard.

## Month summary

`GET /api/months/:yyyy-mm` rolls the month up against the plan: per bucket `planned`, `posted`
(net spending from checking and card accounts, refunds included), `pending`, `expectedByToday`
(planned prorated by days elapsed), `remaining` and a `pace` of `on-pace`, `trending-over`
(posted above 110% of the prorated plan) or `over`; plus income received, savings contributions
per goal (deposits into linked savings accounts, split by each goal's planned monthly), debt
payments per debt and the count of uncategorized rows. Only posted rows move totals, and an
account contributes nothing until it has a role. `GET /api/months` lists the months that have
transactions.

## Debt payoff

`GET /api/debt` projects the plan's debts month by month: interest accrues per segment
(`balance × apr ÷ 12`) before the payment, which hits the highest-APR segment first. `planned`
follows `payoffStrategy`: debts are paid in `order` (unlisted debts come last) and, with
`rollover`, the month's total stays at `totalMonthly` (or the open debts' planned payments if
those add up to more) so a paid-off debt's payment rolls to the next. `baseline` uses each
debt's `baselinePayment` with no rollover. A debt whose `asOf` is after `planStartMonth` sits
idle until the month after `asOf`. Both report the schedule, the debt-free month, total
interest, and `neverPaysOff` when a payment cannot cover the interest (the projection stops at
600 months). `progress` reads each debt's current balance from the latest snapshot of every
card account linked to it (the plan's starting balance until one is synced), sums posted
payments made after the debt's `asOf`, and credits interest saved so far: what the baseline
schedule would have charged in the months fully elapsed before the snapshot, less what the card
actually charged: its posted `_interest` rows dated in those months (`interestSource: "rows"`,
when every synced account linked to the debt has some since `asOf`) or else the balance change
plus payments (`"estimate"`, which new purchases inflate). Its `projection` restarts the planned payoff from today's balances, net of
payments already posted this month, which is the live debt-free date.

## Savings goals

`GET /api/goals` reports each savings goal's balance: its share of the latest snapshot of every
savings account linked to it (an account linked to several goals is split in proportion to their
`monthly` amounts). A goal with `items` is measured against its next bill: each item's `nextDue`
rolls forward by whole billing periods (`12 ÷ timesPerYear` months) to the first date on or after
today, and items due that same day are summed. A goal with a `targetBalance` is measured against
it. Until a linked account has synced, a goal's balance is zero and `balanceSource` is `none`.

## Milestones and streaks

`GET /api/milestones` detects milestones against the current data, records any that are new, and
returns `undismissed` (oldest first) and `history` (all of them, newest first). Each carries its
`kind`, a stable `key`, the `subject` it is about (bucket, goal or debt, named from the plan) and,
for the monthly kinds, the `month`:

- `debt-halfway` / `debt-paid`: a linked card's synced balance is down to half its starting balance / to zero.
- `buffer-target-met`: a goal's synced balance has reached its `targetBalance`.
- `month-under-plan`: in a closed month, a bucket's posted spending stayed at or under its plan.
- `savings-month-met`: in a closed month, contributions to a goal reached its `monthly`.

A milestone is stored once per kind and key (`month-under-plan` + `meals:2026-10`), so it fires
once; detection also runs after every successful sync and CSV import. Closed months run from the
later of `planStartMonth` and the first fully covered month of history (history starting after
the 1st skips its first month) through last month, and buckets or goals planned at zero never
count. A monthly milestone waits until its month settles: 3 days into the next month, with nothing
in it pending or in the review inbox and every account with activity in it given a role. `POST /api/milestones/:id/dismiss` (sent as
`application/json`) moves one out of `undismissed`. `GET /api/streaks` reports per bucket the
consecutive closed months under plan and per goal the consecutive months met: `current` (ending
last month) and `best`.
