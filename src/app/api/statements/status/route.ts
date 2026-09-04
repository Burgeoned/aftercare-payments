import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { deriveBalance } from "@/lib/domain/balance";
import {
  findStatementById,
  paymentsForStatement,
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

export async function GET(): Promise<NextResponse> {
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
  );

  return NextResponse.json({
    ref: statement.ref,
    status: balance.status,
    remaining: balance.remaining,
    amountPaid: balance.amountPaid,
  });
}
