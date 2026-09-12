/**
 * Which milestones have had their confetti in this browser session, so a burst plays once per
 * milestone id, reloads included. Kept in sessionStorage, and in memory for when storage is blocked.
 */

const KEY = "budget-dashboard:celebrated";
const memory = new Set<number>();

function stored(): number[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

function store(ids: ReadonlySet<number>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Blocked or full: `memory` still covers this page's lifetime.
  }
}

/** True the first time an id is claimed in this session, false after. */
export function claimCelebration(id: number): boolean {
  const seen = new Set([...memory, ...stored()]);
  if (seen.has(id)) return false;
  memory.add(id);
  store(seen.add(id));
  return true;
}

/** Hands an id back, for a burst cut short before anyone saw it. */
export function releaseCelebration(id: number): void {
  memory.delete(id);
  const seen = new Set(stored());
  seen.delete(id);
  store(seen);
}

/** Starts a fresh session (for tests). */
export function forgetCelebrations(): void {
  memory.clear();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing could have been stored.
  }
}
