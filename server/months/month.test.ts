import { describe, expect, it } from "vitest";
import { daysInMonth, isMonth, monthOf, MonthSchema, nextMonthStart } from "./month.js";

describe("month helpers", () => {
  it("accepts only YYYY-MM with a real month number", () => {
    expect(isMonth("2026-09")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-9")).toBe(false);
    expect(isMonth("2026-09-01")).toBe(false);
    expect(MonthSchema.safeParse("2026-00").success).toBe(false);
  });

  it("knows month lengths, leap years included", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-12")).toBe(31);
    expect(() => daysInMonth("bogus")).toThrow(/Invalid month/);
  });

  it("finds the next month start and the month of a date", () => {
    expect(nextMonthStart("2026-09")).toBe("2026-10-01");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
    expect(monthOf("2026-09-17")).toBe("2026-09");
  });
});
