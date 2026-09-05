/**
 * Parses a Hyperswitch outgoing webhook into something this application can act
 * on, or reports why it cannot.
 *
 * Field names are taken from the Hyperswitch source rather than inferred:
 * `OutgoingWebhook` carries `merchant_id`, `event_id`, `event_type`, `content`
 * and `timestamp`, and `content` is tagged with `type` and wraps the resource
 * in `object`.
 *
 *   {
 *     "merchant_id": "...",
 *     "event_id": "...",
 *     "event_type": "payment_succeeded",
 *     "timestamp": "2026-09-04T12:00:00.000Z",
 *     "content": { "type": "payment_details", "object": { ...PaymentsResponse } }
 *   }
 *
 * Nothing here is optimistic. A payload missing a field this application needs
 * is rejected by name rather than defaulted, because a defaulted field in a
 * webhook handler is a state transition applied on a guess.
 */

import type { PaymentStatus, RefundStatus, Timestamp } from "@/lib/domain/types";

const PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_customer_action",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

const REFUND_STATUSES: ReadonlySet<string> = new Set(["pending", "succeeded", "failed"]);

export interface PaymentEvent {
  readonly kind: "payment";
  readonly eventId: string;
  readonly eventType: string;
  readonly hyperswitchPaymentId: string;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly currency: string;
  /** Resource timestamp, used for ordering. See `resourceTimestamp`. */
  readonly updatedAt: Timestamp;
  readonly last4: string | null;
  readonly cardNetwork: string | null;
  /** First six digits, the BIN. Carries the health account classification. */
  readonly cardIsin: string | null;
  /** `card`, `bank_debit`, and so on. Settles the tender class before the BIN. */
  readonly paymentMethod: string | null;
  readonly failureReason: string | null;
}

export interface RefundEvent {
  readonly kind: "refund";
  readonly eventId: string;
  readonly eventType: string;
  readonly hyperswitchRefundId: string;
  readonly hyperswitchPaymentId: string;
  readonly status: RefundStatus;
  readonly amount: number;
  readonly updatedAt: Timestamp;
}

/** Received and recorded, but not acted on in this prototype. */
export interface UnhandledEvent {
  readonly kind: "unhandled";
  readonly eventId: string;
  readonly eventType: string;
  readonly contentType: string;
}

export type WebhookEvent = PaymentEvent | RefundEvent | UnhandledEvent;

export type ParseFailure = { readonly reason: string };

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The timestamp used for ordering.
 *
 * Payments carry `updated`; refunds carry `updated_at`. That inconsistency is
 * in the Hyperswitch API itself, so both are read. The envelope `timestamp` is
 * the last resort: it records when the webhook was sent rather than when the
 * resource changed, which is close enough to order deliveries and is not the
 * same thing, so it is only used when the resource carries neither.
 */
function resourceTimestamp(
  resource: Record<string, unknown>,
  envelopeTimestamp: string | null,
): string | null {
  return str(resource, "updated") ?? str(resource, "updated_at") ?? envelopeTimestamp;
}

function cardDetails(resource: Record<string, unknown>): {
  last4: string | null;
  network: string | null;
  isin: string | null;
} {
  // payment_method_data.card, per the payments response schema. Absent for
  // bank debit, which is expected rather than an error.
  const card = obj(obj(resource["payment_method_data"])?.["card"]);
  if (card === null) return { last4: null, network: null, isin: null };

  return {
    last4: str(card, "last4"),
    network: str(card, "card_network"),
    isin: str(card, "card_isin"),
  };
}

export function parseWebhook(body: unknown): WebhookEvent | ParseFailure {
  const envelope = obj(body);
  if (envelope === null) return { reason: "body is not a JSON object" };

  const eventId = str(envelope, "event_id");
  if (eventId === null) return { reason: "missing event_id" };

  const eventType = str(envelope, "event_type");
  if (eventType === null) return { reason: "missing event_type" };

  const content = obj(envelope["content"]);
  if (content === null) return { reason: "missing content" };

  const contentType = str(content, "type");
  if (contentType === null) return { reason: "missing content.type" };

  const resource = obj(content["object"]);
  if (resource === null) return { reason: "missing content.object" };

  const envelopeTimestamp = str(envelope, "timestamp");

  if (contentType === "payment_details") {
    const paymentId = str(resource, "payment_id");
    if (paymentId === null) return { reason: "missing content.object.payment_id" };

    const status = str(resource, "status");
    if (status === null || !PAYMENT_STATUSES.has(status)) {
      return { reason: `unrecognised payment status ${String(status)}` };
    }

    const updatedAt = resourceTimestamp(resource, envelopeTimestamp);
    if (updatedAt === null) return { reason: "no timestamp to order this event by" };

    const amount = resource["amount"];
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      return { reason: "amount is not an integer count of minor units" };
    }

    const card = cardDetails(resource);

    return {
      kind: "payment",
      eventId,
      eventType,
      hyperswitchPaymentId: paymentId,
      status: status as PaymentStatus,
      amount,
      currency: str(resource, "currency") ?? "USD",
      updatedAt,
      last4: card.last4,
      cardNetwork: card.network,
      cardIsin: card.isin,
      paymentMethod: str(resource, "payment_method"),
      failureReason: str(resource, "error_message"),
    };
  }

  if (contentType === "refund_details") {
    // v1 names this `refund_id`; v2 names it `id`. This account is on v1.
    const refundId = str(resource, "refund_id") ?? str(resource, "id");
    if (refundId === null) return { reason: "missing content.object.refund_id" };

    const paymentId = str(resource, "payment_id");
    if (paymentId === null) return { reason: "missing content.object.payment_id" };

    const status = str(resource, "status");
    if (status === null || !REFUND_STATUSES.has(status)) {
      return { reason: `unrecognised refund status ${String(status)}` };
    }

    const updatedAt = resourceTimestamp(resource, envelopeTimestamp);
    if (updatedAt === null) return { reason: "no timestamp to order this event by" };

    const amount = resource["amount"];
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      return { reason: "amount is not an integer count of minor units" };
    }

    return {
      kind: "refund",
      eventId,
      eventType,
      hyperswitchRefundId: refundId,
      hyperswitchPaymentId: paymentId,
      status: status as RefundStatus,
      amount,
      updatedAt,
    };
  }

  /**
   * Disputes and mandates arrive here. They are acknowledged and recorded, not
   * acted on, which is a scope decision rather than an oversight. See
   * docs/SCOPE.md item 6.
   */
  return { kind: "unhandled", eventId, eventType, contentType };
}

export function isFailure(result: WebhookEvent | ParseFailure): result is ParseFailure {
  return "reason" in result;
}
