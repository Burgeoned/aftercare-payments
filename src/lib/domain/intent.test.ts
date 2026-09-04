import { describe, expect, it } from "vitest";

import { parsePortion, resolvePayableAmount } from "./intent";
import { cents } from "./types";
import type { StatementBalance } from "./types";

/**
 * The amount is the one number an attacker most wants control of. These tests
 * are the record that no caller has it.
 */

function balance(over: Partial<StatementBalance> = {}): StatementBalance {
  return {
    statementId: "stmt_4108",
    totalCharged: cents(195500),
    payerAdjustment: cents(102800),
    payerPaid: cents(0),
    patientResponsibility: cents(92700),
    amountPaid: cents(0),
    amountRefunded: cents(0),
    remaining: cents(92700),
    status: "open",
    ...over,
  };
}

const ELIGIBLE = cents(70200);

describe("resolvePayableAmount", () => {
  it("charges the full remaining balance by default", () => {
    expect(resolvePayableAmount(balance(), "full", ELIGIBLE)).toStrictEqual({
      ok: true,
      value: 92700,
    });
  });

  it("charges only the health account eligible portion when asked", () => {
    // The cosmetic line is not eligible, so a health account card covers
    // $702.00 of a $927.00 balance and the rest needs another method.
    expect(resolvePayableAmount(balance(), "health_account", ELIGIBLE)).toStrictEqual({
      ok: true,
      value: 70200,
    });
  });

  it("never charges more than remains, whichever portion is named", () => {
    // Half already paid from a personal card. The eligible figure still reads
    // $702.00, but only $200.00 is outstanding.
    const partial = balance({ amountPaid: cents(72700), remaining: cents(20000) });

    expect(resolvePayableAmount(partial, "health_account", ELIGIBLE)).toStrictEqual({
      ok: true,
      value: 20000,
    });
    expect(resolvePayableAmount(partial, "full", ELIGIBLE)).toStrictEqual({
      ok: true,
      value: 20000,
    });
  });

  it("refuses a statement with nothing left to pay", () => {
    const result = resolvePayableAmount(
      balance({ remaining: cents(0), status: "paid" }),
      "full",
      ELIGIBLE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("statement_already_paid");
  });

  it("refuses a transferred statement before anything else", () => {
    // Fails closed even with a remaining balance: the provider no longer owns
    // it, so accepting money would be worse than declining.
    const result = resolvePayableAmount(balance({ status: "transferred" }), "full", ELIGIBLE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("statement_transferred");
  });

  it("refuses the health account portion when no line is eligible", () => {
    const result = resolvePayableAmount(balance(), "health_account", cents(0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("amount_exceeds_balance");
  });
});

describe("parsePortion", () => {
  it("defaults to the full balance when nothing is named", () => {
    expect(parsePortion(undefined)).toStrictEqual({ ok: true, value: "full" });
    expect(parsePortion(null)).toStrictEqual({ ok: true, value: "full" });
  });

  it("accepts the two named portions", () => {
    expect(parsePortion("full")).toStrictEqual({ ok: true, value: "full" });
    expect(parsePortion("health_account")).toStrictEqual({ ok: true, value: "health_account" });
  });

  it("rejects anything else, numbers above all", () => {
    /**
     * 927 is the regression this file exists for. It was accepted as an amount
     * in cents by a caller that meant $927, and produced a $9.27 charge. There
     * is no longer a number to send.
     */
    for (const bad of [927, 927.0, 92700, "92700", "", "FULL", true, {}, []]) {
      expect(parsePortion(bad).ok).toBe(false);
    }
  });
});
