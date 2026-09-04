import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { deriveBalance, healthAccountEligibleAmount } from "@/lib/domain/balance";
import { parsePortion, resolvePayableAmount } from "@/lib/domain/intent";
import { STATEMENT_DESCRIPTOR } from "@/lib/domain/fixtures";
import {
  appendPayment,
  findStatementById,
  paymentsForStatement,
  refundsForPayments,
} from "@/lib/domain/store";
import { serverEnv } from "@/lib/env";
import { createPayment, HyperswitchError } from "@/lib/hyperswitch/client";
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
  const balance = deriveBalance(
    statement,
    existing,
    await refundsForPayments(existing.map((p) => p.id)),
  );

  const payable = resolvePayableAmount(
    balance,
    portion.value,
    healthAccountEligibleAmount(statement),
  );
  if (!payable.ok) return fail(payable.error);

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

  let created;
  try {
    created = await createPayment({
      amount: payable.value,
      currency: statement.currency,
      // Opaque by construction. The descriptor names the provider group and
      // nothing about the care. See docs/DESIGN.md section 10.
      description: `${STATEMENT_DESCRIPTOR} statement ${statement.ref}`,
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
    updatedAt: now,
  };
  await appendPayment(payment);

  return NextResponse.json({
    paymentId: payment.id,
    hyperswitchPaymentId: created.payment_id,
    clientSecret: created.client_secret,
    amount: payable.value,
    currency: statement.currency,
  });
}
