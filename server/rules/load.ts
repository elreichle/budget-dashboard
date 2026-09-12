import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile.js";
import type { Plan } from "../plan/schema.js";
import { EMPTY_RULES, RulesFileSchema, unknownBucketIssues, type Rule, type RulesFile, type RulesIssue } from "./schema.js";

export const RULES_FILENAME = "rules.json";

export type RulesResult =
  /** A missing file reads as no rules (`exists: false`); nothing is filed until one is written. */
  | { ok: true; rules: RulesFile; exists: boolean }
  /** File exists but is not valid JSON, does not match the schema, or names a bucket the plan lacks. */
  | { ok: false; error: "rules_invalid"; path: string; issues: RulesIssue[] };

export function rulesPath(dataDir: string): string {
  return path.join(dataDir, RULES_FILENAME);
}

/** Reads and validates `<dataDir>/rules.json`; with `plan`, rule buckets are checked against it too. */
export function loadRules(dataDir: string, plan?: Pick<Plan, "buckets">): RulesResult {
  const file = rulesPath(dataDir);
  const read = readJsonFile(file, RulesFileSchema);
  if (!read.ok) {
    if (read.error === "missing") return { ok: true, rules: EMPTY_RULES, exists: false };
    return { ok: false, error: "rules_invalid", path: file, issues: read.issues };
  }
  const issues = plan ? unknownBucketIssues(read.value, plan) : [];
  if (issues.length) return { ok: false, error: "rules_invalid", path: file, issues };
  return { ok: true, rules: read.value, exists: true };
}

export class RulesFileError extends Error {
  constructor(
    readonly path: string,
    readonly issues: RulesIssue[],
  ) {
    super(`${path} is not a valid rules file: ${issues.map((i) => `${i.path || "<root>"}: ${i.message}`).join("; ")}`);
    this.name = "RulesFileError";
  }
}

/**
 * Appends `rule` to the end of the rules file (lowest priority, so it cannot shadow a rule the
 * user ordered by hand) and returns the file as written. A missing file is created; an invalid
 * one throws `RulesFileError` rather than being overwritten. Existing entries, including keys
 * this code does not know, are kept as they were.
 */
export function appendRule(dataDir: string, rule: Rule): RulesFile {
  const current = loadRules(dataDir);
  if (!current.ok) throw new RulesFileError(current.path, current.issues);
  const next: RulesFile = { ...current.rules, rules: [...current.rules.rules, rule] };
  writeRules(dataDir, next);
  return next;
}

/** Replaces the whole file atomically (temp file + rename), creating the data dir if needed. */
export function writeRules(dataDir: string, rules: RulesFile): void {
  writeJsonFileAtomic(rulesPath(dataDir), rules);
}
