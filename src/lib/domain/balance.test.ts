import { describe, expect, it } from "vitest";

import { deriveBalance, healthAccountEligibleAmount } from "./balance";
import { STATEMENTS } from "./fixtures";
import { cents } from "./types";
import type { Payment, PaymentStatus, Refund, RefundStatus, Statement } from "./types";

/**
 * The state machine that decides whether a patient still owes money. Everything
 * here is derived from the payment log, so these tests are the closest thing
 * this prototype has to a proof that the ledger cannot drift.
 */

const statement: Statement = STATEMENTS.find((s) => s.ref === "AFT-4021-8837")!;
const OWED = 3270; // $32.70, the residual on that statement.

function payment(
  id: string,
  amount: number,
  status: PaymentStatus,
  over: Partial<Payment> = {},
): Payment {
  return {
    id,
    statementId: statement.id,
    hyperswitchPaymentId: `pay_${id}`,
    amount: cents(amount),
    currency: "USD",
    status,
    tender: null,
    failureReason: null,
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    ...over,
  };
}

function refund(id: string, paymentId: string, amount: number, status: RefundStatus): Refund {
  return {
    id,
    paymentId,
    hyperswitchRefundId: `ref_${id}`,
    amount: cents(amount),
    reason: "readjudication",
    status,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };
}

describe("deriveBalance", () => {
  it("reports the payer adjustment and residual from the line items", () => {
    const balance = deriveBalance(statement, [], []);

    expect(balance.totalCharged).toBe(33400);
    expect(balance.payerAdjustment).toBe(17050);
    expect(balance.payerPaid).toBe(13080);
    expect(balance.patientResponsibility).toBe(OWED);
    expect(balance.remaining).toBe(OWED);
    expect(balance.status).toBe("open");
  });

  it("counts only succeeded payments as collected", () => {
    for (const status of ["processing", "requires_customer_action", "failed"] as const) {
      const balance = deriveBalance(statement, [payment("p1", OWED, status)], []);
      expect(balance.amountPaid).toBe(0);
      expect(balance.remaining).toBe(OWED);
    }
  });

  it("marks a statement pending while a payment is in flight", () => {
    const balance = deriveBalance(statement, [payment("p1", OWED, "processing")], []);
    expect(balance.status).toBe("payment_pending");
  });

  it("leaves a statement open after a failed attempt", () => {
    // A decline must not park the statement in a state that blocks a retry.
    const balance = deriveBalance(statement, [payment("p1", OWED, "failed")], []);
    expect(balance.status).toBe("open");
    expect(balance.remaining).toBe(OWED);
  });

  it("reduces the balance across a split tender without marking it paid early", () => {
    // The health account card covers part, and the statement stays open for the
    // rest. See docs/DESIGN.md section 8.
    const partial = deriveBalance(statement, [payment("p1", 2000, "succeeded")], []);
    expect(partial.remaining).toBe(1270);
    expect(partial.status).toBe("open");

    const full = deriveBalance(
      statement,
      [payment("p1", 2000, "succeeded"), payment("p2", 1270, "succeeded")],
      [],
    );
    expect(full.remaining).toBe(0);
    expect(full.status).toBe("paid");
  });

  it("keeps the first attempt when the second fails", () => {
    // Reversing a successful health account payment to force an all or nothing
    // checkout is worse for the patient than leaving it in place.
    const balance = deriveBalance(
      statement,
      [payment("p1", 2000, "succeeded"), payment("p2", 1270, "failed")],
      [],
    );
    expect(balance.amountPaid).toBe(2000);
    expect(balance.remaining).toBe(1270);
    expect(balance.status).toBe("open");
  });

  it("returns a partially refunded status after a partial refund", () => {
    const balance = deriveBalance(
      statement,
      [payment("p1", OWED, "succeeded")],
      [refund("r1", "p1", 1000, "succeeded")],
    );
    expect(balance.amountRefunded).toBe(1000);
    expect(balance.remaining).toBe(1000);
    expect(balance.status).toBe("partially_refunded");
  });

  it("returns a refunded status when everything collected went back", () => {
    const balance = deriveBalance(
      statement,
      [payment("p1", OWED, "succeeded")],
      [refund("r1", "p1", OWED, "succeeded")],
    );
    expect(balance.remaining).toBe(OWED);
    expect(balance.status).toBe("refunded");
  });

  it("ignores a refund that has not succeeded", () => {
    const balance = deriveBalance(
      statement,
      [payment("p1", OWED, "succeeded")],
      [refund("r1", "p1", 1000, "pending")],
    );
    expect(balance.amountRefunded).toBe(0);
    expect(balance.status).toBe("paid");
  });

  it("ignores payments belonging to another statement", () => {
    const foreign: Payment = { ...payment("p9", OWED, "succeeded"), statementId: "stmt_other" };
    const balance = deriveBalance(statement, [foreign], []);
    expect(balance.amountPaid).toBe(0);
    expect(balance.remaining).toBe(OWED);
  });

  it("ignores a refund against a payment on another statement", () => {
    const balance = deriveBalance(statement, [], [refund("r1", "p_elsewhere", 500, "succeeded")]);
    expect(balance.amountRefunded).toBe(0);
  });

  it("never reports a negative remaining balance", () => {
    // An overpayment is a refund obligation, not a negative bill.
    const balance = deriveBalance(statement, [payment("p1", OWED + 5000, "succeeded")], []);
    expect(balance.remaining).toBe(0);
  });
});

describe("supersession", () => {
  /**
   * The log holds one row per observation, not one per payment. Step 5 appends
   * a webhook row for a payment the intent route already wrote, and summing
   * rows would count that money twice.
   */
  it("counts one processor payment once, however many rows describe it", () => {
    const balance = deriveBalance(
      statement,
      [
        { ...payment("a", OWED, "processing"), hyperswitchPaymentId: "pay_X" },
        {
          ...payment("b", OWED, "succeeded"),
          hyperswitchPaymentId: "pay_X",
          updatedAt: "2026-08-05T10:05:00.000Z",
        },
      ],
      [],
    );

    expect(balance.amountPaid).toBe(OWED);
    expect(balance.status).toBe("paid");
  });

  it("keeps the newest row, not the last one appended", () => {
    // An out-of-order delivery must not walk a succeeded payment backwards.
    const balance = deriveBalance(
      statement,
      [
        {
          ...payment("b", OWED, "succeeded"),
          hyperswitchPaymentId: "pay_X",
          updatedAt: "2026-08-05T10:05:00.000Z",
        },
        {
          ...payment("a", OWED, "processing"),
          hyperswitchPaymentId: "pay_X",
          updatedAt: "2026-08-05T10:00:00.000Z",
        },
      ],
      [],
    );

    expect(balance.amountPaid).toBe(OWED);
    expect(balance.status).toBe("paid");
  });

  it("still counts two genuinely different payments separately", () => {
    // Split tender must not be collapsed by the same rule.
    const balance = deriveBalance(
      statement,
      [payment("a", 2000, "succeeded"), payment("b", 1270, "succeeded")],
      [],
    );

    expect(balance.amountPaid).toBe(OWED);
  });

  it("counts a refund bound to a superseded payment row", () => {
    /**
     * Found against a real refund. The intent route writes one row and the
     * webhook writes another for the same processor payment. A refund can be
     * bound to either, and taking payment ids from the folded set dropped any
     * refund attached to the row the fold discarded. The money had really gone
     * back and the balance did not know.
     */
    const intentRow = {
      ...payment("intent", OWED, "requires_payment_method"),
      hyperswitchPaymentId: "pay_X",
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    const settledRow = {
      ...payment("settled", OWED, "succeeded"),
      hyperswitchPaymentId: "pay_X",
      updatedAt: "2026-08-05T10:05:00.000Z",
    };

    const balance = deriveBalance(
      statement,
      [intentRow, settledRow],
      // Bound to the row the fold throws away.
      [refund("r1", "intent", 1270, "succeeded")],
    );

    expect(balance.amountRefunded).toBe(1270);
    expect(balance.status).toBe("partially_refunded");
  });

  it("counts one refund once across repeated rows", () => {
    const balance = deriveBalance(
      statement,
      [payment("p1", OWED, "succeeded")],
      [
        { ...refund("r1", "p1", 1000, "pending"), hyperswitchRefundId: "ref_X" },
        {
          ...refund("r2", "p1", 1000, "succeeded"),
          hyperswitchRefundId: "ref_X",
          updatedAt: "2026-08-20T10:05:00.000Z",
        },
      ],
    );

    expect(balance.amountRefunded).toBe(1000);
  });
});

describe("healthAccountEligibleAmount", () => {
  it("counts only the eligible lines", () => {
    const mixed = STATEMENTS.find((s) => s.ref === "AFT-4108-2290")!;
    const total = deriveBalance(mixed, [], []).patientResponsibility;

    // 58400 + 11800 eligible, 22500 cosmetic line not.
    expect(healthAccountEligibleAmount(mixed)).toBe(70200);
    expect(healthAccountEligibleAmount(mixed)).toBeLessThan(total);
  });

  it("equals the full residual when every line is eligible", () => {
    const balance = deriveBalance(statement, [], []);
    expect(healthAccountEligibleAmount(statement)).toBe(balance.patientResponsibility);
  });
});
