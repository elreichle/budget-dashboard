import { describe, expect, it } from "vitest";
import { formatDate, formatMonth, formatWhen } from "./time.js";

// Vitest runs in Pacific/Auckland (UTC+12/+13), so a timestamp's local day is often not its UTC day.
const utc = (...parts: [number, number, number, number, number?]) => new Date(Date.UTC(...parts)).toISOString();
const whenOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;

describe("formatWhen", () => {
  it("shows the local day and time", () => {
    const expected = new Date(2026, 8, 11, 2, 3).toLocaleString(undefined, whenOptions);
    expect(formatWhen(utc(2026, 8, 10, 14, 3), new Date(2026, 8, 11))).toBe(expected);
  });

  it("leaves the year out when the local year is this year", () => {
    const expected = new Date(2027, 0, 1, 1, 0).toLocaleString(undefined, whenOptions);
    expect(formatWhen(utc(2026, 11, 31, 12), new Date(2027, 0, 5))).toBe(expected);
  });

  it("returns an unreadable string as is", () => {
    expect(formatWhen("soon")).toBe("soon");
  });
});

describe("formatDate", () => {
  it("shows a calendar date as that day", () => {
    expect(formatDate("2026-10-01")).toBe("Oct 1, 2026");
  });

  it("shows a timestamp's local day, not the day its UTC string starts with", () => {
    expect(formatDate(utc(2026, 8, 30, 20))).toBe("Oct 1, 2026");
  });

  it("returns an unreadable string as is", () => {
    expect(formatDate("soon")).toBe("soon");
  });
});

describe("formatMonth", () => {
  it("names a calendar month", () => {
    expect(formatMonth("2026-09")).toBe("September 2026");
    expect(formatMonth("later")).toBe("later");
  });
});
