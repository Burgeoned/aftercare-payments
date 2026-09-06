import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  appendPayment,
  appendRefund,
  clearFixtureLedger,
  indexPayment,
  recordReadjudication,
} from "@/lib/domain/store";
import { REBUILD_TARGETS, rebuildIsSound, rebuiltPayment, rebuiltRefund } from "@/lib/domain/reset";
import { cents } from "@/lib/domain/types";
import { getPayment, getRefund, HyperswitchError } from "@/lib/hyperswitch/client";
import { isStaff, STAFF_COOKIE } from "@/lib/staff";

/**
 * Returns the demo to a known state.
 *
 * The ledger is append-only and the fixtures are shared, so the demo is a
 * one-way resource: paying a statement consumes it for everyone who looks
 * afterwards, and each declined attempt leaves a row in a statement's history.
 * Without this, the site degrades with every visitor.
 *
 * Two phases, in this order. Everything the fixtures own is deleted, and then
 * the one statement that carries the refund story is rebuilt from Hyperswitch's
 * own record of the payment and the refund that really happened.
 *
 * The rebuild reads rather than remembers on purpose. Writing a remembered
 * `succeeded` row would put a payment in the ledger that no verified webhook
 * ever produced, which is precisely what hard rules 3 and 4 exist to prevent,
 * and a reviewer would be right to ask how the ledger knows. Retrieving it
 * means the restored state is the processor's answer, arrived at through the
 * same retrieval the reconciliation path already uses. If the sandbox account
 * is ever replaced, the ids stop resolving and this reports a partial reset
 * rather than inventing a statement that was never paid.
 *
 * Staff only, and it would not exist in production at all. See D-038.
 */

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  if (!isStaff((await cookies()).get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const cleared = await clearFixtureLedger();
  const rebuilt: string[] = [];
  const skipped: string[] = [];

  for (const target of REBUILD_TARGETS) {
    try {
      const [live, refund] = await Promise.all([
        getPayment(target.hyperswitchPaymentId),
        getRefund(target.hyperswitchRefundId),
      ]);

      if (!rebuildIsSound(live, refund)) {
        skipped.push(
          `${target.statementId}: processor reports payment ${live.status} and refund ` +
            `${refund.status}, which does not support a paid and partially refunded statement`,
        );
        continue;
      }

      const paymentRowId = randomUUID();
      await appendPayment(rebuiltPayment(paymentRowId, target.statementId, live));

      /**
       * Written so a later webhook for this payment can still find its
       * statement. A rebuilt ledger that a webhook cannot reach is a ledger
       * that stops updating.
       */
      await indexPayment(live.payment_id, target.statementId);

      await appendRefund(rebuiltRefund(randomUUID(), paymentRowId, refund));

      /**
       * The correction is what makes the refund correct rather than arbitrary.
       * Restoring the refund without it would leave a statement that was
       * refunded for no stated reason and still owing the difference.
       *
       * Dated from the refund, not from now. Stamping it with the reset's own
       * clock put the correction after the refund it justifies, so the receipt
       * read "your insurer reprocessed this claim on September 6" above a
       * refund issued on September 5: money returned before the reason for it
       * existed. In the live console the correction is recorded immediately
       * before the refund is issued, so the refund's own creation time is both
       * accurate and the only clock in this rebuild that is not ours.
       */
      await recordReadjudication({
        statementId: target.statementId,
        revisedPatientResponsibility: cents(target.readjudication.revisedPatientResponsibility),
        reason: target.readjudication.reason,
        at: refund.created_at ?? live.updated ?? new Date().toISOString(),
      });

      rebuilt.push(target.statementId);
    } catch (error) {
      const detail =
        error instanceof HyperswitchError ? error.message : "could not reach the processor";
      skipped.push(`${target.statementId}: ${detail}`);
    }
  }

  return NextResponse.json({ cleared, rebuilt, skipped });
}
