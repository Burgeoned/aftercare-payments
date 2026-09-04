import "server-only";

import { Redis } from "@upstash/redis";

import { storeEnv } from "@/lib/env";
import { PATIENTS, STATEMENTS } from "./fixtures";
import type { Patient, Payment, Refund, Statement } from "./types";

/**
 * Statement fixtures and the payment ledger.
 *
 * Statements and patients are static fixture data and are read straight from
 * the module. The payment and refund logs are not, and the reason is recorded
 * in docs/DECISIONS.md D-013: they were held in module scope until a route
 * handler and a page turned out to receive different copies of that module in
 * the same process. Anything mutable now lives in Redis, which is shared across
 * module instances, across serverless instances, and across a redeploy.
 *
 * Redis is used as an append-only log, not as a database. There is no schema
 * and nothing is updated in place. That keeps the argument in docs/DESIGN.md
 * section 12 intact: the complexity worth showing is in the payment state
 * machine, and a statement's status is still derived by folding this log rather
 * than stored and maintained.
 */

let client: Redis | null = null;

function redis(): Redis {
  if (client !== null) return client;

  const env = storeEnv();
  client = new Redis({ url: env.redisUrl, token: env.redisToken });
  return client;
}

/** One list per statement. Reading a balance is then a single round trip. */
function paymentsKey(statementId: string): string {
  return `aftercare:payments:${statementId}`;
}

/**
 * Refunds are keyed by payment rather than by statement, because a refund is
 * bound to the payment it reverses. That binding is what keeps health account
 * funds returning to the account they came from, which is an IRS constraint
 * rather than a payments convention. See docs/DOMAIN.md section 5.
 */
function refundsKey(paymentId: string): string {
  return `aftercare:refunds:${paymentId}`;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function findStatementByRef(ref: string): Statement | null {
  const normalized = ref.trim().toUpperCase();
  return STATEMENTS.find((s) => s.ref.toUpperCase() === normalized) ?? null;
}

export function findStatementById(id: string): Statement | null {
  return STATEMENTS.find((s) => s.id === id) ?? null;
}

export function findPatientById(id: string): Patient | null {
  return PATIENTS.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export async function paymentsForStatement(statementId: string): Promise<readonly Payment[]> {
  return await redis().lrange<Payment>(paymentsKey(statementId), 0, -1);
}

export async function refundsForPayments(
  paymentIds: readonly string[],
): Promise<readonly Refund[]> {
  if (paymentIds.length === 0) return [];

  const lists = await Promise.all(
    paymentIds.map((id) => redis().lrange<Refund>(refundsKey(id), 0, -1)),
  );
  return lists.flat();
}

/**
 * Append only. A status change from a webhook appends a superseding record
 * rather than editing one, which is what keeps this a history instead of a
 * snapshot. See docs/DESIGN.md section 12.
 */
export async function appendPayment(payment: Payment): Promise<void> {
  await redis().rpush(paymentsKey(payment.statementId), payment);
}

export async function appendRefund(refund: Refund): Promise<void> {
  await redis().rpush(refundsKey(refund.paymentId), refund);
}
