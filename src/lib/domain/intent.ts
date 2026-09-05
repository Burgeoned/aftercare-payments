/**
 * What a statement is allowed to be charged, and why a request might be
 * refused.
 *
 * Pure. Takes a derived balance and a named portion, returns the amount to
 * charge or a named error. Kept out of the route so the money rules are
 * testable without a processor, a network, or a cookie.
 *
 * The client names a portion. It does not name an amount.
 *
 * The first version of this took a number and validated it against the derived
 * balance, which sounds sufficient and is not. JSON parses `927.00` to the
 * integer `927`, so a client meaning $927 sends a value indistinguishable from
 * 927 cents, passes every integer check, and is charged $9.27. No type can
 * catch it: after parsing, the dollar amount and the cent amount are the same
 * number. Removing the free-form amount removes the class. See
 * docs/DECISIONS.md D-015.
 */

import { latestPerProcessorId } from "./balance";
import type { Cents, Payment, PaymentError, Result, StatementBalance } from "./types";

/**
 * The portions a patient may choose to pay.
 *
 * `health_account` is the split tender case: health account balances are finite
 * and frequently smaller than the bill, and only some lines are eligible, so
 * the patient pays the eligible part from one card and the rest from another.
 * Both amounts are computed here from data the server already holds. See
 * docs/DOMAIN.md section 5.
 */
export type PayablePortion = "full" | "health_account";

export function parsePortion(value: unknown): Result<PayablePortion, "malformed_portion"> {
  if (value === undefined || value === null) return { ok: true, value: "full" };
  if (value === "full" || value === "health_account") return { ok: true, value };
  return { ok: false, error: "malformed_portion" };
}

export function resolvePayableAmount(
  balance: StatementBalance,
  portion: PayablePortion,
  healthAccountEligible: Cents,
): Result<Cents, PaymentError> {
  if (balance.status === "transferred") {
    // Fails closed. Once a balance leaves the provider, taking money for it is
    // worse than declining. See docs/SCOPE.md item 7.
    return {
      ok: false,
      error: { kind: "statement_transferred", statementId: balance.statementId },
    };
  }

  if (balance.remaining === 0) {
    return {
      ok: false,
      error: { kind: "statement_already_paid", statementId: balance.statementId },
    };
  }

  if (portion === "full") return { ok: true, value: balance.remaining };

  /**
   * Never more than what is still owed. A patient who has already paid part of
   * the balance from another method must not be charged the full eligible
   * figure on the second attempt.
   */
  const eligible = (
    healthAccountEligible < balance.remaining ? healthAccountEligible : balance.remaining
  ) as Cents;

  if (eligible <= 0) {
    return {
      ok: false,
      error: {
        kind: "amount_exceeds_balance",
        requested: eligible,
        remaining: balance.remaining,
      },
    };
  }

  return { ok: true, value: eligible };
}

/**
 * Statuses where the patient is mid-payment and a second one must not start.
 *
 * `requires_payment_method` and `requires_confirmation` are absent on purpose:
 * nobody has touched those, and D-027 reuses them rather than blocking. These
 * two are different. The patient is at their bank, or the processor is working,
 * and starting a second payment produces two real charges for one balance.
 */
const IN_FLIGHT: ReadonlySet<Payment["status"]> = new Set([
  "requires_customer_action",
  "processing",
]);

/**
 * The payment currently in flight on a statement, if there is one.
 *
 * `balance.ts` has a set by this name used only to derive a status string. The
 * comment there claims a patient who refreshes during a 3DS challenge cannot
 * pay twice, and nothing enforced it. This does. See D-029.
 */
export function inFlightPayment(payments: readonly Payment[]): Payment | null {
  return (
    latestPerProcessorId(payments, (p) => p.hyperswitchPaymentId).find((p) =>
      IN_FLIGHT.has(p.status),
    ) ?? null
  );
}
