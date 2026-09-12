import { localDate } from "../clock.js";
import { listAccounts, listTransactions, recordMilestone, type Db, type Milestone } from "../db/index.js";
import type { DebtProgress } from "../debt/engine.js";
import { loadDebtProgress } from "../debt/routes.js";
import type { GoalProgress } from "../goals/progress.js";
import { loadGoalProgress } from "../goals/routes.js";
import { summarizeMonth, type MonthSummary } from "../months/summary.js";
import type { PlanLoader } from "../plan/load.js";
import type { Plan } from "../plan/schema.js";
import { detectMilestones, isSettled } from "./detect.js";
import { closedMonthRange } from "./streaks.js";

export interface MilestoneData {
  settledMonths: MonthSummary[];
  debts: DebtProgress[];
  goals: GoalProgress[];
}

function closedMonthsWithData(db: Db, plan: Plan, today: string) {
  const transactions = listTransactions(db);
  const accounts = listAccounts(db);
  const ignored = new Set(accounts.filter((a) => a.role === "ignore").map((a) => a.id));
  // Newest first, so the last row left is the oldest. An ignored account's history says nothing about coverage.
  const oldest = transactions.filter((t) => !ignored.has(t.accountId)).pop();
  const summaries = closedMonthRange(plan.planStartMonth, oldest?.date, today).map((month) => summarizeMonth({ plan, transactions, accounts, month, today }));
  return { transactions, accounts, summaries };
}

/** Summaries of every month in `closedMonthRange`, from the database as it stands. */
export function loadClosedMonths(db: Db, plan: Plan, today: string): MonthSummary[] {
  return closedMonthsWithData(db, plan, today).summaries;
}

/** Everything detection reads: only settled months (see `isSettled`). `today` is `YYYY-MM-DD`. */
export function loadMilestoneData(db: Db, plan: Plan, today: string): MilestoneData {
  const { transactions, accounts, summaries } = closedMonthsWithData(db, plan, today);
  return {
    settledMonths: summaries.filter((summary) => isSettled({ summary, transactions, accounts, today })),
    debts: loadDebtProgress(db, plan, today).debts,
    goals: loadGoalProgress(db, plan, today).goals,
  };
}

/** Records every detected milestone not stored yet, stamped `now`; returns the new ones. */
export function recordDetected(db: Db, data: MilestoneData, now: string): Milestone[] {
  return db.transaction(() =>
    detectMilestones(data).flatMap((found) => {
      const { milestone, isNew } = recordMilestone(db, found, now);
      return isNew ? [milestone] : [];
    }),
  )();
}

export interface DetectOutcome {
  /** False when there was no valid plan to detect against (no warning) or detection failed (a warning says why). */
  applied: boolean;
  /** Milestones first seen by this run. */
  recorded: Milestone[];
  warnings: string[];
}

/** Detection against the current plan file, for sync and import to run once their batch is committed. */
export interface MilestoneDetector {
  run(): DetectOutcome;
}

export function createMilestoneDetector(db: Db, plan: PlanLoader, now: () => string): MilestoneDetector {
  const skipped = (warning: string): DetectOutcome => ({ applied: false, recorded: [], warnings: [warning] });
  return {
    run() {
      // A problem here must never turn a good sync into a failed one, so it is only a warning;
      // GET /api/milestones detects again and reports errors properly.
      try {
        const result = plan.load();
        // Sync and import already warn about the plan through the categorizer; saying it twice is noise.
        if (!result.ok) return { applied: false, recorded: [], warnings: [] };
        const stamp = now();
        return { applied: true, recorded: recordDetected(db, loadMilestoneData(db, result.plan, localDate(stamp)), stamp), warnings: [] };
      } catch (err) {
        return skipped(`Milestone detection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
