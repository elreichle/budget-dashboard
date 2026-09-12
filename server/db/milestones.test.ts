import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./index.js";
import { dismissMilestone, listMilestones, recordMilestone } from "./milestones.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

describe("milestones", () => {
  it("records a milestone once; the same kind+key is not re-created", () => {
    const first = recordMilestone(db, { kind: "debt_paid_off", key: "card-a" }, "2026-09-01T00:00:00.000Z");
    expect(first).toMatchObject({ isNew: true, milestone: { kind: "debt_paid_off", key: "card-a", dismissed: false, firstSeen: "2026-09-01T00:00:00.000Z" } });
    const again = recordMilestone(db, { kind: "debt_paid_off", key: "card-a" }, "2026-09-02T00:00:00.000Z");
    expect(again.isNew).toBe(false);
    expect(again.milestone).toEqual(first.milestone);
    expect(listMilestones(db)).toHaveLength(1);
  });

  it("dismissing hides it from the undismissed list but keeps the row", () => {
    const { milestone } = recordMilestone(db, { kind: "bucket_under_plan", key: "groceries:2026-08" }, "2026-09-01T00:00:00.000Z");
    recordMilestone(db, { kind: "savings_target_met", key: "buffer" }, "2026-09-01T00:00:00.000Z");
    expect(dismissMilestone(db, milestone.id)).toBe(true);
    expect(dismissMilestone(db, milestone.id)).toBe(false);
    expect(dismissMilestone(db, 999)).toBe(false);
    expect(listMilestones(db, { dismissed: false }).map((m) => m.kind)).toEqual(["savings_target_met"]);
    expect(listMilestones(db).map((m) => m.dismissed)).toEqual([true, false]);
  });
});
