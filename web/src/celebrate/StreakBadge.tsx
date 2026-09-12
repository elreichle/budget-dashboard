import type { Streak } from "../api.js";

const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** A pill for a run of consecutive closed months under plan (a bucket) or met (a goal); nothing without one. */
export function StreakBadge({ streak }: { streak: Streak | undefined }) {
  if (!streak || streak.current < 1) return null;
  return (
    <span className="streak-badge" title={`Best run: ${months(streak.best)}`}>
      {streak.current}-month streak
    </span>
  );
}
