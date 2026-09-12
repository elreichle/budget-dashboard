import type { Context } from "hono";
import type { ZodError } from "zod";
import type { PlanResult } from "../plan/load.js";

/** One validation problem: the dotted path to the value (`""` at the root) and what is wrong with it. */
export interface Issue {
  path: string;
  message: string;
}

/** Every issue in `error`, paths dotted. */
export function issueList(error: ZodError): Issue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

/** The first of `issues` as `path: message`, `root` standing in for an empty path. */
export function firstIssue(issues: readonly Issue[], root = "<root>"): string {
  const issue = issues[0];
  return issue ? `${issue.path || root}: ${issue.message}` : `invalid ${root}`;
}

/** The first issue in `error` as `path: message`, `root` standing in for an empty path. */
export function issueMessage(error: ZodError, root = "<root>"): string {
  return firstIssue(issueList(error), root);
}

/**
 * The answer when the plan does not load. Pass `action`, what the route could not do, and it is 409
 * `{ error, message, path }`. `GET /api/plan` passes none and reports the failure itself: 404 with
 * the hint when the file is missing, 422 with the issues when it does not validate.
 */
export function planUnavailable(c: Context, result: Extract<PlanResult, { ok: false }>, action?: string): Response {
  if (action !== undefined) return c.json({ error: result.error, message: `Cannot ${action} without a valid plan (${result.path})`, path: result.path }, 409);
  if (result.error === "plan_missing") return c.json({ error: result.error, path: result.path, hint: result.hint }, 404);
  return c.json({ error: result.error, path: result.path, issues: result.issues }, 422);
}
