import { describe, expect, it } from "vitest";
import { bucketLabel, bucketOptions, ruleSavedMessage } from "./buckets.js";

const plan = {
  buckets: [
    { id: "meals", name: "Meals", group: "living" as const, planned: 600, baseline: 700 },
    { id: "rent", name: "Rent", group: "fixed" as const, planned: 1500, baseline: 1500 },
  ],
};

describe("bucketOptions", () => {
  it("offers plan buckets in the server's order, then transfer, income and interest, never uncategorized", () => {
    expect(bucketOptions(["meals", "rent", "_transfer", "_income", "_interest", "_uncategorized"], plan)).toEqual([
      { id: "meals", label: "Meals" },
      { id: "rent", label: "Rent" },
      { id: "_transfer", label: "Transfer" },
      { id: "_income", label: "Income" },
      { id: "_interest", label: "Interest" },
    ]);
  });
});

describe("bucketLabel", () => {
  it("names plan and reserved buckets and falls back to the id of one no longer in the plan", () => {
    expect(bucketLabel("rent", plan)).toBe("Rent");
    expect(bucketLabel("_uncategorized", plan)).toBe("Uncategorized");
    expect(bucketLabel("travel", plan)).toBe("travel");
    expect(bucketLabel("meals", null)).toBe("meals");
    expect(ruleSavedMessage({ match: "corner cafe", bucket: "meals" }, plan)).toBe('Rule saved: "corner cafe" → Meals');
  });
});
