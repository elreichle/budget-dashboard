import type { MonthSummary, Pace } from "../api.js";

type BucketFigures = MonthSummary["buckets"][number];

/** Where each piece of a bucket meter sits, as percentages of the track's width. */
export interface MeterGeometry {
  /** Posted spending, from the left edge. */
  posted: number;
  /** Pending spending, drawn right after the posted segment. */
  pending: number;
  /** Position of the expected-by-today marker; 0 (no marker) for a bucket that is not prorated. */
  expected: number;
  /** Position of the plan line; null while everything fits inside the plan (the track's end is the plan). */
  plan: number | null;
}

/**
 * The track spans the plan, or everything spent (posted plus pending) once that is larger, so an
 * overspent bucket still fits and shows where the plan ended. Refunds that push a bucket below
 * zero draw as an empty bar.
 */
export function meterGeometry({ planned, posted, pending, expectedByToday }: Pick<BucketFigures, "planned" | "posted" | "pending" | "expectedByToday">): MeterGeometry {
  const spent = Math.max(0, posted);
  const waiting = Math.max(0, pending);
  const expected = expectedByToday ?? 0;
  const scale = Math.max(planned, spent + waiting, expected);
  if (scale <= 0) return { posted: 0, pending: 0, expected: 0, plan: null };
  const pct = (n: number) => Math.round((Math.max(0, n) / scale) * 1000) / 10;
  return {
    posted: pct(spent),
    pending: pct(waiting),
    expected: pct(expected),
    plan: scale > planned ? pct(planned) : null,
  };
}

export const PACE_LABEL: Record<Pace, string> = {
  "on-pace": "On pace",
  "trending-over": "Trending over",
  over: "Over",
};

/** "12 days left", "Last day", "Month closed" or "Not started yet". `daysElapsed` counts today. */
export function daysLeftLabel({ daysInMonth, daysElapsed, closed }: Pick<MonthSummary, "daysInMonth" | "daysElapsed" | "closed">): string {
  if (closed) return "Month closed";
  if (daysElapsed === 0) return "Not started yet";
  const left = daysInMonth - daysElapsed;
  if (left <= 0) return "Last day";
  return `${left} day${left === 1 ? "" : "s"} left`;
}
