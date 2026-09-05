import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { deriveBalance, healthAccountEligibleAmount } from "@/lib/domain/balance";
import { parsePortion, resolvePayableAmount, wouldOverCollect } from "@/lib/domain/intent";
import { STATEMENT_DESCRIPTOR } from "@/lib/domain/fixtures";
import {
  appendPayment,
  findStatementById,
  indexPayment,
  paymentsForStatement,
  readjudicationFor,
  refundsForPayments,
} from "@/lib/domain/store";
import { serverEnv } from "@/lib/env";
import { createPayment, getPayment, HyperswitchError } from "@/lib/hyperswitch/client";
import type { Payment, PaymentError } from "@/lib/domain/types";

/**
 * Creates a Hyperswitch payment for a statement and returns the client secret.
 *
 * The client names a portion, never an amount. Accepting a number and checking
 * it against the derived balance is not enough: JSON turns `927.00` into the
 * integer `927`, so a caller meaning $927 is charged $9.27 and every integer
 * check passes. See docs/DECISIONS.md D-015.
 *
 * The statement is identified by the access cookie, not by the body. A request
 * body naming a statement would let anyone create a payment against any
 * statement whose reference they could guess, and the reference is printed on a
 * piece of paper.
 */

export const dynamic = "force-dynamic";

/**
 * Statuses where an existing payment can still be confirmed by the browser.
 *
 * `requires_customer_action` is deliberately absent. A payment in that state is
 * mid-3DS with the patient on the issuer's page, and handing a second browser
 * the same secret is not a reuse, it is a race.
 */
const REUSABLE: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_confirmation",
]);

const STATUS_FOR: Record<PaymentError["kind"], number> = {
  statement_not_found: 404,
  statement_already_paid: 409,
  statement_transferred: 409,
  amount_exceeds_balance: 422,
  processor_rejected: 502,
  processor_unreachable: 503,
};

/** Patient-facing. The processor's own wording is logged, never shown. */
function messageFor(error: PaymentError): string {
  switch (error.kind) {
    case "statement_not_found":
      return "That statement could not be found.";
    case "statement_already_paid":
      return "This statement is already paid in full.";
    case "statement_transferred":
      return "This balance is no longer handled by the provider. Contact the billing office.";
    case "amount_exceeds_balance":
      return "That amount is more than the remaining balance.";
    case "processor_rejected":
      return "The payment could not be started. Try again in a moment.";
    case "processor_unreachable":
      return "We could not reach the payment processor. Try again in a moment.";
  }
}

function fail(error: PaymentError): NextResponse {
  return NextResponse.json(
    { error: error.kind, message: messageFor(error) },
    { status: STATUS_FOR[error.kind] },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const statementId = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (statementId === null) {
    return NextResponse.json(
      { error: "no_access", message: "Look up your statement again to continue." },
      { status: 401 },
    );
  }

  const statement = findStatementById(statementId);
  if (statement === null) return fail({ kind: "statement_not_found", ref: statementId });

  let body: { portion?: unknown } = {};
  if (request.headers.get("content-type")?.includes("application/json") === true) {
    try {
      body = (await request.json()) as { portion?: unknown };
    } catch {
      return NextResponse.json(
        { error: "malformed_request", message: "Expected a JSON body." },
        { status: 400 },
      );
    }
  }

  const portion = parsePortion(body.portion);
  if (!portion.ok) {
    return NextResponse.json(
      {
        error: "malformed_portion",
        message: 'A portion must be "full" or "health_account".',
      },
      { status: 400 },
    );
  }

  const existing = await paymentsForStatement(statement.id);
  /**
   * The payer correction is passed here like everywhere else. It was omitted,
   * and this was the only one of five callers that omitted it: the one that
   * decides what to charge. A statement corrected downwards still derived its
   * original residual here, so a patient returning to a settled statement would
   * have been charged the difference again. See D-029.
   */
  const balance = deriveBalance(
    statement,
    existing,
    await refundsForPayments(existing.map((p) => p.id)),
    await readjudicationFor(statement.id),
  );

  const payable = resolvePayableAmount(
    balance,
    portion.value,
    healthAccountEligibleAmount(statement),
  );
  if (!payable.ok) return fail(payable.error);

  /**
   * Checked once the amount is known, because the question is whether this
   * request would over-collect rather than whether anything is in flight. Split
   * tender legs stay under the balance and proceed; a re-submitted full balance
   * does not. See D-032.
   */
  const clash = wouldOverCollect(existing, balance.remaining, payable.value);
  if (clash !== null) {
    return NextResponse.json(
      {
        error: "payment_in_flight",
        message:
          "A payment on this statement is still being confirmed with your bank. " +
          "Wait for it to finish before starting another.",
        hyperswitchPaymentId: clash.hyperswitchPaymentId,
      },
      { status: 409 },
    );
  }

  let env;
  try {
    env = serverEnv();
  } catch (error) {
    return NextResponse.json(
      {
        error: "configuration",
        message: error instanceof Error ? error.message : "Environment is incomplete",
      },
      { status: 500 },
    );
  }

  /**
   * Reuse an intent rather than create a second one.
   *
   * Without this, every mount of the checkout creates a real payment at the
   * processor. A patient double-clicking, a remount, or changing the split
   * tender choice each left an orphan sitting in `requires_payment_method`
   * forever, because nothing resolves a payment the patient never confirmed.
   * They are noise in reconciliation and they are not free.
   *
   * Reused only when the processor still agrees it is usable. Our ledger says
   * what we last heard; the processor says what is true now, and an intent can
   * expire without anyone telling us.
   */
  const reusable = existing
    .filter((p) => p.amount === payable.value && REUSABLE.has(p.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (reusable !== undefined) {
    try {
      const live = await getPayment(reusable.hyperswitchPaymentId);
      const expired =
        live.expires_on !== undefined && new Date(live.expires_on).getTime() <= Date.now();

      /**
       * The processor's own view, which is newer than the ledger. If it says
       * this payment already succeeded, a second intent would charge the
       * patient twice for a balance the webhook has not recorded yet.
       */
      if (live.status === "succeeded" || live.status === "processing") {
        return NextResponse.json(
          {
            error: "payment_in_flight",
            message:
              "A payment on this statement has already been submitted and is confirming. " +
              "Wait for it to finish before starting another.",
            hyperswitchPaymentId: live.payment_id,
          },
          { status: 409 },
        );
      }

      if (REUSABLE.has(live.status) && live.client_secret !== null && !expired) {
        return NextResponse.json({
          paymentId: reusable.id,
          hyperswitchPaymentId: live.payment_id,
          clientSecret: live.client_secret,
          amount: payable.value,
          currency: statement.currency,
          reused: true,
        });
      }
    } catch (error) {
      // A failed lookup is not a reason to refuse the payment. Fall through and
      // create a fresh intent, which is the behaviour this replaced.
      console.warn("could not reuse an existing intent", error);
    }
  }

  let created;
  try {
    created = await createPayment({
      amount: payable.value,
      currency: statement.currency,
      // Opaque by construction. The descriptor names the provider group and
      // nothing about the care. See docs/DESIGN.md section 10.
      description: `${STATEMENT_DESCRIPTOR} statement ${statement.ref}`,
      statementDescriptor: STATEMENT_DESCRIPTOR,
      statementRef: statement.ref,
      returnUrl: `${env.appUrl}/pay/return`,
    });
  } catch (error) {
    if (error instanceof HyperswitchError) {
      console.error("hyperswitch intent failed", error.httpStatus, error.body);
      return fail(
        error.httpStatus === 0
          ? { kind: "processor_unreachable" }
          : { kind: "processor_rejected", reason: error.message },
      );
    }
    throw error;
  }

  if (created.client_secret === null) {
    console.error("hyperswitch returned no client secret", created.payment_id);
    return fail({ kind: "processor_rejected", reason: "No client secret returned" });
  }

  /**
   * Recorded before the patient confirms. This is the correlation record: the
   * webhook arrives carrying the Hyperswitch payment id, and without a row
   * written now there is nothing to attach it to. It is not evidence that money
   * moved, and `deriveBalance` counts only succeeded payments.
   */
  /**
   * `updatedAt` is the processor's clock, never ours. types.ts is explicit
   * about this and the first version of this route ignored it, which made the
   * webhook handler reject every genuine event as out of order: it was
   * comparing our request time against Hyperswitch's resource time.
   *
   * The epoch fallback reads as "no processor observation yet", so any real
   * webhook supersedes it. A wall clock fallback would not, because our clock
   * can run ahead of theirs.
   */
  const observedAt = created.updated ?? created.created ?? "1970-01-01T00:00:00.000Z";
  const now = new Date().toISOString();
  const payment: Payment = {
    id: randomUUID(),
    statementId: statement.id,
    hyperswitchPaymentId: created.payment_id,
    amount: payable.value,
    currency: statement.currency,
    status: created.status,
    tender: null,
    failureReason: null,
    createdAt: now,
    updatedAt: observedAt,
  };
  await appendPayment(payment);

  /**
   * Written before the patient can confirm, because the webhook may arrive
   * before this request has even returned. Without the index the webhook has a
   * processor payment id and no way to reach the statement it belongs to.
   */
  await indexPayment(created.payment_id, statement.id);

  return NextResponse.json({
    paymentId: payment.id,
    hyperswitchPaymentId: created.payment_id,
    clientSecret: created.client_secret,
    amount: payable.value,
    currency: statement.currency,
  });
}
