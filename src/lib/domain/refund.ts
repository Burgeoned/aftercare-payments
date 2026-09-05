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

function alreadyRefunded(payment: Payment, refunds: readonly Refund[]): Cents {
  return cents(
    refunds
      .filter((r) => r.paymentId === payment.id && r.status !== "failed")
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

  const settled = payments.filter((p) => p.status === "succeeded");

  const capacity = settled.map((payment) => ({
    payment,
    available: cents(payment.amount - alreadyRefunded(payment, refunds)),
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
