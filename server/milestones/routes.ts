import { Hono } from "hono";
import { localDate } from "../clock.js";
import { dismissMilestone, getMilestone, listMilestones, type Milestone } from "../db/index.js";
import { planUnavailable } from "../http/errors.js";
import type { Plan } from "../plan/schema.js";
import type { Services } from "../services.js";
import { isMilestoneKind, parseKey, SUBJECT_OF, type MilestoneKind, type MilestoneSubject } from "./detect.js";
import { loadClosedMonths, loadMilestoneData, recordDetected } from "./service.js";
import { computeStreaks, type Streaks } from "./streaks.js";

/** A stored milestone with what it is about, named from the current plan. */
export interface MilestoneView extends Omit<Milestone, "kind"> {
  kind: MilestoneKind;
  /** The bucket, goal or debt; `name` falls back to the id once the plan no longer has it. */
  subject: { type: MilestoneSubject; id: string; name: string };
  /** `YYYY-MM` for a monthly kind, else null. */
  month: string | null;
}

export interface MilestonesResponse {
  /** Not dismissed yet, oldest first: the celebrations to show. */
  undismissed: MilestoneView[];
  /** Every milestone, dismissed or not, newest first. */
  history: MilestoneView[];
}

function toView(milestone: Milestone, plan: Plan): MilestoneView | null {
  if (!isMilestoneKind(milestone.kind)) return null;
  const kind = milestone.kind;
  const { subjectId, month } = parseKey(kind, milestone.key);
  const type = SUBJECT_OF[kind];
  const named: readonly { id: string; name: string }[] = type === "bucket" ? plan.buckets : type === "goal" ? plan.savingsGoals : plan.debts;
  return { ...milestone, kind, subject: { type, id: subjectId, name: named.find((x) => x.id === subjectId)?.name ?? subjectId }, month };
}

/**
 * `GET /milestones` detects against the current data (see `detectMilestones`), records what is
 * new, and lists them. `POST /milestones/:id/dismiss` hides one from `undismissed`.
 * `GET /streaks` counts consecutive closed months under plan per bucket and met per goal.
 * "Today" is the server clock's calendar day in the machine's zone (`TZ`).
 */
export function milestoneRoutes(services: Pick<Services, "db" | "now" | "plan">): Hono {
  const app = new Hono();

  app.get("/milestones", (c) => {
    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "detect milestones");
    const now = services.now();
    recordDetected(services.db, loadMilestoneData(services.db, plan.plan, localDate(now)), now);
    const all = listMilestones(services.db).flatMap((m) => toView(m, plan.plan) ?? []);
    const body: MilestonesResponse = { undismissed: all.filter((m) => !m.dismissed), history: [...all].reverse() };
    return c.json(body);
  });

  app.post("/milestones/:id/dismiss", (c) => {
    // No body, but a cross-site form could still POST here without a preflight; requiring JSON forces one.
    if (!/^application\/json\b/i.test(c.req.header("content-type") ?? "")) {
      return c.json({ error: "unsupported_media_type", message: "send the request as application/json" }, 415);
    }
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request", message: "id: expected a positive integer" }, 400);
    if (!getMilestone(services.db, id)) return c.json({ error: "unknown_milestone", message: `No milestone ${id}` }, 404);
    dismissMilestone(services.db, id);
    return c.json({ milestone: getMilestone(services.db, id) });
  });

  app.get("/streaks", (c) => {
    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "count streaks");
    const body: Streaks = computeStreaks({ plan: plan.plan, closedMonths: loadClosedMonths(services.db, plan.plan, localDate(services.now())) });
    return c.json(body);
  });

  return app;
}
