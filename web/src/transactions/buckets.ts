import type { Plan, Rule } from "../api.js";

export interface BucketOption {
  id: string;
  label: string;
}

const RESERVED_LABELS: Record<string, string> = { _transfer: "Transfer", _income: "Income", _interest: "Interest", _uncategorized: "Uncategorized" };

/** The plan's name for a bucket, a reserved id's label, or the raw id (a bucket since removed from the plan). */
export function bucketLabel(id: string, plan: Pick<Plan, "buckets"> | null): string {
  return plan?.buckets.find((b) => b.id === id)?.name ?? RESERVED_LABELS[id] ?? id;
}

/**
 * What a picker offers: the server's filing ids in its order (plan buckets, then transfer,
 * income and interest). `_uncategorized` is left out: filing a row there by hand would leave it in the review
 * inbox, so it is never a useful choice.
 */
export function bucketOptions(ids: readonly string[], plan: Pick<Plan, "buckets">): BucketOption[] {
  return ids.filter((id) => id !== "_uncategorized").map((id) => ({ id, label: bucketLabel(id, plan) }));
}

export function ruleSavedMessage(rule: Rule, plan: Pick<Plan, "buckets"> | null): string {
  return `Rule saved: "${rule.match}" → ${bucketLabel(rule.bucket, plan)}`;
}
