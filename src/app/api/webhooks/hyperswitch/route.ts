import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { classifyDecline } from "@/lib/domain/decline";
import { classifyTender } from "@/lib/domain/tender";
import { cents } from "@/lib/domain/types";
import {
  appendPayment,
  appendRefund,
  claimEvent,
  paymentsForStatement,
  statementForPayment,
} from "@/lib/domain/store";
import { serverEnv } from "@/lib/env";
import { isFailure, parseWebhook, type PaymentEvent, type RefundEvent } from "@/lib/webhooks/parse";
import { describeSignatureShape, SIGNATURE_HEADER, verifySignature } from "@/lib/webhooks/verify";
import type { Payment, Refund, TenderDetail } from "@/lib/domain/types";

/**
 * The webhook sink. This is where money state actually changes.
 *
 * Four things have to be true, and each of them fails a different way:
 *
 *   1. The signature is verified over the raw body, before the JSON is parsed.
 *      Re-serializing parsed JSON changes byte order and the digest will not
 *      match.
 *   2. A repeated `event_id` changes nothing and is acknowledged with 200. An
 *      error response to a duplicate produces retries for 24 hours.
 *   3. An event older than what is already recorded is discarded rather than
 *      appended, so state cannot walk backwards.
 *   4. Everything else is acknowledged, because a non-2XX means Hyperswitch
 *      retries on a schedule that escalates to six-hourly for 24 hours, and a
 *      payload this application cannot use will not become usable on retry.
 *
 * Answering 200 to something we discarded is deliberate. The alternative is a
 * retry loop over a permanent condition.
 */

export const dynamic = "force-dynamic";

/** Acknowledged. The body says what happened, for anyone reading logs. */
function ack(outcome: string, detail?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ received: true, outcome, ...detail }, { status: 200 });
}

/**
 * Tender recorded from what the processor reported, classified at the BIN.
 *
 * This is the point where a card stops being a card and becomes a health
 * account credential or does not. Everything downstream that is specific to
 * this vertical hangs off it: what the receipt says, and where a refund is
 * allowed to go. See src/lib/domain/tender.ts.
 */
function tenderFrom(event: PaymentEvent): TenderDetail | null {
  return classifyTender({
    paymentMethod: event.paymentMethod,
    cardIsin: event.cardIsin,
    last4: event.last4,
    cardNetwork: event.cardNetwork,
  });
}

async function applyPayment(event: PaymentEvent): Promise<NextResponse> {
  const statementId = await statementForPayment(event.hyperswitchPaymentId);
  if (statementId === null) {
    // A payment this application did not create. Acknowledged so the retry
    // schedule stops, and logged because it should not happen.
    console.warn("webhook for an unknown payment", event.hyperswitchPaymentId);
    return ack("unknown_payment");
  }

  const existing = await paymentsForStatement(statementId);
  const latest = existing
    .filter((p) => p.hyperswitchPaymentId === event.hyperswitchPaymentId)
    .reduce<Payment | null>(
      (newest, row) => (newest === null || row.updatedAt > newest.updatedAt ? row : newest),
      null,
    );

  if (latest !== null && latest.updatedAt >= event.updatedAt) {
    // Out of order, or a redelivery under a different event id. The balance
    // fold would ignore it anyway, but appending it grows the log with rows
    // that can only ever be discarded again.
    return ack("stale", { recorded: latest.updatedAt, received: event.updatedAt });
  }

  if (event.currency !== "USD") {
    console.error(
      "webhook reported a currency this application does not bill in",
      event.hyperswitchPaymentId,
      event.currency,
    );
  }

  const tender = tenderFrom(event);

  /**
   * Classified here rather than at read time, because the connector's own code
   * and message are the only inputs and they are not worth keeping: they are
   * connector-specific, they change, and showing one to a patient is exactly
   * what this normalization exists to prevent. The category is stored; the
   * wording is derived when it is rendered, so improving the wording does not
   * require rewriting the log.
   */
  const failureReason =
    event.status === "failed"
      ? classifyDecline({
          unifiedCode: event.unifiedCode,
          unifiedMessage: event.unifiedMessage,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage,
          tenderClass: tender?.class ?? null,
        }).category
      : null;

  const payment: Payment = {
    id: randomUUID(),
    statementId,
    hyperswitchPaymentId: event.hyperswitchPaymentId,
    amount: cents(event.amount),
    /**
     * The contract carries one currency and this application only bills in it.
     * The processor's value is compared rather than copied, because an amount
     * recorded under the wrong unit is a number, not money. A mismatch is
     * logged and the row is still written under USD, which keeps the ledger
     * readable while making the discrepancy visible.
     */
    currency: "USD",
    status: event.status,
    tender,
    failureReason,
    createdAt: new Date().toISOString(),
    // The processor's clock, not ours. Ordering compares these across
    // deliveries and our clock has nothing to do with when the resource moved.
    updatedAt: event.updatedAt,
  };

  await appendPayment(payment);
  return ack("applied", { status: event.status });
}

async function applyRefund(event: RefundEvent): Promise<NextResponse> {
  const statementId = await statementForPayment(event.hyperswitchPaymentId);
  if (statementId === null) {
    console.warn("refund webhook for an unknown payment", event.hyperswitchPaymentId);
    return ack("unknown_payment");
  }

  const payments = await paymentsForStatement(statementId);
  const forPayment = payments.filter(
    (p) => p.hyperswitchPaymentId === event.hyperswitchPaymentId,
  );

  /**
   * Several rows describe one processor payment. Bind the refund to the settled
   * one, falling back to the newest, rather than to whichever happens to be
   * first in the log: the first row is usually the intent, written before the
   * patient had even entered a card.
   */
  const payment =
    forPayment.find((p) => p.status === "succeeded") ??
    forPayment.reduce<Payment | null>(
      (newest, row) => (newest === null || row.updatedAt > newest.updatedAt ? row : newest),
      null,
    );
  if (payment === null || payment === undefined) return ack("unknown_payment");

  const refund: Refund = {
    id: randomUUID(),
    // Bound to the payment, which is what keeps health account funds returning
    // to the account they came from. See docs/DOMAIN.md section 5.
    paymentId: payment.id,
    hyperswitchRefundId: event.hyperswitchRefundId,
    amount: cents(event.amount),
    reason: "readjudication",
    status: event.status,
    createdAt: new Date().toISOString(),
    updatedAt: event.updatedAt,
  };

  await appendRefund(refund);
  return ack("applied", { status: event.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let secret: string;
  try {
    secret = serverEnv().hyperswitchWebhookSecret;
  } catch (error) {
    console.error("webhook rejected: environment incomplete", error);
    return NextResponse.json({ error: "configuration" }, { status: 500 });
  }

  // Raw bytes, read before anything parses them.
  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);

  if (!verifySignature(rawBody, signature, secret)) {
    /**
     * 401 and no state change. This is the one case that must not be
     * acknowledged: an unverified webhook is not a Hyperswitch webhook as far
     * as this application is concerned, and a 2XX would tell an attacker their
     * forgery was accepted.
     *
     * The log records the shape of the signature, never its value, because the
     * documented algorithm does not state the header encoding and a systematic
     * mismatch looks identical to a wrong secret.
     */
    console.warn("webhook signature rejected", describeSignatureShape(signature));
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return ack("unparseable_body");
  }

  const event = parseWebhook(body);
  if (isFailure(event)) {
    console.warn("webhook could not be interpreted", event.reason);
    return ack("uninterpretable", { reason: event.reason });
  }

  /**
   * Claimed after verification and parsing, so a forged or malformed payload
   * cannot burn the event id of a real event that has not arrived yet.
   */
  if (!(await claimEvent(event.eventId))) {
    return ack("duplicate", { eventId: event.eventId });
  }

  if (event.kind === "payment") return await applyPayment(event);
  if (event.kind === "refund") return await applyRefund(event);

  // Disputes and mandates. Recorded in the log and not acted on.
  console.info("webhook received and not acted on", event.eventType, event.contentType);
  return ack("unhandled", { eventType: event.eventType });
}
