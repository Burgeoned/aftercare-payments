import { describe, expect, it } from "vitest";

import { allocateRefund, claimedRefundTotal, overpaymentFrom } from "./refund";
import { cents } from "./types";
import type { Payment, Refund, TenderClass } from "./types";

/**
 * Where a refund lands is a tax question, not a preference. These tests are the
 * record that health account money goes back to the health account and that the
 * choice of which payment to draw from is made deliberately.
 */

function payment(
  id: string,
  amount: number,
  tenderClass: TenderClass,
  updatedAt = "2026-09-01T10:00:00.000Z",
): Payment {
  return {
    id,
    statementId: "stmt_4108",
    hyperswitchPaymentId: `pay_${id}`,
    amount: cents(amount),
    currency: "USD",
    status: "succeeded",
    tender: { class: tenderClass, last4: "0000", brand: null },
    failureReason: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function refund(paymentId: string, amount: number, status: Refund["status"]): Refund {
  return {
    id: `r_${paymentId}_${amount}`,
    paymentId,
    hyperswitchRefundId: `ref_${paymentId}_${amount}`,
    amount: cents(amount),
    reason: "readjudication",
    status,
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
  };
}

describe("allocateRefund", () => {
  it("draws from a single payment", () => {
    const p = payment("a", 3270, "standard_card");
    const result = allocateRefund([p], [], cents(1000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toStrictEqual([{ payment: p, amount: 1000 }]);
  });

  it("draws from the personal card before the health account", () => {
    /**
     * The decision this module exists to make. $702 came from an FSA and $225
     * from a Visa. A $225 correction must come entirely off the Visa, leaving
     * the health account untouched, because returning money there is a reversal
     * against a tax-advantaged account.
     */
    const hsa = payment("hsa", 70200, "health_account", "2026-09-01T10:00:00.000Z");
    const card = payment("card", 22500, "standard_card", "2026-09-01T11:00:00.000Z");

    const result = allocateRefund([hsa, card], [], cents(22500));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.payment.id).toBe("card");
    expect(result.value[0]!.amount).toBe(22500);
  });

  it("spills into the health account only once the card is exhausted", () => {
    const hsa = payment("hsa", 70200, "health_account", "2026-09-01T10:00:00.000Z");
    const card = payment("card", 22500, "standard_card", "2026-09-01T11:00:00.000Z");

    const result = allocateRefund([hsa, card], [], cents(30000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => [a.payment.id, a.amount])).toStrictEqual([
      ["card", 22500],
      ["hsa", 7500],
    ]);
  });

  it("draws the most recent first within the same tender class", () => {
    const older = payment("older", 5000, "standard_card", "2026-09-01T10:00:00.000Z");
    const newer = payment("newer", 5000, "standard_card", "2026-09-01T12:00:00.000Z");

    const result = allocateRefund([older, newer], [], cents(3000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.payment.id).toBe("newer");
  });

  it("counts an existing refund against the payment's remaining capacity", () => {
    const p = payment("a", 10000, "standard_card");
    const result = allocateRefund([p], [refund("a", 4000, "succeeded")], cents(6000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.amount).toBe(6000);
  });

  it("counts a pending refund too, so two corrections cannot double spend", () => {
    // The second correction must not allocate against dollars the first has
    // already claimed just because it has not settled yet.
    const p = payment("a", 10000, "standard_card");
    const result = allocateRefund([p], [refund("a", 4000, "pending")], cents(7000));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("exceeds_collected");
  });

  it("ignores a failed refund, which claimed nothing", () => {
    const p = payment("a", 10000, "standard_card");
    const result = allocateRefund([p], [refund("a", 4000, "failed")], cents(10000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.amount).toBe(10000);
  });

  it("refuses to refund more than was collected", () => {
    const result = allocateRefund([payment("a", 3270, "standard_card")], [], cents(5000));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toStrictEqual({
      kind: "exceeds_collected",
      requested: 5000,
      collected: 3270,
    });
  });

  it("never draws from a payment that did not succeed", () => {
    const failed: Payment = { ...payment("a", 3270, "standard_card"), status: "failed" };
    const result = allocateRefund([failed], [], cents(1000));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("exceeds_collected");
  });

  it("refuses a zero or negative amount", () => {
    const p = payment("a", 3270, "standard_card");
    expect(allocateRefund([p], [], cents(0)).ok).toBe(false);
    expect(allocateRefund([p], [], cents(-100)).ok).toBe(false);
  });
});

describe("overpaymentFrom", () => {
  it("is what was collected less what is now owed", () => {
    expect(overpaymentFrom(cents(62700), cents(92700), cents(0))).toBe(30000);
  });

  it("accounts for money already returned", () => {
    expect(overpaymentFrom(cents(62700), cents(92700), cents(10000))).toBe(20000);
  });

  it("is zero when the revision goes upwards", () => {
    /**
     * A payer revising a balance up does not create a debt collectible through
     * the refund path. It produces a new balance the patient is billed for,
     * which is the ordinary flow.
     */
    expect(overpaymentFrom(cents(120000), cents(92700), cents(0))).toBe(0);
  });

  it("is zero when nothing was collected", () => {
    expect(overpaymentFrom(cents(0), cents(0), cents(0))).toBe(0);
  });
});

describe("capacity across repeated refund rows", () => {
  /**
   * Found by a review pass, not by a test, and it is the third instance of the
   * shape D-017 and D-026 describe. The provider route writes a pending row and
   * the webhook writes a succeeded row for the same processor refund. Summing
   * rows counts one refund twice and halves the capacity of the payment it came
   * from, which then refuses a later correction that should have succeeded.
   */
  function tworows(paymentId: string, amount: number) {
    return [
      { ...refund(paymentId, amount, "pending"), hyperswitchRefundId: "ref_same" },
      {
        ...refund(paymentId, amount, "succeeded"),
        hyperswitchRefundId: "ref_same",
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    ];
  }

  it("counts one refund once however many rows describe it", () => {
    const p = payment("a", 92700, "standard_card");
    const result = allocateRefund([p], tworows("a", 22700), cents(70000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.amount).toBe(70000);
  });

  it("still refuses more than the payment can give back", () => {
    const p = payment("a", 92700, "standard_card");
    expect(allocateRefund([p], tworows("a", 22700), cents(70001)).ok).toBe(false);
  });

  it("does not double the capacity of a payment with two succeeded rows", () => {
    // Two log rows, one processor payment. Capacity is the payment, not the sum.
    const intentRow = {
      ...payment("intent", 92700, "standard_card"),
      hyperswitchPaymentId: "pay_X",
      status: "requires_payment_method" as const,
    };
    const settledRow = {
      ...payment("settled", 92700, "standard_card"),
      hyperswitchPaymentId: "pay_X",
      updatedAt: "2026-09-01T11:00:00.000Z",
    };

    expect(allocateRefund([intentRow, settledRow], [], cents(92700)).ok).toBe(true);
    expect(allocateRefund([intentRow, settledRow], [], cents(92701)).ok).toBe(false);
  });
});

describe("claimedRefundTotal", () => {
  it("counts pending as claimed, so a second correction cannot reissue it", () => {
    /**
     * The provider route decided from the balance's amountRefunded, which counts
     * only succeeded refunds. Between issuing a refund and its webhook arriving
     * that figure is zero, so submitting the same correction twice sent the
     * money twice. Seconds for a card, days for ACH.
     */
    const p = payment("a", 92700, "standard_card");
    expect(claimedRefundTotal([p], [refund("a", 22700, "pending")])).toBe(22700);
  });

  it("ignores a failed refund, which claimed nothing", () => {
    const p = payment("a", 92700, "standard_card");
    expect(claimedRefundTotal([p], [refund("a", 22700, "failed")])).toBe(0);
  });

  it("counts one refund once across a pending and a succeeded row", () => {
    const p = payment("a", 92700, "standard_card");
    const rows = [
      { ...refund("a", 22700, "pending"), hyperswitchRefundId: "ref_same" },
      {
        ...refund("a", 22700, "succeeded"),
        hyperswitchRefundId: "ref_same",
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    ];
    expect(claimedRefundTotal([p], rows)).toBe(22700);
  });
});
