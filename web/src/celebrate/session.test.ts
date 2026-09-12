import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimCelebration, forgetCelebrations, releaseCelebration } from "./session.js";

beforeEach(() => {
  forgetCelebrations();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("celebration session", () => {
  it("claims each milestone once, in session storage, until it is handed back", () => {
    expect(claimCelebration(4)).toBe(true);
    expect(claimCelebration(4)).toBe(false);
    expect(claimCelebration(5)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem("budget-dashboard:celebrated")!)).toEqual([4, 5]);
    releaseCelebration(4);
    expect(claimCelebration(4)).toBe(true);
  });

  it("still claims once when session storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    expect(claimCelebration(9)).toBe(true);
    expect(claimCelebration(9)).toBe(false);
  });
});
