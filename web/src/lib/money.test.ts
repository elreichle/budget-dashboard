import { describe, expect, it } from "vitest";
import { formatMoney, formatSigned, formatWhole } from "./money.js";

describe("formatMoney", () => {
  it("shows dollars and cents with thousands separators", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(7)).toBe("$7.00");
  });

  it("rounds to cents for display", () => {
    expect(formatMoney(10.005)).toBe("$10.01");
    expect(formatMoney(2.999)).toBe("$3.00");
  });

  it("keeps the sign on negatives and never prints negative zero", () => {
    expect(formatMoney(-12)).toBe("-$12.00");
    expect(formatMoney(-0)).toBe("$0.00");
    expect(formatMoney(-0.001)).toBe("$0.00");
  });

  it("honours the plan currency", () => {
    expect(formatMoney(5, "EUR")).toBe("€5.00");
  });

  it("falls back to the bare code when the currency is not one Intl knows", () => {
    expect(formatMoney(1234.5, "US$")).toBe("US$ 1,234.50");
    expect(formatMoney(-5, "US$")).toBe("-US$ 5.00");
  });
});

describe("formatWhole", () => {
  it("rounds to whole dollars", () => {
    expect(formatWhole(1234.5)).toBe("$1,235");
    expect(formatWhole(99.49)).toBe("$99");
    expect(formatWhole(-250)).toBe("-$250");
  });

  it("never prints a negative zero", () => {
    expect(formatWhole(-0.4)).toBe("$0");
    expect(formatWhole(0.49)).toBe("$0");
  });
});

describe("formatSigned", () => {
  it("puts an explicit sign on every non-zero amount", () => {
    expect(formatSigned(40)).toBe("+$40.00");
    expect(formatSigned(-12.5)).toBe("-$12.50");
    expect(formatSigned(0)).toBe("$0.00");
    expect(formatSigned(0.004)).toBe("$0.00");
  });
});
