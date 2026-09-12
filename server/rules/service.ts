import type { Db } from "../db/index.js";
import { firstIssue } from "../http/errors.js";
import type { PlanLoader } from "../plan/load.js";
import { categorize, type CategorizeCounts } from "./categorize.js";
import { appendRule, loadRules } from "./load.js";
import type { Rule, RulesFile } from "./schema.js";

export interface CategorizeOutcome {
  /** False when the plan or rules file kept the pass from running; `warnings` says which. */
  applied: boolean;
  counts: CategorizeCounts | null;
  warnings: string[];
}

/** Runs categorization against the current plan and rules files. Shared by sync, import and the review routes. */
export interface Categorizer {
  run(): CategorizeOutcome;
  /** `appendRule` on this categorizer's rules file; throws `RulesFileError` when the file is invalid. */
  appendRule(rule: Rule): RulesFile;
}

const skipped = (warning: string): CategorizeOutcome => ({ applied: false, counts: null, warnings: [warning] });

/**
 * Loads the plan and rules on every run (both are small files that the user edits by hand)
 * so a rule added in an editor takes effect on the next sync without a restart. Without a
 * valid plan there is nothing to validate rule buckets against, so the pass is skipped and
 * the transactions stay as they are; the same for an invalid rules file. A missing rules file
 * is simply no rules.
 */
export function createCategorizer(db: Db, plan: PlanLoader, dataDir: string, now: () => string): Categorizer {
  return {
    run() {
      // Sync and import call this inside their own db.transaction: a file that cannot be read
      // must not roll back the batch they just applied, so every read problem is a warning.
      let rules: Rule[];
      try {
        const planResult = plan.load();
        if (!planResult.ok) return skipped(`Categorization skipped: ${planResult.error === "plan_missing" ? "no plan file" : "the plan file does not validate"} (${planResult.path})`);
        const loaded = loadRules(dataDir, planResult.plan);
        if (!loaded.ok) return skipped(`Categorization skipped: ${loaded.path} is invalid at ${firstIssue(loaded.issues)}`);
        rules = loaded.rules.rules;
      } catch (err) {
        return skipped(`Categorization skipped: cannot read the plan or rules file: ${err instanceof Error ? err.message : String(err)}`);
      }
      const counts = db.transaction(() => categorize(db, rules, now()))();
      return { applied: true, counts, warnings: [] };
    },
    appendRule: (rule) => appendRule(dataDir, rule),
  };
}
