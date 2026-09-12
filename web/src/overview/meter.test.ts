import { describe, expect, it } from "vitest";
import { daysLeftLabel, meterGeometry } from "./meter.js";

describe("meterGeometry", () => {
  it("scales to the plan while spending fits inside it", () => {
    expect(meterGeometry({ planned: 400, posted: 100, pending: 50, expectedByToday: 200 })).toEqual({ posted: 25, pending: 12.5, expected: 50, plan: null });
  });

  it("scales to everything spent once over, and marks where the plan ended", () => {
    expect(meterGeometry({ planned: 300, posted: 350, pending: 50, expectedByToday: 150 })).toEqual({ posted: 87.5, pending: 12.5, expected: 37.5, plan: 75 });
  });

  it("draws refunds that push a bucket below zero as an empty bar", () => {
    expect(meterGeometry({ planned: 100, posted: -20, pending: 0, expectedByToday: 50 })).toMatchObject({ posted: 0, pending: 0, expected: 50 });
  });

  it("never divides by zero for an empty, unplanned bucket", () => {
    expect(meterGeometry({ planned: 0, posted: 0, pending: 0, expectedByToday: 0 })).toEqual({ posted: 0, pending: 0, expected: 0, plan: null });
    expect(meterGeometry({ planned: 1200, posted: 1200, pending: 0, expectedByToday: null })).toEqual({ posted: 100, pending: 0, expected: 0, plan: null });
  });

  it("gives an unplanned bucket with spending a full bar and a plan line at zero", () => {
    expect(meterGeometry({ planned: 0, posted: 30, pending: 0, expectedByToday: 0 })).toEqual({ posted: 100, pending: 0, expected: 0, plan: 0 });
  });
});

describe("daysLeftLabel", () => {
  it("counts the days after today", () => {
    expect(daysLeftLabel({ daysInMonth: 30, daysElapsed: 10, closed: false })).toBe("20 days left");
    expect(daysLeftLabel({ daysInMonth: 30, daysElapsed: 29, closed: false })).toBe("1 day left");
    expect(daysLeftLabel({ daysInMonth: 30, daysElapsed: 30, closed: false })).toBe("Last day");
  });

  it("names closed and future months", () => {
    expect(daysLeftLabel({ daysInMonth: 31, daysElapsed: 31, closed: true })).toBe("Month closed");
    expect(daysLeftLabel({ daysInMonth: 31, daysElapsed: 0, closed: false })).toBe("Not started yet");
  });
});
