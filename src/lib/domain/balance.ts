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
import type {
  Cents,
  Payment,
  Refund,
  Statement,
  StatementBalance,
  StatementStatus,
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

export function deriveBalance(
  statement: Statement,
  payments: readonly Payment[],
  refunds: readonly Refund[],
): StatementBalance {
  const mine = payments.filter((p) => p.statementId === statement.id);
  const myIds = new Set(mine.map((p) => p.id));

  // Only succeeded money counts. A processing payment is not collected, and
  // treating it as collected is how a statement shows paid before it is.
  const amountPaid = sum(mine.filter((p) => p.status === "succeeded").map((p) => p.amount));

  const amountRefunded = sum(
    refunds.filter((r) => myIds.has(r.paymentId) && r.status === "succeeded").map((r) => r.amount),
  );

  const patientOwed = patientResponsibility(statement);
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
