import { describe, expect, it } from "vitest";
import { matchBucket } from "./match.js";

const rules = [
  { match: "grocery mart", bucket: "meals" },
  { match: "MART", bucket: "fun-money" },
  { match: "payment thank you", bucket: "_transfer" },
];

describe("matchBucket", () => {
  it("matches a case-insensitive substring anywhere in the description", () => {
    expect(matchBucket("POS PURCHASE Grocery Mart #12", rules)).toBe("meals");
    expect(matchBucket("AUTOPAY PAYMENT THANK YOU", rules)).toBe("_transfer");
  });

  it("takes the first rule in file order when several match", () => {
    expect(matchBucket("GROCERY MART", rules)).toBe("meals");
    expect(matchBucket("HOME MART", rules)).toBe("fun-money");
  });

  it("returns undefined when nothing matches, or there are no rules", () => {
    expect(matchBucket("BUS FARE", rules)).toBeUndefined();
    expect(matchBucket("GROCERY MART", [])).toBeUndefined();
  });
});
