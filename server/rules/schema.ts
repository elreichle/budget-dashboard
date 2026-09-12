import { z } from "zod";
import { issueList } from "../http/errors.js";
import type { Plan } from "../plan/schema.js";

/**
 * Zod schema for `<DATA_DIR>/rules.json`: how transaction descriptions are filed into buckets.
 * `match` is a case-insensitive substring of the description; the first matching rule wins, so
 * file order is priority. The committed `data/rules.example.json` is the reference instance.
 */

/** Bucket ids that are not plan buckets but are always valid rule targets. */
export const RESERVED_BUCKET_IDS = ["_transfer", "_income", "_interest", "_uncategorized"] as const;
export type ReservedBucketId = (typeof RESERVED_BUCKET_IDS)[number];

export const TRANSFER_BUCKET: ReservedBucketId = "_transfer";
export const INCOME_BUCKET: ReservedBucketId = "_income";
/** Card interest charges: never spending; debt progress reads them as the interest actually charged. */
export const INTEREST_BUCKET: ReservedBucketId = "_interest";
export const UNCATEGORIZED_BUCKET: ReservedBucketId = "_uncategorized";

/** Loose so hand-added keys survive a UI append and rewrite. */
export const RuleSchema = z.looseObject({
  match: z.string().trim().min(1, "match must not be blank"),
  bucket: z.string().min(1),
  notes: z.string().optional(),
});

export const RulesFileSchema = z.looseObject({
  version: z.literal(1),
  rules: z.array(RuleSchema),
});

export type Rule = z.infer<typeof RuleSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;

export const EMPTY_RULES: RulesFile = { version: 1, rules: [] };

/** One validation problem, with a dotted path into the rules file (empty for the whole document). */
export interface RulesIssue {
  path: string;
  message: string;
}

/** Every bucket id a rule or a manual filing may use: the plan's buckets plus the reserved ids. */
export function knownBucketIds(plan: Pick<Plan, "buckets">): Set<string> {
  return new Set([...plan.buckets.map((b) => b.id), ...RESERVED_BUCKET_IDS]);
}

export function isKnownBucket(bucketId: string, plan: Pick<Plan, "buckets">): boolean {
  return knownBucketIds(plan).has(bucketId);
}

/**
 * Validates an already-parsed JSON value. With `plan`, every rule's bucket must be one of the
 * plan's bucket ids or a reserved id; without it only the shape is checked.
 */
export function parseRules(input: unknown, plan?: Pick<Plan, "buckets">): { ok: true; rules: RulesFile } | { ok: false; issues: RulesIssue[] } {
  const result = RulesFileSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, issues: issueList(result.error) };
  }
  const issues = plan ? unknownBucketIssues(result.data, plan) : [];
  return issues.length ? { ok: false, issues } : { ok: true, rules: result.data };
}

/** An issue for every rule whose bucket is neither one of the plan's bucket ids nor a reserved id. */
export function unknownBucketIssues(rules: RulesFile, plan: Pick<Plan, "buckets">): RulesIssue[] {
  const known = knownBucketIds(plan);
  const issues: RulesIssue[] = [];
  rules.rules.forEach((rule, index) => {
    if (!known.has(rule.bucket)) issues.push({ path: `rules.${index}.bucket`, message: `unknown bucket "${rule.bucket}" (not in the plan and not reserved)` });
  });
  return issues;
}
