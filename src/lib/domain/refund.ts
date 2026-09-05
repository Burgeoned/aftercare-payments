import { latestPerProcessorId } from "./balance";
import { cents, type Cents, type Payment, type Refund, type Timestamp } from "./types";

/**
 * Re-adjudication, and the refund it produces.
 *
 * The payer reprocesses a claim after the patient has already paid, the
 * patient's responsibility drops, and money has to go back. Almost always
 * partial. `DOMAIN.md` section 3 ranks this fifth by dollar volume and first by
 * how much it distinguishes this vertical from retail: in retail a refund
 * reverses a purchase, here it corrects a third party's arithmetic weeks after
 * the fact.
 *
 * Two constraints shape the whole thing.
 *
 * A refund is bound to a payment, not to a statement. Hyperswitch enforces this
 * by taking a `payment_id`, which means the money physically cannot land
 * anywhere except the instrument it came from. The IRS constraint on health
 * account funds is therefore satisfied by construction rather than by a rule
 * somebody has to remember. See `DOMAIN.md` section 5.
 *
 * On a split tender statement that constraint does not decide everything,
 * because there is more than one payment to draw from. That choice is the
 * interesting one and is made below.
 */

/**
 * A payer correction. Not in `types.ts` because that file is the interface
 * contract; this is a record the prototype keeps so a corrected balance can be
 * derived without editing the statement, which stays as issued.
 */
export interface Readjudication {
  readonly statementId: string;
  /** What the payer now says the patient owes. */
  readonly revisedPatientResponsibility: Cents;
  readonly reason: string;
  readonly at: Timestamp;
}

export interface RefundAllocation {
  readonly payment: Payment;
  readonly amount: Cents;
}

export type AllocationError =
  | { readonly kind: "nothing_to_refund" }
  | { readonly kind: "exceeds_collected"; readonly requested: Cents; readonly collected: Cents };

/**
 * What a payment has already had claimed against it.
 *
 * Folded by processor refund id first. The log holds a row per observation: the
 * provider route writes a pending row and the webhook writes a succeeded row
 * for the same refund, so summing rows counts one refund twice and halves the
 * capacity of the payment it came from. That is the same defect as D-017 and
 * D-026, in the one money computation that had not been audited for it.
 *
 * Pending counts. A refund in flight has claimed those dollars even though they
 * have not landed, and two corrections in quick succession must not both
 * allocate them. Failed does not count, because it claimed nothing.
 */
function alreadyRefunded(
  payment: Payment,
  allRowsForPayment: readonly Payment[],
  refunds: readonly Refund[],
): Cents {
  /**
   * Matched against every log row for this processor payment, not just the
   * folded survivor. A refund binds to whichever row its writer was holding,
   * and the intent row and the webhook row are different rows. Narrowing to one
   * loses refunds bound to the other, which is the defect `deriveBalance` and
   * `settledActivity` already carry comments about. This function was the last
   * reader that had not been brought into line.
   */
  const rowIds = new Set(
    allRowsForPayment
      .filter((p) => p.hyperswitchPaymentId === payment.hyperswitchPaymentId)
      .map((p) => p.id),
  );
  const mine = refunds.filter((r) => rowIds.has(r.paymentId));

  return cents(
    latestPerProcessorId(mine, (r) => r.hyperswitchRefundId)
      .filter((r) => r.status !== "failed")
      .reduce((total, r) => total + r.amount, 0),
  );
}

/**
 * Everything claimed across a statement, folded the same way.
 *
 * The provider route needs this rather than the balance's `amountRefunded`,
 * which counts only what has succeeded. Deciding how much more to send back
 * from a figure that ignores refunds already in flight issues the same money
 * twice.
 */
export function claimedRefundTotal(
  payments: readonly Payment[],
  refunds: readonly Refund[],
): Cents {
  const settledIds = new Set(payments.map((p) => p.id));

  return cents(
    latestPerProcessorId(
      refunds.filter((r) => settledIds.has(r.paymentId)),
      (r) => r.hyperswitchRefundId,
    )
      .filter((r) => r.status !== "failed")
      .reduce((total, r) => total + r.amount, 0),
  );
}

/**
 * Decides which payments a refund is drawn from, and in what order.
 *
 * **Health account payments are drawn from last.** Returning money to a personal
 * card is unambiguously fine. Returning it to a health account is a reversal
 * against a tax-advantaged account: it can interact with the year's
 * contribution limit and it reopens a substantiation the patient may already
 * have settled with their plan administrator. Given a choice of where to send
 * the same dollar, the one with no tax consequence wins. See `DESIGN.md`
 * section 9.
 *
 * Within each group the most recent payment is drawn from first, which is the
 * least likely to have been reported anywhere yet.
 *
 * A pending refund counts against a payment's remaining capacity. Two
 * corrections in quick succession must not both allocate against the same
 * dollars just because the first has not settled.
 */
export function allocateRefund(
  payments: readonly Payment[],
  refunds: readonly Refund[],
  amount: Cents,
): { ok: true; value: readonly RefundAllocation[] } | { ok: false; error: AllocationError } {
  if (amount <= 0) return { ok: false, error: { kind: "nothing_to_refund" } };

  // Folded, for the same reason every other reader folds: two succeeded rows for
  // one processor payment would double the capacity and authorise a refund
  // larger than what was collected.
  const settled = latestPerProcessorId(payments, (p) => p.hyperswitchPaymentId).filter(
    (p) => p.status === "succeeded",
  );

  const capacity = settled.map((payment) => ({
    payment,
    available: cents(payment.amount - alreadyRefunded(payment, payments, refunds)),
  }));

  const collected = cents(capacity.reduce((total, c) => total + Math.max(c.available, 0), 0));
  if (amount > collected) {
    return { ok: false, error: { kind: "exceeds_collected", requested: amount, collected } };
  }

  const ordered = [...capacity].sort((a, b) => {
    const aHealth = a.payment.tender?.class === "health_account" ? 1 : 0;
    const bHealth = b.payment.tender?.class === "health_account" ? 1 : 0;
    if (aHealth !== bHealth) return aHealth - bHealth;
    return b.payment.updatedAt.localeCompare(a.payment.updatedAt);
  });

  const allocations: RefundAllocation[] = [];
  let outstanding: number = amount;

  for (const { payment, available } of ordered) {
    if (outstanding <= 0) break;
    if (available <= 0) continue;

    const take = Math.min(outstanding, available);
    allocations.push({ payment, amount: cents(take) });
    outstanding -= take;
  }

  return { ok: true, value: allocations };
}

/**
 * What a correction owes back, given what has already been collected.
 *
 * Returns zero rather than a negative when the revision goes the other way. A
 * payer revising a balance upwards does not create a debt to collect through
 * this path: it produces a new balance the patient is billed for, which is the
 * ordinary flow and not a refund.
 */
export function overpaymentFrom(
  revisedResponsibility: Cents,
  amountPaid: Cents,
  amountRefunded: Cents,
): Cents {
  const net = amountPaid - amountRefunded;
  return cents(Math.max(net - revisedResponsibility, 0));
}
