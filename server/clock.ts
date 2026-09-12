/**
 * Calendar days and months in the machine's timezone (`TZ`). Stored timestamps stay ISO UTC; every
 * day or month derived from one — "today" above all — goes through here, so an evening west of
 * UTC is not already tomorrow and a morning east of it is not still yesterday.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of a timestamp or `Date` in local time. A bare calendar date is already a day and is returned as is. */
export function localDate(isoOrDate: string | Date): string {
  if (typeof isoOrDate === "string" && DATE_RE.test(isoOrDate)) return isoOrDate;
  const at = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid date: ${String(isoOrDate)}`);
  return `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1, 2)}-${pad(at.getDate(), 2)}`;
}

/** `YYYY-MM` of a timestamp or `Date` in local time (see `localDate`). */
export function localMonth(isoOrDate: string | Date): string {
  return localDate(isoOrDate).slice(0, 7);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
