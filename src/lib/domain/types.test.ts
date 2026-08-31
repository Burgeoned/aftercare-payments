import { describe, expect, it } from "vitest";

import { cents } from "./types";

/**
 * The money invariant is the one worth a test before there is anything else to
 * test. Every amount in this system reaches a payment processor, and a float
 * that slips through becomes a wrong charge on a medical bill.
 */
describe("cents", () => {
  it("accepts integers", () => {
    expect(cents(0)).toBe(0);
    expect(cents(89000)).toBe(89000);
  });

  it("rejects a dollar amount that was never converted", () => {
    expect(() => cents(12.5)).toThrow(RangeError);
  });

  it("rejects floating point residue from arithmetic", () => {
    // 0.1 + 0.2 === 0.30000000000000004, the classic way a bad amount is born.
    expect(() => cents((0.1 + 0.2) * 100)).toThrow(RangeError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => cents(Number.NaN)).toThrow(RangeError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
