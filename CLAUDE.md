# budget-dashboard

Self-hosted personal budget dashboard. One Node process serves a JSON API and the built React
dashboard on a local port. Bank data arrives via SimpleFIN Bridge or CSV import, lands in SQLite,
and is rolled up into monthly buckets, debt payoff progress and savings goals.

## Hard rule: no personal data in the repo

This repo is public. Never write into any tracked file: real names, account or card
numbers (even last-4), real balances, real merchant strings tied to a person, emails, addresses,
API tokens or access URLs. All of that lives only under `data/` (gitignored except `*.example.json`)
and `.env`. When you need sample data, invent generic merchants and round numbers.
Committed examples: `data/plan.example.json`, `data/rules.example.json`, `data/csv-presets.example.json`,
`.env.example`. Fixtures and docs use invented, generic data; which CSV templates a user offers lives in
`data/csv-presets.json`.
`npm run lint` runs the PII guard; a commit that trips it is a bug, not something to bypass. Commits must use
a GitHub noreply `user.email`; the guard rejects any other commit identity. The pre-push hook runs
`npm run pii-guard:history` over the commits being pushed (old file versions, messages, emails).

## Commands

- `npm test` — vitest, all projects (`--project server` / `--project web`, or a path, to filter)
- `npm run typecheck` — tsc for server and web
- `npm run lint` — eslint + PII guard
- `npm run build` — vite build (dist/web) + tsc emit (dist/server)
- `npm start` — serve dist on `$PORT` (default 8420)
- `npm run dev` — server with reload; `npm run dev:web` — vite dev server proxying /api

## Layout

- `server/` — Hono API, SQLite via better-sqlite3, connectors, domain engines. ESM; import with `.js` suffix.
- `web/src/` — React 19 dashboard, Vite. Tests with Testing Library in jsdom.
- `data/` — runtime data dir (`DATA_DIR`): plan.json, rules.json, csv-presets.json, secrets.json, budget.db. Gitignored.
- Tests sit next to the code as `*.test.ts(x)`. Server tests never touch the network or the real `data/`.

## Conventions

- Validate every file and request body with zod at the boundary; domain code takes typed objects.
- Money is a number of dollars in JSON and the DB; round to cents only at the edges.
- Reserved bucket ids: `_transfer` (card payments, savings moves — never spending), `_income`, `_interest` (card interest
  charges — never spending; debt progress sums them), `_uncategorized`.
- Months are calendar months keyed `YYYY-MM`. Only posted transactions count toward buckets; pending is shown greyed.
