import { describe, expect, it } from "vitest";

import { DISTINCT_CARD_THRESHOLD, summariseRisk } from "./risk";
import { STATEMENTS } from "./fixtures";
import { cents } from "./types";
import type { Payment, PaymentStatus } from "./types";

/**
 * The signal that separates card testing from a patient having a bad day is the
 * number of distinct cards, not the number of failures. These tests are mostly
 * about not confusing the two.
 */

const stmt = STATEMENTS.find((s) => s.ref === "AFT-4021-8837")!;

function attempt(
  hsId: string,
  status: PaymentStatus,
  last4: string | null,
  updatedAt = "2026-09-01T10:00:00.000Z",
  failureReason: string | null = null,
): Payment {
  return {
    id: `${hsId}_${status}_${updatedAt}`,
    statementId: stmt.id,
    hyperswitchPaymentId: hsId,
    amount: cents(3270),
    currency: "USD",
    status,
    tender: last4 === null ? null : { class: "standard_card", last4, brand: "Visa" },
    failureReason,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("summariseRisk", () => {
  it("does not count an unconfirmed intent as a successful payment", () => {
    /**
     * `succeeded` was derived as `attempts - failures`, so every abandoned
     * intent read as collected money on an operator risk screen. D-027 records
     * that such rows sit in the log indefinitely.
     */
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "requires_payment_method", null, "1970-01-01T00:00:00.000Z"),
    ]);

    expect(summary.attempts).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.failures).toBe(0);
    expect(summary.unresolved).toBe(1);
  });

  it("counts one attempt per processor payment, not per log row", () => {
    /**
     * The log holds an intent row and a webhook row for the same payment.
     * Counting rows would report every ordinary payment as two attempts and
     * make the failure rate meaningless.
     */
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "requires_payment_method", null, "1970-01-01T00:00:00.000Z"),
      attempt("pay_1", "succeeded", "4242", "2026-09-01T10:05:00.000Z"),
    ]);

    expect(summary.attempts).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failures).toBe(0);
  });

  it("does not flag a patient retrying with the same card", () => {
    // Three failures, one card. That is somebody whose bank keeps saying no.
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "failed", "4242", "2026-09-01T10:00:00.000Z"),
      attempt("pay_2", "failed", "4242", "2026-09-01T10:01:00.000Z"),
      attempt("pay_3", "failed", "4242", "2026-09-01T10:02:00.000Z"),
    ]);

    expect(summary.failures).toBe(3);
    expect(summary.perStatement[0]!.distinctCards).toBe(1);
    expect(summary.flagged).toHaveLength(0);
  });

  it("flags many distinct cards against one statement", () => {
    // Same failure count, different meaning entirely.
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "failed", "4242", "2026-09-01T10:00:00.000Z"),
      attempt("pay_2", "failed", "1881", "2026-09-01T10:01:00.000Z"),
      attempt("pay_3", "failed", "0002", "2026-09-01T10:02:00.000Z"),
    ]);

    expect(summary.perStatement[0]!.distinctCards).toBe(DISTINCT_CARD_THRESHOLD);
    expect(summary.flagged).toHaveLength(1);
    expect(summary.flagged[0]!.ref).toBe(stmt.ref);
  });

  it("reports the decline mix by category", () => {
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "failed", "4242", "2026-09-01T10:00:00.000Z", "insufficient_funds"),
      attempt("pay_2", "failed", "1881", "2026-09-01T10:01:00.000Z", "insufficient_funds"),
      attempt("pay_3", "failed", "0002", "2026-09-01T10:02:00.000Z", "card_blocked"),
    ]);

    expect(summary.declineMix[0]).toStrictEqual({ category: "insufficient_funds", count: 2 });
    expect(summary.declineMix[1]).toStrictEqual({ category: "card_blocked", count: 1 });
  });

  it("ignores a failureReason that is not a known category", () => {
    // A row written before the categories existed, or by something else.
    const summary = summariseRisk(STATEMENTS, [
      attempt("pay_1", "failed", "4242", "2026-09-01T10:00:00.000Z", "Your card was declined."),
    ]);

    expect(summary.failures).toBe(1);
    expect(summary.declineMix).toHaveLength(0);
  });

  it("returns an empty summary when nothing has happened", () => {
    const summary = summariseRisk(STATEMENTS, []);

    expect(summary).toMatchObject({ attempts: 0, failures: 0, succeeded: 0, failureRate: 0 });
    expect(summary.perStatement).toHaveLength(0);
    expect(summary.flagged).toHaveLength(0);
  });

  it("omits statements nobody has tried to pay", () => {
    const summary = summariseRisk(STATEMENTS, [attempt("pay_1", "succeeded", "4242")]);
    expect(summary.perStatement).toHaveLength(1);
  });
});
