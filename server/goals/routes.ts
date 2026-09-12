import { Hono } from "hono";
import { localDate } from "../clock.js";
import { latestSnapshot, listAccounts, type Db } from "../db/index.js";
import { planUnavailable } from "../http/errors.js";
import type { Plan } from "../plan/schema.js";
import type { Services } from "../services.js";
import { goalProgress, type GoalsProgress, type SavingsSnapshot } from "./progress.js";

/** Savings goal progress from the latest snapshot of every savings account linked to a goal (see `goalProgress`). */
export function loadGoalProgress(db: Db, plan: Plan, today: string): GoalsProgress {
  const snapshots: SavingsSnapshot[] = [];
  for (const account of listAccounts(db)) {
    if (account.role !== "savings" || account.linkedGoalIds.length === 0) continue;
    const latest = latestSnapshot(db, account.id);
    if (latest) snapshots.push({ goalIds: account.linkedGoalIds, balance: latest.balance, at: latest.at });
  }
  return goalProgress({ plan, snapshots, today });
}

/**
 * `GET /goals`: each savings goal's balance from the latest snapshot of every savings account
 * linked to it, against its next bill and its target (see `loadGoalProgress`). "Today" is the
 * server clock's calendar day in the machine's zone (`TZ`).
 */
export function goalRoutes(services: Pick<Services, "db" | "now" | "plan">): Hono {
  const app = new Hono();

  app.get("/goals", (c) => {
    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "measure savings goals");
    return c.json(loadGoalProgress(services.db, plan.plan, localDate(services.now())));
  });

  return app;
}
