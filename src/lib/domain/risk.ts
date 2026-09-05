import { isDeclineCategory, type DeclineCategory } from "./decline";
import type { Payment, Statement } from "./types";

/**
 * Risk signals derived from the payment log.
 *
 * Pure. It reads the same append-only records the balance reads and counts
 * things, so the risk view and the money view cannot disagree about what
 * happened.
 *
 * WHAT THIS APPLICATION IS EXPOSED TO, specifically. A public checkout
 * reachable by a statement reference is a card testing target. An attacker with
 * a list of stolen card numbers needs somewhere cheap to discover which ones
 * still work, and a page that accepts any card without an account is exactly
 * that. The reference is printed on a piece of paper, so it is not a secret and
 * cannot be treated as one.
 *
 * The signal that separates card testing from a patient having a bad day is not
 * the number of failures. It is the number of *distinct cards*. A patient
 * retries with one card, then maybe a second. Nobody legitimately tries eleven.
 */

export interface StatementRisk {
  readonly ref: string;
  readonly attempts: number;
  readonly failures: number;
  readonly succeeded: number;
  /** Distinct card last-fours seen. The card testing signal. */
  readonly distinctCards: number;
  readonly lastAttemptAt: string | null;
}

export interface RiskSummary {
  readonly attempts: number;
  readonly failures: number;
  readonly succeeded: number;
  /** Neither succeeded nor failed: created and never confirmed. */
  readonly unresolved: number;
  readonly failureRate: number;
  readonly declineMix: readonly { category: DeclineCategory; count: number }[];
  readonly perStatement: readonly StatementRisk[];
  /** Statements whose distinct card count is past the threshold below. */
  readonly flagged: readonly StatementRisk[];
}

/**
 * Distinct cards on one statement before it is worth looking at.
 *
 * Three is deliberately low for a prototype with three fixtures. A real
 * threshold is tuned against observed traffic, and picking one from intuition
 * and calling it tuned would be worse than saying it is arbitrary.
 */
export const DISTINCT_CARD_THRESHOLD = 3;

export function summariseRisk(
  statements: readonly Statement[],
  payments: readonly Payment[],
): RiskSummary {
  const byStatement = new Map<string, Payment[]>();
  for (const payment of payments) {
    const bucket = byStatement.get(payment.statementId) ?? [];
    bucket.push(payment);
    byStatement.set(payment.statementId, bucket);
  }

  const perStatement: StatementRisk[] = [];

  for (const statement of statements) {
    const rows = byStatement.get(statement.id) ?? [];
    if (rows.length === 0) continue;

    /**
     * Counted per processor payment, not per row. The log holds an intent row
     * and a webhook row for the same payment, and counting rows would report
     * every ordinary payment as two attempts.
     */
    const byProcessorId = new Map<string, Payment[]>();
    for (const row of rows) {
      const bucket = byProcessorId.get(row.hyperswitchPaymentId) ?? [];
      bucket.push(row);
      byProcessorId.set(row.hyperswitchPaymentId, bucket);
    }

    const latest = [...byProcessorId.values()].map((group) =>
      group.reduce((newest, row) => (row.updatedAt > newest.updatedAt ? row : newest)),
    );

    const cards = new Set(
      latest.map((p) => p.tender?.last4).filter((v): v is string => v !== null && v !== undefined),
    );

    perStatement.push({
      ref: statement.ref,
      attempts: latest.length,
      failures: latest.filter((p) => p.status === "failed").length,
      succeeded: latest.filter((p) => p.status === "succeeded").length,
      distinctCards: cards.size,
      lastAttemptAt:
        latest.length === 0
          ? null
          : latest.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)).updatedAt,
    });
  }

  const attempts = perStatement.reduce((n, s) => n + s.attempts, 0);
  const failures = perStatement.reduce((n, s) => n + s.failures, 0);

  /**
   * Counted, not inferred. `attempts - failures` treated every unconfirmed
   * intent as a success, and D-027 documents that abandoned intents sit in the
   * log indefinitely. An operator risk screen reporting those as collected
   * money is worse than reporting nothing.
   */
  const succeeded = perStatement.reduce((n, s) => n + s.succeeded, 0);

  const counts = new Map<DeclineCategory, number>();
  for (const payment of payments) {
    if (payment.status !== "failed") continue;
    if (!isDeclineCategory(payment.failureReason)) continue;
    counts.set(payment.failureReason, (counts.get(payment.failureReason) ?? 0) + 1);
  }

  return {
    attempts,
    failures,
    succeeded,
    unresolved: attempts - failures - succeeded,
    failureRate: attempts === 0 ? 0 : failures / attempts,
    declineMix: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    perStatement: [...perStatement].sort((a, b) => b.distinctCards - a.distinctCards),
    flagged: perStatement.filter((s) => s.distinctCards >= DISTINCT_CARD_THRESHOLD),
  };
}
