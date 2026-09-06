import { describe, expect, it } from "vitest";

import { deriveBalance } from "./balance";
import { STATEMENTS } from "./fixtures";
import { REBUILD_TARGETS, rebuildIsSound, rebuiltPayment, rebuiltRefund } from "./reset";
import { cents } from "./types";
import type { HyperswitchPayment, HyperswitchRefund } from "@/lib/hyperswitch/client";

/**
 * The reset rebuilds a statement from the processor's record rather than from a
 * constant, so what matters is that a retrieved payment and refund fold back
 * into the state the demo is supposed to show, and that a processor answer
 * which does not support that state is refused rather than forced.
 *
 * The fixtures below are the shapes actually returned by the live sandbox,
 * copied from a real retrieval.
 */

const PAYMENT: HyperswitchPayment = {
  payment_id: "pay_hz3mLO8GL41QrB5AgEN1",
  status: "succeeded",
  client_secret: null,
  amount: 3270,
  currency: "USD",
  created: "2026-09-04T23:23:56.008Z",
  updated: "2026-09-05T00:36:38.013Z",
  payment_method: "card",
  payment_method_data: { card: { last4: "4242", card_isin: "424242", card_network: "Visa" } },
};

const REFUND: HyperswitchRefund = {
  refund_id: "ref_gmey0mFKKTTx5cRWbhBa",
  payment_id: "pay_hz3mLO8GL41QrB5AgEN1",
  status: "succeeded",
  amount: 1270,
  created_at: "2026-09-05T00:36:36.907Z",
  updated_at: "2026-09-05T00:36:37.980Z",
};

describe("rebuilding a statement from the processor", () => {
  it("folds back into paid and partially refunded, owing nothing", () => {
    const target = REBUILD_TARGETS[0]!;
    const statement = STATEMENTS.find((s) => s.id === target.statementId)!;

    const payment = rebuiltPayment("row-1", target.statementId, PAYMENT);
    const refund = rebuiltRefund("ref-1", "row-1", REFUND);

    const balance = deriveBalance(statement, [payment], [refund], {
      statementId: target.statementId,
      revisedPatientResponsibility: cents(target.readjudication.revisedPatientResponsibility),
      reason: target.readjudication.reason,
      at: "2026-09-05T00:36:36.339Z",
    });

    expect(balance.amountPaid).toBe(3270);
    expect(balance.amountRefunded).toBe(1270);
    expect(balance.remaining).toBe(0);
    expect(balance.status).toBe("partially_refunded");
  });

  it("carries the processor's clock, not ours", () => {
    const payment = rebuiltPayment("row-1", "stmt_4021", PAYMENT);

    // A webhook arriving later is ordered against this field. Stamping it with
    // our own clock is what made every genuine webhook read as stale in D-018.
    expect(payment.updatedAt).toBe("2026-09-05T00:36:38.013Z");
    expect(payment.createdAt).toBe("2026-09-04T23:23:56.008Z");
  });

  it("classifies tender through the same path the webhook uses", () => {
    const payment = rebuiltPayment("row-1", "stmt_4021", PAYMENT);

    expect(payment.tender).toEqual({ class: "standard_card", last4: "4242", brand: "Visa" });
  });

  it("binds the refund to the internal payment row the balance folds on", () => {
    const refund = rebuiltRefund("ref-1", "row-1", REFUND);

    // Not the processor's payment id. `deriveBalance` matches refunds against
    // internal payment ids, and binding to the wrong one silently refunds
    // nothing, which is how the first version of a balance test passed.
    expect(refund.paymentId).toBe("row-1");
    expect(refund.hyperswitchRefundId).toBe("ref_gmey0mFKKTTx5cRWbhBa");
  });
});

describe("refusing to rebuild a story the processor does not support", () => {
  it("accepts the real pair", () => {
    expect(rebuildIsSound(PAYMENT, REFUND)).toBe(true);
  });

  it("refuses when the payment is not settled", () => {
    expect(rebuildIsSound({ ...PAYMENT, status: "failed" }, REFUND)).toBe(false);
  });

  it("refuses when the refund did not succeed", () => {
    expect(rebuildIsSound(PAYMENT, { ...REFUND, status: "pending" })).toBe(false);
  });

  it("refuses a refund belonging to another payment", () => {
    expect(rebuildIsSound(PAYMENT, { ...REFUND, payment_id: "pay_somethingelse" })).toBe(false);
  });

  it("refuses a refund that is not partial", () => {
    // A full refund is a different statement state, and restoring it under a
    // partial-refund correction would show a balance that reconciles to
    // nothing.
    expect(rebuildIsSound(PAYMENT, { ...REFUND, amount: 3270 })).toBe(false);
  });
});
