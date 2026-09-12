import { Hono } from "hono";
import { localDate } from "../clock.js";
import { latestSnapshot, listAccounts, listTransactions, type Db } from "../db/index.js";
import { planUnavailable } from "../http/errors.js";
import type { Plan } from "../plan/schema.js";
import { debtInterest, debtPayments } from "../rules/categorize.js";
import type { Services } from "../services.js";
import { compare, progress, type Comparison, type DebtSnapshot, type Progress, type Projection } from "./engine.js";

export interface DebtResponse extends Comparison {
  progress: Progress;
}

/**
 * Live payoff progress from the database. Current balances are the latest snapshot of each card
 * account linked to a debt (card debt is stored negative, so what is owed is the negated
 * balance, never below zero); payments are the posted transfers into those accounts, and interest
 * the posted `_interest` rows on them since the debt's `asOf` — passed only for a debt whose every
 * synced linked account has some, so one card's filed charges cannot hide another's interest.
 * Pass the plan's `baseline` projection when it is already computed.
 */
export function loadDebtProgress(db: Db, plan: Plan, today: string, baseline?: Projection): Progress {
  const accounts = listAccounts(db);
  const snapshots: DebtSnapshot[] = [];
  const synced: { debtId: string; accountId: number }[] = [];
  for (const account of accounts) {
    if (account.role !== "card" || account.linkedDebtId === null) continue;
    const latest = latestSnapshot(db, account.id);
    if (!latest) continue;
    snapshots.push({ debtId: account.linkedDebtId, owed: Math.max(0, -latest.balance), at: latest.at });
    synced.push({ debtId: account.linkedDebtId, accountId: account.id });
  }
  const posted = listTransactions(db, { pending: false });
  const asOf = new Map(plan.debts.map((d) => [d.id, d.asOf]));
  const charges = debtInterest(posted, accounts).filter((c) => c.date > (asOf.get(c.debtId) ?? ""));
  const covered = (debtId: string) => synced.filter((s) => s.debtId === debtId).every((s) => charges.some((c) => c.accountId === s.accountId));
  const interest = charges.filter((c) => covered(c.debtId));
  return progress({ plan, snapshots, payments: debtPayments(posted, accounts), interest, today, ...(baseline ? { baseline } : {}) });
}

/**
 * `GET /debt`: the planned and baseline payoff projections from the plan, plus live progress
 * (see `loadDebtProgress`). "Today" is the server clock's calendar day in the machine's zone (`TZ`).
 */
export function debtRoutes(services: Pick<Services, "db" | "now" | "plan">): Hono {
  const app = new Hono();

  app.get("/debt", (c) => {
    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "project debt payoff");

    const comparison = compare(plan.plan);
    const body: DebtResponse = { ...comparison, progress: loadDebtProgress(services.db, plan.plan, localDate(services.now()), comparison.baseline) };
    return c.json(body);
  });

  return app;
}
