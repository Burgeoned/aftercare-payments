/**
 * Domain contract for Aftercare.
 *
 * Written before implementation and changed deliberately. See docs/DESIGN.md
 * section 12 for the reasoning behind the shape of these types, and
 * docs/DOMAIN.md for the requirements they encode.
 *
 * Two invariants are enforced by the type system rather than by convention:
 *
 *   1. Money is an integer count of cents. `Cents` is branded so a raw number
 *      cannot be passed where money is expected, which is what stops a dollar
 *      float from reaching an amount field.
 *   2. Payment and Refund records are append only. Statement status is derived
 *      from them, never stored. A stored balance and a payment log drift, and
 *      the patient is the one who discovers the drift.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

declare const centsBrand: unique symbol;

/** Integer minor units. Never a float, never dollars. */
export type Cents = number & { readonly [centsBrand]: true };

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Money must be an integer count of cents, got ${value}`);
  }
  return value as Cents;
}

/** ISO 8601 instant. Kept as a string so it survives JSON round trips intact. */
export type Timestamp = string;

export type Currency = "USD";

// ---------------------------------------------------------------------------
// Tender
// ---------------------------------------------------------------------------

/**
 * How the patient paid. `health_account` is a card whose BIN falls in a
 * restricted HSA or FSA range. It is not a distinct payment method at the
 * processor, which is why this is a classification and not a connector concern.
 * See docs/DOMAIN.md section 5.
 */
export type TenderClass = "standard_card" | "health_account" | "bank_debit";

export interface TenderDetail {
  readonly class: TenderClass;
  /** Last four digits, for display and receipts only. */
  readonly last4: string | null;
  /** Card network or bank name, as reported by the processor. */
  readonly brand: string | null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Carries no clinical data by construction. Clinical context lives in the
 * practice management system and never reaches this layer, let alone the
 * processor.
 */
export interface Patient {
  readonly id: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  /**
   * Set when someone other than the patient is financially responsible. The
   * Hyperswitch customer, and therefore any stored payment method, attaches to
   * the guarantor rather than the patient. Getting this backwards makes a saved
   * card follow the wrong person. See docs/SCOPE.md item 5.
   */
  readonly guarantorId: string | null;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/**
 * One line of an adjudicated claim. Field names follow what an 835 remittance
 * actually provides, so that fixture data and real data have the same shape.
 */
export interface LineItem {
  readonly id: string;
  /**
   * Patient-facing wording only. Never a procedure code or a diagnosis, because
   * this string is shown to the patient and must not leak into payment
   * metadata. See docs/DESIGN.md section 10.
   */
  readonly description: string;
  /** What the provider billed. */
  readonly charged: Cents;
  /** What the payer contract allows. */
  readonly allowed: Cents;
  /** What the payer actually paid. */
  readonly payerPaid: Cents;
  /** Residual owed by the patient for this line. */
  readonly patientOwes: Cents;
  /**
   * Whether this line qualifies for health account funds. Sourced from a
   * fixture here. In production it comes from the practice management system's
   * procedure catalog under SIGIS registration, not from us. See docs/SCOPE.md
   * item 3.
   */
  readonly healthAccountEligible: boolean;
}

/**
 * Derived from the payment log, never stored. `transferred` refuses new
 * payments outright: once a balance leaves the provider, accepting money for it
 * is worse than declining. See docs/SCOPE.md item 7.
 */
export type StatementStatus =
  | "open"
  | "payment_pending"
  /**
   * Collected, but not yet final. A bank debit succeeds at submission and can
   * be returned days later for insufficient funds or a closed account, so
   * treating ACH success as `paid` states something the rail has not decided.
   *
   * This is the one state a card never enters. It exists because the two rails
   * do not settle alike and the receipt should not pretend they do. See
   * docs/SCOPE.md item 2 and docs/DECISIONS.md D-034.
   */
  | "settling"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "transferred";

export interface Statement {
  readonly id: string;
  /** The reference printed on the paper statement. Used for guest lookup. */
  readonly ref: string;
  readonly patientId: string;
  readonly serviceDate: string;
  readonly issuedAt: Timestamp;
  readonly lineItems: readonly LineItem[];
  readonly currency: Currency;
}

/**
 * The computed financial position of a statement at a point in time. Produced
 * by folding the payment and refund log over the statement. Nothing here is
 * persisted.
 */
export interface StatementBalance {
  readonly statementId: string;
  readonly totalCharged: Cents;
  readonly payerAdjustment: Cents;
  readonly payerPaid: Cents;
  readonly patientResponsibility: Cents;
  readonly amountPaid: Cents;
  readonly amountRefunded: Cents;
  /** patientResponsibility - amountPaid + amountRefunded. Never negative. */
  readonly remaining: Cents;
  readonly status: StatementStatus;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** Mirrors the Hyperswitch payment lifecycle. See docs/DESIGN.md section 5. */
export type PaymentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_customer_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * One attempt against a statement. A statement may have several: a retry after
 * a decline, or two successful attempts under split tender. Append only.
 */
export interface Payment {
  readonly id: string;
  readonly statementId: string;
  readonly hyperswitchPaymentId: string;
  readonly amount: Cents;
  readonly currency: Currency;
  readonly status: PaymentStatus;
  readonly tender: TenderDetail | null;
  /** Normalized decline reason, patient-facing. Null unless status is failed. */
  readonly failureReason: string | null;
  readonly createdAt: Timestamp;
  /**
   * Processor timestamp from the webhook payload, not our clock. State
   * transitions compare this to reject out-of-order deliveries. See
   * docs/DESIGN.md section 6.
   */
  readonly updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundStatus = "pending" | "succeeded" | "failed";

/**
 * Why money is going back. `readjudication` is the common case in this vertical
 * and is almost always partial. `overpayment` covers split tender arithmetic.
 * `financial_assistance` is an adjustment rather than a true refund and is kept
 * distinct because it carries different accounting treatment. See
 * docs/DOMAIN.md section 3.
 */
export type RefundReason =
  "readjudication" | "overpayment" | "financial_assistance" | "duplicate_payment";

/**
 * Bound to a specific payment, not to a statement. That is what guarantees
 * health account funds return to the account they came from, which is an IRS
 * constraint rather than a payments convention. See docs/DOMAIN.md section 5.
 */
export interface Refund {
  readonly id: string;
  readonly paymentId: string;
  readonly hyperswitchRefundId: string;
  readonly amount: Cents;
  readonly reason: RefundReason;
  readonly status: RefundStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * The subset of Hyperswitch event types this application acts on. Dispute and
 * mandate events are received and recorded but not acted on in the prototype.
 */
export type HandledWebhookEvent =
  | "payment_succeeded"
  | "payment_failed"
  | "payment_processing"
  | "refund_succeeded"
  | "refund_failed";

/**
 * Recorded for every inbound webhook, verified or not. `eventId` is the
 * idempotency key: a repeat is acknowledged with 200 and discarded, because
 * responding with an error to a duplicate causes an endless retry loop.
 */
export interface WebhookEventRecord {
  readonly eventId: string;
  readonly type: string;
  /** Processor timestamp from the payload, used for ordering. */
  readonly updatedAt: Timestamp;
  readonly receivedAt: Timestamp;
  readonly signatureValid: boolean;
  readonly rawBody: string;
}

// ---------------------------------------------------------------------------
// Service boundaries
// ---------------------------------------------------------------------------

export interface CreateIntentRequest {
  readonly statementRef: string;
  /** Full remaining balance, or a partial amount under split tender. */
  readonly amount: Cents;
}

export interface CreateIntentResult {
  readonly paymentId: string;
  readonly hyperswitchPaymentId: string;
  /** Handed to the browser SDK. Not a secret our server needs to protect. */
  readonly clientSecret: string;
  readonly amount: Cents;
  readonly currency: Currency;
}

/**
 * Every failure the payment path can produce, named. Callers switch on `kind`
 * rather than parsing a message, and there is no catch-all that swallows an
 * unexpected condition silently.
 */
export type PaymentError =
  | { readonly kind: "statement_not_found"; readonly ref: string }
  | { readonly kind: "statement_already_paid"; readonly statementId: string }
  | { readonly kind: "statement_transferred"; readonly statementId: string }
  | {
      readonly kind: "amount_exceeds_balance";
      readonly requested: Cents;
      readonly remaining: Cents;
    }
  | { readonly kind: "processor_rejected"; readonly reason: string }
  | { readonly kind: "processor_unreachable" };

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
