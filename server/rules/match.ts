import type { Rule } from "./schema.js";

/** The bucket of the first rule whose `match` occurs in `description`, ignoring case; undefined when none does. */
export function matchBucket(description: string, rules: readonly Rule[]): string | undefined {
  const haystack = description.toLowerCase();
  for (const rule of rules) {
    if (haystack.includes(rule.match.toLowerCase())) return rule.bucket;
  }
  return undefined;
}
