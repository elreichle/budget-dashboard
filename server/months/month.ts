import { z } from "zod";

/**
 * Calendar months keyed `YYYY-MM`. The one place the month format lives: the plan schema, the
 * transaction store and the months API all validate through here.
 */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MonthSchema = z.string().regex(MONTH_RE, "expected a calendar month YYYY-MM");

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

/** `YYYY-MM-DD` → its `YYYY-MM`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function parts(month: string): { year: number; mon: number } {
  if (!isMonth(month)) throw new Error(`Invalid month: ${month}`);
  return { year: Number(month.slice(0, 4)), mon: Number(month.slice(5, 7)) };
}

/** Number of days in the month, leap years included. */
export function daysInMonth(month: string): number {
  const { year, mon } = parts(month);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** First day of the following month, `YYYY-MM-DD`. */
export function nextMonthStart(month: string): string {
  const { year, mon } = parts(month);
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
}
