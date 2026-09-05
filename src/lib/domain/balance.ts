/**
 * Derives a statement's financial position from the append-only payment and
 * refund log.
 *
 * Nothing here is stored. That is the point. A stored balance and a payment log
 * drift apart eventually, and on a medical bill the patient is the one who
 * discovers the drift, usually while being told they owe money they already
 * paid. See docs/DESIGN.md section 12.
 *
 * This module is pure. It takes records and returns a computation, touches no
 * clock, and reaches nothing outside its arguments, which is what makes the
 * whole state machine testable without a processor.
 */

import { clampToZero, subtract, sum } from "./money";
import type { Readjudication } from "./refund";
import type {
  Cents,
  Payment,
  Refund,
  Statement,
  StatementBalance,
  StatementStatus,
  Timestamp,
} from "./types";

/**
 * Statuses that mean money is in flight. A statement with a payment in one of
 * these states must not accept a second full-balance payment, or a patient who
 * refreshes during a 3DS challenge pays twice.
 */
const IN_FLIGHT: ReadonlySet<Payment["status"]> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_customer_action",
  "processing",
]);

export function totalCharged(statement: Statement): Cents {
  return sum(statement.lineItems.map((l) => l.charged));
}

/** What the payer's contract knocked off the bill before any benefit applied. */
export function payerAdjustment(statement: Statement): Cents {
  return sum(statement.lineItems.map((l) => subtract(l.charged, l.allowed)));
}

export function payerPaid(statement: Statement): Cents {
  return sum(statement.lineItems.map((l) => l.payerPaid));
}

export function patientResponsibility(statement: Statement): Cents {
  return sum(statement.lineItems.map((l) => l.patientOwes));
}

/**
 * The portion of the residual that health account funds may be applied to.
 * Needed before checkout, not after: a patient paying with an FSA card has to
 * be told what that card can cover before they enter it, not declined at the
 * processor. See docs/DOMAIN.md section 5.
 */
export function healthAccountEligibleAmount(statement: Statement): Cents {
  return sum(statement.lineItems.filter((l) => l.healthAccountEligible).map((l) => l.patientOwes));
}

function deriveStatus(
  patientOwed: Cents,
  remaining: Cents,
  amountRefunded: Cents,
  hasInFlight: boolean,
): StatementStatus {
  /**
   * `transferred` is unreachable in the prototype. It is derived from a
   * collections handoff, which is deferred in docs/SCOPE.md item 7. The status
   * exists in the contract now so the payment path can refuse a transferred
   * balance without a type change later, because accepting money for a balance
   * the provider no longer owns is worse than declining it.
   */

  if (amountRefunded > 0) {
    // A refund that returns everything collected is a refunded statement even
    // though the patient may still owe the original amount. The two facts are
    // different and collapsing them hides the re-adjudication that caused it.
    return remaining >= patientOwed ? "refunded" : "partially_refunded";
  }

  if (remaining === 0) return "paid";
  if (hasInFlight) return "payment_pending";
  return "open";
}

/**
 * Collapses an append-only log to one record per processor object.
 *
 * The log holds a row per observation, not per payment: an intent row written
 * when the payment is created, then a row per webhook as the processor reports
 * progress. Summing rows counts the same money once per observation. A single
 * $32.70 payment that succeeded and was then confirmed by a webhook reads as
 * $65.40, and the statement pays itself off twice over.
 *
 * The processor's own id is the identity, and the newest `updatedAt` wins. That
 * is the same timestamp comparison the webhook handler uses to reject
 * out-of-order deliveries, applied at read time so a late arrival cannot walk
 * the balance backwards either. See docs/DESIGN.md section 6.
 */
export function latestPerProcessorId<T extends { readonly updatedAt: Timestamp }>(
  rows: readonly T[],
  identity: (row: T) => string,
): readonly T[] {
  const newest = new Map<string, T>();

  for (const row of rows) {
    const key = identity(row);
    const held = newest.get(key);
    if (held === undefined || row.updatedAt >= held.updatedAt) newest.set(key, row);
  }

  return [...newest.values()];
}

export function deriveBalance(
  statement: Statement,
  payments: readonly Payment[],
  refunds: readonly Refund[],
  readjudication: Readjudication | null = null,
): StatementBalance {
  const rows = payments.filter((p) => p.statementId === statement.id);
  const mine = latestPerProcessorId(rows, (p) => p.hyperswitchPaymentId);

  /**
   * Built from every row, not from the folded set.
   *
   * The log holds several rows per processor payment, and a refund is bound to
   * whichever row the writer happened to hold. Taking ids from the folded set
   * drops any refund attached to a row the fold discarded, which silently loses
   * money that was really returned: a genuine refund_succeeded webhook was
   * ignored exactly this way. Double counting is prevented by folding the
   * refunds on their own processor id, not by narrowing this set.
   */
  const myIds = new Set(rows.map((p) => p.id));

  // Only succeeded money counts. A processing payment is not collected, and
  // treating it as collected is how a statement shows paid before it is.
  const amountPaid = sum(mine.filter((p) => p.status === "succeeded").map((p) => p.amount));

  const amountRefunded = sum(
    latestPerProcessorId(
      refunds.filter((r) => myIds.has(r.paymentId)),
      (r) => r.hyperswitchRefundId,
    )
      .filter((r) => r.status === "succeeded")
      .map((r) => r.amount),
  );

  /**
   * A payer correction supersedes the residual the statement was issued with.
   * The line items are left alone: the statement is a record of what the
   * patient was told, and a correction is a later fact about it rather than a
   * reason to rewrite it. See docs/DECISIONS.md D-025.
   */
  const patientOwed = readjudication?.revisedPatientResponsibility ?? patientResponsibility(statement);
  const collected = subtract(amountPaid, amountRefunded);
  const remaining = clampToZero(subtract(patientOwed, collected));

  return {
    statementId: statement.id,
    totalCharged: totalCharged(statement),
    payerAdjustment: payerAdjustment(statement),
    payerPaid: payerPaid(statement),
    patientResponsibility: patientOwed,
    amountPaid,
    amountRefunded,
    remaining,
    status: deriveStatus(
      patientOwed,
      remaining,
      amountRefunded,
      mine.some((p) => IN_FLIGHT.has(p.status)),
    ),
  };
}

/**
 * The settled activity on a statement, oldest first.
 *
 * The same fold the balance uses, exposed because a receipt has to show the
 * same set of payments the balance counted. A receipt derived from a different
 * view of the log than the balance is how a patient ends up with a receipt that
 * does not add up to what they were charged.
 */
export function settledActivity(
  statement: Statement,
  payments: readonly Payment[],
  refunds: readonly Refund[],
): { readonly payments: readonly Payment[]; readonly refunds: readonly Refund[] } {
  const rows = payments.filter((p) => p.statementId === statement.id);
  const mine = latestPerProcessorId(rows, (p) => p.hyperswitchPaymentId).filter(
    (p) => p.status === "succeeded",
  );

  // Every row, for the reason in deriveBalance: a refund is bound to whichever
  // row its writer held, and narrowing to the settled ones drops refunds that
  // really happened. A receipt that omits a refund is worse than one that omits
  // a payment, because the patient is looking for the money that came back.
  const myIds = new Set(rows.map((p) => p.id));

  return {
    payments: [...mine].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    refunds: latestPerProcessorId(
      refunds.filter((r) => myIds.has(r.paymentId)),
      (r) => r.hyperswitchRefundId,
    )
      .filter((r) => r.status === "succeeded")
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
  };
}

/**
 * The most recent attempt on a statement, succeeded or not.
 *
 * `settledActivity` deliberately drops failures because a receipt is a record
 * of money that moved. A decline is not that, and it is exactly what the next
 * screen has to talk about, so it is read separately.
 */
export function latestAttempt(
  statement: Statement,
  payments: readonly Payment[],
): Payment | null {
  return latestPerProcessorId(
    payments.filter((p) => p.statementId === statement.id),
    (p) => p.hyperswitchPaymentId,
  ).reduce<Payment | null>(
    (newest, row) => (newest === null || row.updatedAt > newest.updatedAt ? row : newest),
    null,
  );
}
