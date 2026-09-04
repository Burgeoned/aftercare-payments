import { describe, expect, it } from "vitest";

import { PATIENTS, STATEMENTS } from "./fixtures";

/**
 * Fixture data is the input to every balance in this application, so it gets
 * checked rather than trusted. Adjudication arithmetic that does not reconcile
 * is not data a payer produced, and a demo built on invented numbers is worse
 * than one built on none: it looks right and is wrong.
 */
describe("statement fixtures", () => {
  const lines = STATEMENTS.flatMap((s) => s.lineItems.map((l) => [s.ref, l] as const));

  it.each(lines)("%s line %o reconciles allowed against paid plus owed", (_ref, line) => {
    // The identity every adjudicated line satisfies. A payer that allows an
    // amount either pays it or assigns it to the patient. There is no third
    // destination.
    expect(line.allowed).toBe(line.payerPaid + line.patientOwes);
  });

  it("carries every amount as an integer count of cents", () => {
    for (const [, line] of lines) {
      for (const amount of [line.charged, line.allowed, line.payerPaid, line.patientOwes]) {
        expect(Number.isInteger(amount)).toBe(true);
      }
    }
  });

  it("never allows more than was charged", () => {
    for (const [, line] of lines) {
      expect(line.allowed).toBeLessThanOrEqual(line.charged);
    }
  });

  it("gives every statement a unique reference", () => {
    const refs = STATEMENTS.map((s) => s.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("points every statement at a patient that exists", () => {
    for (const statement of STATEMENTS) {
      expect(PATIENTS.some((p) => p.id === statement.patientId)).toBe(true);
    }
  });

  it("covers the three cases the build step calls for", () => {
    const owed = (ref: string) => {
      const statement = STATEMENTS.find((s) => s.ref === ref);
      return statement!.lineItems.reduce((total, l) => total + l.patientOwes, 0);
    };

    // A payment plan candidate, meaning a balance past what most patients pay
    // on a single card. See docs/SCOPE.md item 1.
    expect(Math.max(...STATEMENTS.map((s) => owed(s.ref)))).toBeGreaterThan(50000);

    // A statement mixing health account eligible and ineligible lines, which is
    // what makes split tender necessary rather than decorative.
    const mixed = STATEMENTS.filter(
      (s) =>
        s.lineItems.some((l) => l.healthAccountEligible) &&
        s.lineItems.some((l) => !l.healthAccountEligible),
    );
    expect(mixed).toHaveLength(1);
  });
});
