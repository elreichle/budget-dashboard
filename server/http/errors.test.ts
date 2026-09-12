import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PlanResult } from "../plan/load.js";
import { firstIssue, issueList, issueMessage, planUnavailable } from "./errors.js";

const Body = z.object({ items: z.array(z.object({ amount: z.number() })), note: z.string() });

function zodError(input: unknown): z.ZodError {
  const parsed = Body.safeParse(input);
  if (parsed.success) throw new Error("expected a failure");
  return parsed.error;
}

describe("issueList", () => {
  it("lists every issue with a dotted path", () => {
    expect(issueList(zodError({ items: [{ amount: "1" }] }))).toEqual([
      { path: "items.0.amount", message: expect.any(String) },
      { path: "note", message: expect.any(String) },
    ]);
  });

  it("gives a root issue an empty path", () => {
    expect(issueList(zodError(42))).toEqual([{ path: "", message: expect.any(String) }]);
  });
});

describe("issueMessage", () => {
  it("is the first issue as path: message", () => {
    const error = zodError({ items: [{ amount: "1" }] });
    expect(issueMessage(error)).toBe(`items.0.amount: ${error.issues[0]?.message}`);
  });

  it("names an empty path after the root it is given", () => {
    const error = zodError(42);
    expect(issueMessage(error, "body")).toBe(`body: ${error.issues[0]?.message}`);
    expect(issueMessage(error)).toMatch(/^<root>: /);
  });
});

describe("firstIssue", () => {
  it("formats a plain issue list the same way", () => {
    expect(firstIssue([{ path: "rules.1.bucket", message: "unknown bucket" }, { path: "x", message: "y" }])).toBe("rules.1.bucket: unknown bucket");
    expect(firstIssue([], "form")).toBe("invalid form");
  });
});

describe("planUnavailable", () => {
  const missing: PlanResult = { ok: false, error: "plan_missing", path: "/srv/data/plan.json", hint: "Copy the example." };
  const invalid: PlanResult = { ok: false, error: "plan_invalid", path: "/srv/data/plan.json", issues: [{ path: "buckets", message: "expected array" }] };

  function answer(result: PlanResult, action?: string) {
    const app = new Hono();
    app.get("/", (c) => (result.ok ? c.json({}) : planUnavailable(c, result, action)));
    return app.request("/");
  }

  it("is 409 with error, message and path when a route names what it cannot do", async () => {
    for (const result of [missing, invalid]) {
      const res = await answer(result, "summarize a month");
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: result.ok ? "" : result.error, message: "Cannot summarize a month without a valid plan (/srv/data/plan.json)", path: "/srv/data/plan.json" });
    }
  });

  it("is the plan route's own 404 or 422 without an action", async () => {
    const gone = await answer(missing);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "plan_missing", path: "/srv/data/plan.json", hint: "Copy the example." });
    const bad = await answer(invalid);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "plan_invalid", path: "/srv/data/plan.json", issues: [{ path: "buckets", message: "expected array" }] });
  });
});
