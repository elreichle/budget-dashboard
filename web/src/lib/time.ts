/** `2026-09-10T14:03:00.000Z` → "Sep 10, 2:03 PM" in the viewer's locale and zone. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const sameYear = at.getFullYear() === now.getFullYear();
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `2026-09` → "September 2026". A calendar month, shown as is. */
export function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(year, mon - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

/**
 * `2026-10-01` → "Oct 1, 2026". A calendar date is shown as is; a full timestamp shows the viewer's
 * local day, which is not the `YYYY-MM-DD` its UTC string starts with.
 */
export function formatDate(dateOrIso: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOrIso);
  const at = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(dateOrIso);
  if (Number.isNaN(at.getTime())) return dateOrIso;
  return at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
