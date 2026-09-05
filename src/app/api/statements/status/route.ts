import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { deriveBalance, latestAttempt } from "@/lib/domain/balance";
import {
  findStatementById,
  paymentsForStatement,
  readjudicationFor,
  refundsForPayments,
} from "@/lib/domain/store";

/**
 * The current derived status of the statement the caller holds a grant for.
 *
 * Exists for the return page, which needs to know whether the webhook has
 * landed without asking the patient for their date of birth again and without
 * claiming anything the ledger has not recorded. See docs/DESIGN.md section 14:
 * the redirect is a hint, so the page polls the thing that is actually true.
 *
 * Deliberately not a payment lookup. It reports the statement's position, which
 * is what the patient needs, and it cannot be used to enumerate payments.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const statementId = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (statementId === null) {
    return NextResponse.json({ error: "no_access" }, { status: 401 });
  }

  const statement = findStatementById(statementId);
  if (statement === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const payments = await paymentsForStatement(statement.id);
  const balance = deriveBalance(
    statement,
    payments,
    await refundsForPayments(payments.map((p) => p.id)),
    await readjudicationFor(statement.id),
  );

  const attempt = latestAttempt(statement, payments);

  /**
   * The redirect names the payment it came back from. Without it this endpoint
   * can only report that the statement has collected something, which on the
   * second leg of a split tender is already true because of the first leg. The
   * patient was then sent to a receipt for the earlier payment while theirs was
   * still confirming.
   */
  const asked = new URL(request.url).searchParams.get("payment_id");
  const thisPayment =
    asked === null
      ? null
      : payments
          .filter((p) => p.hyperswitchPaymentId === asked)
          .reduce<(typeof payments)[number] | null>(
            (newest, row) => (newest === null || row.updatedAt > newest.updatedAt ? row : newest),
            null,
          );

  return NextResponse.json({
    ref: statement.ref,
    status: balance.status,
    remaining: balance.remaining,
    amountPaid: balance.amountPaid,
    // The category, not a sentence. The client renders the wording, so the two
    // cannot drift apart into two different explanations of one decline.
    lastAttemptStatus: (thisPayment ?? attempt)?.status ?? null,
    declineCategory:
      (thisPayment ?? attempt)?.status === "failed"
        ? ((thisPayment ?? attempt)?.failureReason ?? null)
        : null,
    // Null when the redirect named no payment, which is the old behaviour.
    thisPaymentSettled: thisPayment === null ? null : thisPayment.status === "succeeded",
  });
}
