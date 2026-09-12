import { afterEach, describe, expect, it } from "vitest";
import { localDate, localMonth } from "./clock.js";

// Node re-reads process.env.TZ on assignment, so each test can pick its zone. Etc/GMT+5 is UTC−5.
const configured = process.env.TZ;

afterEach(() => {
  process.env.TZ = configured;
});

describe("clock", () => {
  it("runs the suite away from UTC so a sliced timestamp is caught", () => {
    expect(new Date("2026-01-15T00:00:00.000Z").getTimezoneOffset()).not.toBe(0);
  });

  it("keeps an evening west of UTC on its own day", () => {
    process.env.TZ = "Etc/GMT+5";
    expect(localDate("2026-09-11T02:30:00.000Z")).toBe("2026-09-10");
    expect(localDate(new Date("2026-09-11T04:59:59.999Z"))).toBe("2026-09-10");
    expect(localDate("2026-09-11T05:00:00.000Z")).toBe("2026-09-11");
  });

  it("moves a morning east of UTC onto the next day", () => {
    process.env.TZ = "Etc/GMT-12";
    expect(localDate("2026-09-10T13:00:00.000Z")).toBe("2026-09-11");
  });

  it("crosses month and year boundaries by local time", () => {
    process.env.TZ = "Etc/GMT+5";
    expect(localMonth("2026-10-01T03:00:00.000Z")).toBe("2026-09");
    expect(localDate("2027-01-01T04:00:00.000Z")).toBe("2026-12-31");
    expect(localMonth("2027-01-01T04:00:00.000Z")).toBe("2026-12");
    process.env.TZ = "Etc/GMT-12";
    expect(localMonth("2026-08-31T12:00:00.000Z")).toBe("2026-09");
  });

  it("matches the UTC slice only in UTC", () => {
    process.env.TZ = "UTC";
    expect(localDate("2026-09-11T23:59:59.999Z")).toBe("2026-09-11");
  });

  it("returns a bare calendar date unchanged in any zone", () => {
    for (const zone of ["Etc/GMT+5", "Etc/GMT-12", "UTC"]) {
      process.env.TZ = zone;
      expect(localDate("2026-09-01")).toBe("2026-09-01");
      expect(localMonth("2026-09-01")).toBe("2026-09");
    }
  });

  it("rejects an unparseable timestamp", () => {
    expect(() => localDate("not a date")).toThrow(/Invalid date/);
  });
});
