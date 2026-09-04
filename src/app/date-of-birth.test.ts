import { describe, expect, it } from "vitest";

import { toIsoDate } from "./date-of-birth";

/**
 * The date is half the credential. A date that assembles wrongly does not fail
 * loudly, it fails as "no statement matches that reference and date of birth",
 * which is the same message a wrong date gets, so the patient has no way to
 * tell a typo from a bad field.
 */
describe("toIsoDate", () => {
  it("assembles a padded ISO date", () => {
    expect(toIsoDate({ month: "3", day: "14", year: "1988" })).toBe("1988-03-14");
    expect(toIsoDate({ month: "03", day: "04", year: "1988" })).toBe("1988-03-04");
    expect(toIsoDate({ month: "11", day: "02", year: "1975" })).toBe("1975-11-02");
  });

  it("rejects an incomplete date rather than guessing at it", () => {
    expect(toIsoDate({ month: "", day: "", year: "" })).toBeNull();
    expect(toIsoDate({ month: "3", day: "14", year: "88" })).toBeNull();
    expect(toIsoDate({ month: "3", day: "", year: "1988" })).toBeNull();
  });

  it("rejects a month or day outside the calendar", () => {
    expect(toIsoDate({ month: "13", day: "01", year: "1988" })).toBeNull();
    expect(toIsoDate({ month: "0", day: "01", year: "1988" })).toBeNull();
    expect(toIsoDate({ month: "01", day: "32", year: "1988" })).toBeNull();
    expect(toIsoDate({ month: "01", day: "0", year: "1988" })).toBeNull();
  });

  it("rejects a day that does not exist in that month", () => {
    // Date rolls these forward silently. 31 April becomes 1 May, and the
    // patient is told no statement matches while looking at a date they
    // believe they typed correctly.
    expect(toIsoDate({ month: "04", day: "31", year: "1988" })).toBeNull();
    expect(toIsoDate({ month: "02", day: "30", year: "1988" })).toBeNull();
    expect(toIsoDate({ month: "02", day: "29", year: "1987" })).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(toIsoDate({ month: "02", day: "29", year: "1988" })).toBe("1988-02-29");
  });
});
