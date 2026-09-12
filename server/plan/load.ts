import path from "node:path";
import { parseJsonText, readJsonFile, readTextFile, type JsonFileResult } from "../jsonFile.js";
import { PlanSchema, type Plan, type PlanIssue } from "./schema.js";

export const PLAN_FILENAME = "plan.json";

export type PlanResult =
  | { ok: true; plan: Plan }
  /** No plan file at `path`. `hint` tells the user what to do. */
  | { ok: false; error: "plan_missing"; path: string; hint: string }
  /** File exists but is not valid JSON or does not match the schema. */
  | { ok: false; error: "plan_invalid"; path: string; issues: PlanIssue[] };

export function planPath(dataDir: string): string {
  return path.join(dataDir, PLAN_FILENAME);
}

/** Reads and validates `<dataDir>/plan.json` once, with no caching. Filesystem errors other than a missing file propagate. */
export function loadPlan(dataDir: string): PlanResult {
  const file = planPath(dataDir);
  return planResult(file, readJsonFile(file, PlanSchema));
}

export interface PlanLoader {
  /** Current plan; re-parses whenever the file's content changes, so edits need no restart. */
  load(): PlanResult;
}

/**
 * A `loadPlan` wrapper that re-parses only when the file text changes. The file is a few KB, so
 * reading it per request costs about the same as a stat and, unlike an mtime check, can never
 * miss an edit on a coarse-timestamp filesystem.
 */
export function createPlanLoader(dataDir: string): PlanLoader {
  const file = planPath(dataDir);
  let cached: { raw: string; result: PlanResult } | undefined;

  return {
    load() {
      const raw = readTextFile(file);
      if (raw === undefined) {
        cached = undefined;
        return planResult(file, { ok: false, error: "missing" });
      }
      if (cached !== undefined && cached.raw === raw) return cached.result;
      const result = planResult(file, parseJsonText(raw, PlanSchema));
      cached = { raw, result };
      return result;
    },
  };
}

function planResult(file: string, read: JsonFileResult<Plan>): PlanResult {
  if (read.ok) return { ok: true, plan: read.value };
  if (read.error === "missing") {
    return {
      ok: false,
      error: "plan_missing",
      path: file,
      hint: `No plan file at ${file}. Copy plan.example.json from the repository's data/ folder to that path and fill in your own numbers (DATA_DIR sets the folder).`,
    };
  }
  return { ok: false, error: "plan_invalid", path: file, issues: read.issues };
}
