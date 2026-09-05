import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { needsReconciliation, reconciledRow } from "@/lib/domain/reconcile";
import {
  appendPayment,
  findStatementById,
  paymentsForStatement,
} from "@/lib/domain/store";
import { getPayment, HyperswitchError } from "@/lib/hyperswitch/client";

/**
 * Asks the processor what happened to payments the ledger has not resolved.
 *
 * The repair path for an undelivered webhook. See src/lib/domain/reconcile.ts
 * for why the polling fallback needed one, and docs/DECISIONS.md D-033.
 *
 * Gated by the patient's own statement grant. It reads and repairs one
 * statement, the one they are already looking at, and cannot be used to sweep
 * anyone else's.
 */

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const statementId = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (statementId === null) {
    return NextResponse.json({ error: "no_access" }, { status: 401 });
  }

  const statement = findStatementById(statementId);
  if (statement === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const outstanding = needsReconciliation(await paymentsForStatement(statement.id));
  const observedAt = new Date().toISOString();
  const applied: { hyperswitchPaymentId: string; status: string }[] = [];

  for (const known of outstanding) {
    try {
      const live = await getPayment(known.hyperswitchPaymentId);
      const row = reconciledRow(known, live, observedAt);
      if (row === null) continue;

      await appendPayment(row);
      applied.push({ hyperswitchPaymentId: row.hyperswitchPaymentId, status: row.status });
    } catch (error) {
      /**
       * One unreachable payment must not stop the others. Reconciliation is
       * repair: a partial repair is better than none, and the next attempt
       * picks up whatever this one missed.
       */
      if (error instanceof HyperswitchError) {
        console.warn("could not reconcile", known.hyperswitchPaymentId, error.httpStatus);
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({ checked: outstanding.length, applied });
}
