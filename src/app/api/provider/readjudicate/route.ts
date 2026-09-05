import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { deriveBalance } from "@/lib/domain/balance";
import { allocateRefund, overpaymentFrom, type Readjudication } from "@/lib/domain/refund";
import {
  appendRefund,
  findStatementByRef,
  paymentsForStatement,
  readjudicationFor,
  recordReadjudication,
  refundsForPayments,
} from "@/lib/domain/store";
import { createRefund, HyperswitchError } from "@/lib/hyperswitch/client";
import { cents } from "@/lib/domain/types";
import type { Refund } from "@/lib/domain/types";

/**
 * A simulated payer correction, and the refund it produces.
 *
 * A provider action, not a patient one. Patients do not self-serve refunds on
 * medical bills: the correction originates with the payer reprocessing a claim,
 * and the provider is the party that learns it happened. See docs/DESIGN.md
 * section 9.
 *
 * In production the input is an 835 remittance carrying a revised patient
 * responsibility. Here it is a number typed into a provider form, which is the
 * same shape with the EDI removed. See docs/SCOPE.md item 8.
 *
 * NOT AUTHENTICATED, and that is a stated prototype boundary rather than an
 * oversight. A real provider console sits behind staff authentication with an
 * audit trail, because this endpoint moves money out of the provider. It is
 * recorded in docs/SCOPE.md rather than half-built here.
 */

export const dynamic = "force-dynamic";

interface Body {
  readonly ref?: unknown;
  readonly revisedPatientResponsibility?: unknown;
  readonly reason?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "malformed_request" }, { status: 400 });
  }

  if (typeof body.ref !== "string") {
    return NextResponse.json({ error: "missing_ref" }, { status: 400 });
  }

  /**
   * Integer minor units, like every amount that crosses a boundary here. This
   * one is typed by a person rather than sent by a browser, which makes the
   * unit mistake more likely rather than less: 627 meaning six hundred and
   * twenty seven dollars would refund a hundredth of what was intended.
   */
  if (
    typeof body.revisedPatientResponsibility !== "number" ||
    !Number.isInteger(body.revisedPatientResponsibility) ||
    body.revisedPatientResponsibility < 0
  ) {
    return NextResponse.json(
      {
        error: "malformed_amount",
        message: "revisedPatientResponsibility must be a whole number of cents, zero or more.",
      },
      { status: 400 },
    );
  }

  const statement = findStatementByRef(body.ref);
  if (statement === null) {
    return NextResponse.json({ error: "statement_not_found" }, { status: 404 });
  }

  const payments = await paymentsForStatement(statement.id);
  const refunds = await refundsForPayments(payments.map((p) => p.id));
  const before = deriveBalance(
    statement,
    payments,
    refunds,
    await readjudicationFor(statement.id),
  );

  const revised = cents(body.revisedPatientResponsibility);
  const owedBack = overpaymentFrom(revised, before.amountPaid, before.amountRefunded);

  const revision: Readjudication = {
    statementId: statement.id,
    revisedPatientResponsibility: revised,
    reason:
      typeof body.reason === "string" && body.reason !== ""
        ? body.reason
        : "Payer reprocessed the claim",
    at: new Date().toISOString(),
  };

  /**
   * Recorded before any money moves. If a refund call fails partway, the
   * statement still shows the corrected balance, which is the true one. The
   * other ordering leaves a patient owing a figure the payer has already
   * withdrawn.
   */
  await recordReadjudication(revision);

  if (owedBack === 0) {
    return NextResponse.json({
      ref: statement.ref,
      revisedPatientResponsibility: revised,
      refunded: 0,
      refunds: [],
      note: "Balance corrected. Nothing was over-collected, so no refund is due.",
    });
  }

  const allocation = allocateRefund(payments, refunds, owedBack);
  if (!allocation.ok) {
    return NextResponse.json(
      {
        error: allocation.error.kind,
        detail: allocation.error,
        revisedPatientResponsibility: revised,
      },
      { status: 422 },
    );
  }

  const issued: { paymentId: string; amount: number; hyperswitchRefundId: string }[] = [];

  for (const part of allocation.value) {
    let created;
    try {
      created = await createRefund({
        paymentId: part.payment.hyperswitchPaymentId,
        amount: part.amount,
        reason: "readjudication",
      });
    } catch (error) {
      if (error instanceof HyperswitchError) {
        console.error("refund rejected by processor", error.httpStatus, error.body);
        return NextResponse.json(
          {
            error: "processor_rejected",
            message: error.message,
            // Whatever already went out stays out. Reporting it is the only way
            // a caller can tell a partial failure from a total one.
            refunds: issued,
            revisedPatientResponsibility: revised,
          },
          { status: 502 },
        );
      }
      throw error;
    }

    /**
     * Recorded as pending. A refund settles when a verified webhook says so,
     * exactly like a payment: `refund_succeeded` supersedes this row. The
     * balance counts only succeeded refunds, so nothing here credits the
     * patient prematurely.
     *
     * `updatedAt` is the epoch for the same reason an intent record uses it:
     * no processor observation has happened yet, so any webhook supersedes it.
     * See D-018.
     */
    const refund: Refund = {
      id: randomUUID(),
      paymentId: part.payment.id,
      hyperswitchRefundId: created.refund_id,
      amount: part.amount,
      reason: "readjudication",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    await appendRefund(refund);

    issued.push({
      paymentId: part.payment.hyperswitchPaymentId,
      amount: part.amount,
      hyperswitchRefundId: created.refund_id,
    });
  }

  return NextResponse.json({
    ref: statement.ref,
    revisedPatientResponsibility: revised,
    refunded: owedBack,
    refunds: issued,
  });
}
