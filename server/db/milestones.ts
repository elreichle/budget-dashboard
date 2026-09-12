import type { Db } from "./index.js";

/**
 * A celebration that fires once. `kind` names the event (e.g. a debt paid off, a bucket closing
 * a month under plan) and `key` identifies which one (debt id, `bucketId:YYYY-MM`, ...).
 */
export interface Milestone {
  id: number;
  kind: string;
  key: string;
  firstSeen: string;
  dismissed: boolean;
}

interface MilestoneRow {
  id: number;
  kind: string;
  key: string;
  first_seen: string;
  dismissed: 0 | 1;
}

const COLUMNS = "id, kind, key, first_seen, dismissed";

function fromRow(r: MilestoneRow): Milestone {
  return { id: r.id, kind: r.kind, key: r.key, firstSeen: r.first_seen, dismissed: r.dismissed === 1 };
}

/** Records the milestone if unseen. `isNew` is false when the same kind+key was already recorded. */
export function recordMilestone(db: Db, id: Pick<Milestone, "kind" | "key">, firstSeen: string): { milestone: Milestone; isNew: boolean } {
  const inserted = db
    .prepare<[string, string, string], MilestoneRow>(
      `insert into milestones (kind, key, first_seen) values (?, ?, ?) on conflict (kind, key) do nothing returning ${COLUMNS}`,
    )
    .get(id.kind, id.key, firstSeen);
  if (inserted) return { milestone: fromRow(inserted), isNew: true };
  const existing = db.prepare<[string, string], MilestoneRow>(`select ${COLUMNS} from milestones where kind = ? and key = ?`).get(id.kind, id.key);
  if (!existing) throw new Error(`Milestone ${id.kind}/${id.key} vanished between insert and select`);
  return { milestone: fromRow(existing), isNew: false };
}

export function getMilestone(db: Db, id: number): Milestone | undefined {
  const row = db.prepare<[number], MilestoneRow>(`select ${COLUMNS} from milestones where id = ?`).get(id);
  return row && fromRow(row);
}

/** True if the milestone existed and was not already dismissed. */
export function dismissMilestone(db: Db, id: number): boolean {
  return db.prepare<[number]>("update milestones set dismissed = 1 where id = ? and dismissed = 0").run(id).changes === 1;
}

/** Oldest first. */
export function listMilestones(db: Db, filter: { dismissed?: boolean } = {}): Milestone[] {
  const rows =
    filter.dismissed === undefined
      ? db.prepare<[], MilestoneRow>(`select ${COLUMNS} from milestones order by first_seen, id`).all()
      : db.prepare<[number], MilestoneRow>(`select ${COLUMNS} from milestones where dismissed = ? order by first_seen, id`).all(filter.dismissed ? 1 : 0);
  return rows.map(fromRow);
}
