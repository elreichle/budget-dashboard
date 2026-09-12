import { z } from "zod";
import { issueList } from "../http/errors.js";
import { MonthSchema } from "../months/month.js";

/**
 * Zod schema for `<DATA_DIR>/plan.json`, the user's written budget plan.
 * Money is a number of dollars; APRs are fractions (0.25 = 25%); months are `YYYY-MM`.
 * This file holds only the shape — the committed `data/plan.example.json` is the reference instance.
 */

/** Bucket ids starting with `_` are reserved for `_transfer`, `_income`, `_interest`, `_uncategorized`. */
export const RESERVED_ID_PREFIX = "_";

const isoDate = z.iso.date("expected a real calendar date YYYY-MM-DD");
const dollars = z.number().finite();
const nonNegativeDollars = dollars.nonnegative();
const id = z
  .string()
  .min(1)
  .refine((s) => !s.startsWith(RESERVED_ID_PREFIX), { message: `ids starting with "${RESERVED_ID_PREFIX}" are reserved` });

export const IncomeSchema = z.object({
  netMonthly: nonNegativeDollars,
  paychecksPerMonth: z.number().int().positive(),
  notes: z.string().optional(),
});

export const BucketSchema = z.object({
  id,
  name: z.string().min(1),
  group: z.enum(["fixed", "living"]),
  planned: nonNegativeDollars,
  baseline: nonNegativeDollars,
  notes: z.string().optional(),
});

export const SavingsItemSchema = z.object({
  name: z.string().min(1),
  perBill: nonNegativeDollars,
  timesPerYear: z.number().int().positive(),
  nextDue: isoDate,
});

export const SavingsGoalSchema = z.object({
  id,
  name: z.string().min(1),
  monthly: nonNegativeDollars,
  baselineMonthly: nonNegativeDollars,
  targetBalance: nonNegativeDollars.nullable(),
  notes: z.string().optional(),
  items: z.array(SavingsItemSchema),
});

export const DebtSegmentSchema = z.object({
  name: z.string().min(1),
  balance: nonNegativeDollars,
  apr: z.number().min(0).max(1, "apr is a fraction, e.g. 0.25 for 25%"),
});

export const DebtSchema = z.object({
  id,
  name: z.string().min(1),
  asOf: isoDate,
  creditLimit: nonNegativeDollars,
  plannedPayment: nonNegativeDollars,
  baselinePayment: nonNegativeDollars,
  notes: z.string().optional(),
  segments: z.array(DebtSegmentSchema).min(1),
});

export const PayoffStrategySchema = z.object({
  order: z.array(z.string().min(1)),
  totalMonthly: nonNegativeDollars,
  rollover: z.boolean(),
});

export const SubscriptionSchema = z.object({
  name: z.string().min(1),
  monthly: nonNegativeDollars,
  status: z.enum(["keep", "watch", "cancel"]),
  notes: z.string().optional(),
});

function requireUniqueIds(items: { id: string }[], path: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: "custom", path: [path, index, "id"], message: `duplicate id "${item.id}"` });
    }
    seen.add(item.id);
  });
}

export const PlanSchema = z
  .object({
    version: z.literal(1),
    currency: z.string().length(3),
    planStartMonth: MonthSchema,
    income: IncomeSchema,
    buckets: z.array(BucketSchema).min(1),
    savingsGoals: z.array(SavingsGoalSchema),
    debts: z.array(DebtSchema),
    payoffStrategy: PayoffStrategySchema,
    subscriptions: z.array(SubscriptionSchema),
  })
  .superRefine((plan, ctx) => {
    requireUniqueIds(plan.buckets, "buckets", ctx);
    requireUniqueIds(plan.savingsGoals, "savingsGoals", ctx);
    requireUniqueIds(plan.debts, "debts", ctx);

    const debtIds = new Set(plan.debts.map((d) => d.id));
    const ordered = new Set<string>();
    plan.payoffStrategy.order.forEach((debtId, index) => {
      if (!debtIds.has(debtId)) {
        ctx.addIssue({
          code: "custom",
          path: ["payoffStrategy", "order", index],
          message: `unknown debt id "${debtId}"`,
        });
      } else if (ordered.has(debtId)) {
        ctx.addIssue({
          code: "custom",
          path: ["payoffStrategy", "order", index],
          message: `debt "${debtId}" listed twice`,
        });
      }
      ordered.add(debtId);
    });
  });

export type Plan = z.infer<typeof PlanSchema>;
export type Bucket = z.infer<typeof BucketSchema>;
export type SavingsGoal = z.infer<typeof SavingsGoalSchema>;
export type Debt = z.infer<typeof DebtSchema>;
export type DebtSegment = z.infer<typeof DebtSegmentSchema>;
export type PayoffStrategy = z.infer<typeof PayoffStrategySchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** One validation problem, with a dotted path into the plan file (empty for the whole document). */
export interface PlanIssue {
  path: string;
  message: string;
}

/** Validates an already-parsed JSON value. Use `loadPlan` to read from disk. */
export function parsePlan(input: unknown): { ok: true; plan: Plan } | { ok: false; issues: PlanIssue[] } {
  const result = PlanSchema.safeParse(input);
  if (result.success) return { ok: true, plan: result.data };
  return { ok: false, issues: issueList(result.error) };
}
