import type { HyperswitchPayment, HyperswitchRefund } from "@/lib/hyperswitch/client";
import { classifyTender } from "./tender";
import { cents } from "./types";
import type { Payment, Refund, Timestamp } from "./types";

/**
 * Returning the fixtures to a known state.
 *
 * This exists because the demo is a shared, one-way resource. The ledger is
 * append-only in Redis, so the first person to pay a statement consumes it for
 * everyone after them, and a reviewer opening the site after a few test
 * payments finds three settled statements and no payment flow. Failed attempts
 * accumulate too: testing the blocklist three times leaves three declines in a
 * statement's history.
 *
 * WHAT THIS IS NOT. It is not a billing operation and would not exist in a
 * production system. Deleting a payment ledger is the opposite of what a
 * ledger is for, and the honesty of every derived balance in this application
 * rests on the log being append-only. This deletes it. The justification is
 * that the log describes fixture statements against a sandbox account, and
 * that the alternative, a demo that degrades with every visitor, is worse. See
 * docs/DECISIONS.md D-038.
 *
 * WHAT IT DOES NOT TOUCH. Nothing at the processor. The real payments and the
 * real refund stay exactly where they are, which is the point: the baseline is
 * rebuilt by asking Hyperswitch what happened rather than by writing a
 * remembered answer back.
 */

/**
 * The statement that carries the refund story, and the processor records that
 * tell it.
 *
 * These two ids are the one piece of remembered state, and they are references
 * rather than facts: every field of the restored rows is read from the
 * processor's response. If the sandbox account is replaced, these stop
 * resolving and the reset reports that it could not rebuild rather than
 * inventing a statement that was never paid.
 */
export interface RebuildTarget {
  readonly statementId: string;
  readonly hyperswitchPaymentId: string;
  readonly hyperswitchRefundId: string;
  /** The payer correction that made the refund correct, restored alongside it. */
  readonly readjudication: {
    readonly revisedPatientResponsibility: number;
    readonly reason: string;
  };
}

export const REBUILD_TARGETS: readonly RebuildTarget[] = [
  {
    statementId: "stmt_4021",
    hyperswitchPaymentId: "pay_hz3mLO8GL41QrB5AgEN1",
    hyperswitchRefundId: "ref_gmey0mFKKTTx5cRWbhBa",
    readjudication: {
      revisedPatientResponsibility: 2000,
      reason: "Payer reprocessed: coinsurance recalculated",
    },
  },
];

/** A processor timestamp, never ours. See D-018. */
const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Turns a retrieved payment into the ledger row that describes it.
 *
 * Pure, so the shape of a rebuilt row can be tested without a processor. The
 * internal id is supplied rather than generated here for the same reason.
 */
export function rebuiltPayment(
  id: string,
  statementId: string,
  live: HyperswitchPayment,
): Payment {
  const card = live.payment_method_data?.card ?? null;

  return {
    id,
    statementId,
    hyperswitchPaymentId: live.payment_id,
    amount: cents(live.amount),
    currency: "USD",
    status: live.status,
    // The same classifier the webhook path uses. A second implementation of
    // "which kind of card is this" is how the two disagree later.
    tender: classifyTender({
      paymentMethod: live.payment_method ?? null,
      cardIsin: card?.card_isin ?? null,
      last4: card?.last4 ?? null,
      cardNetwork: card?.card_network ?? null,
    }),
    failureReason: null,
    createdAt: (live.created ?? EPOCH) as Timestamp,
    /**
     * The processor's clock. A webhook arriving later for this payment is
     * ordered against this field, and stamping it with our own wall clock is
     * what made every genuine webhook read as stale in D-018.
     */
    updatedAt: (live.updated ?? live.created ?? EPOCH) as Timestamp,
  };
}

export function rebuiltRefund(
  id: string,
  paymentId: string,
  live: HyperswitchRefund,
): Refund {
  return {
    id,
    // Binds to our internal payment row, which is what `deriveBalance` folds on.
    paymentId,
    hyperswitchRefundId: live.refund_id,
    amount: cents(live.amount),
    reason: "readjudication",
    status: live.status as Refund["status"],
    createdAt: (live.created_at ?? EPOCH) as Timestamp,
    updatedAt: (live.updated_at ?? live.created_at ?? EPOCH) as Timestamp,
  };
}

/**
 * Whether the processor's record still supports the story the baseline claims.
 *
 * A reset that restores a payment the processor no longer calls succeeded would
 * be writing fiction, which is the one thing this design is trying to avoid by
 * rebuilding from the source at all.
 */
export function rebuildIsSound(
  payment: HyperswitchPayment,
  refund: HyperswitchRefund,
): boolean {
  return (
    payment.status === "succeeded" &&
    refund.status === "succeeded" &&
    refund.payment_id === payment.payment_id &&
    refund.amount > 0 &&
    refund.amount < payment.amount
  );
}
