import { describe, expect, it, vi } from "vitest";

/**
 * The ledger is stubbed out. These tests are about the credential, and reaching
 * Redis to confirm that a statement with no payments has no payments would test
 * the network rather than the authentication. Balance derivation has its own
 * tests in balance.test.ts, against records constructed by hand.
 */
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  paymentsForStatement: async () => [],
  refundsForPayments: async () => [],
}));

const { lookupStatement } = await import("./lookup");

/**
 * Guest lookup is the only authentication in this application, so its failure
 * behavior matters more than its success behavior. The tests that count are the
 * ones asserting that a wrong answer and a missing statement are
 * indistinguishable from outside.
 */

const REF = "AFT-4021-8837";
const DOB = "1988-03-14";

describe("lookupStatement", () => {
  it("resolves a statement for the right reference and date of birth", async () => {
    const result = await lookupStatement(REF, DOB);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.statement.ref).toBe(REF);
    expect(result.value.patientDisplayName).toBe("Dana Whitfield");
    expect(result.value.balance.remaining).toBe(3270);
  });

  it("accepts a reference in any case, because patients retype what they read", async () => {
    expect((await lookupStatement(REF.toLowerCase(), DOB)).ok).toBe(true);
    expect((await lookupStatement(`  ${REF}  `, DOB)).ok).toBe(true);
  });

  it("returns the same error for a wrong date of birth and an unknown reference", async () => {
    // If these differed, the endpoint would confirm which statement references
    // exist, and a valid reference is most of what an attacker needs.
    const wrongDob = await lookupStatement(REF, "1988-03-15");
    const unknownRef = await lookupStatement("AFT-0000-0000", DOB);

    expect(wrongDob.ok).toBe(false);
    expect(unknownRef.ok).toBe(false);
    if (wrongDob.ok || unknownRef.ok) return;

    expect(wrongDob.error).toStrictEqual(unknownRef.error);
    expect(wrongDob.error.kind).toBe("not_found");
  });

  it("rejects a date of birth that is not an ISO date", async () => {
    const result = await lookupStatement(REF, "03/14/1988");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toStrictEqual({ kind: "malformed_input", field: "dateOfBirth" });
  });

  it("rejects an empty reference before touching the store", async () => {
    const result = await lookupStatement("   ", DOB);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toStrictEqual({ kind: "malformed_input", field: "ref" });
  });

  it("does not accept one patient's date of birth against another's statement", async () => {
    // The date of birth is checked against the statement's own patient, not
    // against any patient in the system.
    expect((await lookupStatement("AFT-4108-2290", DOB)).ok).toBe(false);
  });
});
