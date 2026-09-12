import { describe, expect, it } from "vitest";
import { milestoneMessage } from "./messages.js";

const subject = (type: "bucket" | "goal" | "debt", name: string) => ({ type, id: name.toLowerCase(), name });

describe("milestoneMessage", () => {
  it("names the subject, and the month for a monthly kind", () => {
    expect(milestoneMessage({ kind: "debt-paid", subject: subject("debt", "Card A"), month: null })).toBe("Card A is paid off!");
    expect(milestoneMessage({ kind: "debt-halfway", subject: subject("debt", "Card B"), month: null })).toBe("Card B is halfway paid off");
    expect(milestoneMessage({ kind: "month-under-plan", subject: subject("bucket", "Meals"), month: "2026-08" })).toBe("Meals finished August 2026 under plan");
    expect(milestoneMessage({ kind: "buffer-target-met", subject: subject("goal", "Buffer"), month: null })).toBe("Buffer reached its target");
    expect(milestoneMessage({ kind: "savings-month-met", subject: subject("goal", "Bills fund"), month: "2026-07" })).toBe("Bills fund got its full savings for July 2026");
  });
});
