import type { HyperswitchPayment } from "@/lib/hyperswitch/client";
import { latestPerProcessorId } from "./balance";
import { cents } from "./types";
import type { Payment } from "./types";

/**
 * Repair for a webhook that never arrived.
 *
 * `DESIGN.md` section 6 says webhooks are the source of truth, and that is
 * right. It is also at-least-once delivery over a network, which means a source
 * of truth needs a repair path and this one did not have one.
 *
 * The gap was circular and worth naming. `/pay/return` polls the derived
 * statement status, and the statement status can only move when a webhook
 * lands. So the documented "webhook never arrives" fallback was polling a value
 * that by construction cannot change without the thing it is a fallback for. It
 * was not a fallback, it was a longer wait.
 *
 * This asks the processor directly. `GET /payments/{id}` was already in the
 * client, used for intent reuse, and simply never wired to recovery.
 *
 * WHAT THIS IS NOT. It is not a second source of truth. A reconciled row is
 * written into the same append-only log, carrying the processor's own timestamp,
 * and read through the same fold as everything else. If a webhook arrives later
 * describing the same payment, the newer of the two wins on `updatedAt` exactly
 * as two webhooks would. Reconciliation cannot race the webhook into a
 * different answer, because both are asking the processor what happened.
 */

/** Statuses where the processor has said something final enough to record. */
const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

/** Statuses in our ledger that are worth asking the processor about. */
const UNRESOLVED: ReadonlySet<Payment["status"]> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_customer_action",
  "processing",
]);

export function needsReconciliation(payments: readonly Payment[]): readonly Payment[] {
  return latestPerProcessorId(payments, (p) => p.hyperswitchPaymentId).filter((p) =>
    UNRESOLVED.has(p.status),
  );
}

/**
 * Builds the row to append, or null when the processor agrees with the ledger.
 *
 * Returns null rather than an unchanged row so a reconciliation sweep that finds
 * nothing writes nothing. A log that grows every time somebody refreshes is a
 * log nobody can read.
 */
export function reconciledRow(
  known: Payment,
  live: HyperswitchPayment,
  observedAt: string,
): Payment | null {
  if (!TERMINAL.has(live.status)) return null;
  if (live.status === known.status) return null;

  /**
   * The processor's clock, falling back to ours only when it reports none.
   * Comparing our clock against theirs is what made every genuine webhook look
   * stale in D-018, and a reconciled row is compared against webhook rows by
   * exactly that field.
   */
  const updatedAt = live.updated ?? live.created ?? observedAt;

  // A row whose timestamp does not beat what we hold would be folded away the
  // moment it is written. Writing it anyway is noise.
  if (updatedAt <= known.updatedAt) return null;

  return {
    id: known.id,
    statementId: known.statementId,
    hyperswitchPaymentId: known.hyperswitchPaymentId,
    amount: cents(live.amount),
    currency: "USD",
    status: live.status,
    // The processor's payment object does not carry the tender detail a webhook
    // does, so what we already know is kept rather than blanked.
    tender: known.tender,
    failureReason: live.status === "failed" ? known.failureReason : null,
    createdAt: known.createdAt,
    updatedAt,
  };
}
