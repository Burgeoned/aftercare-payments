import { describe, expect, it } from "vitest";

import { needsReconciliation, reconciledRow } from "./reconcile";
import { cents } from "./types";
import type { Payment, PaymentStatus } from "./types";
import type { HyperswitchPayment } from "@/lib/hyperswitch/client";

/**
 * The repair path for a webhook that never arrived. The tests that matter are
 * the ones proving a reconciled row cannot contradict a webhook: both ask the
 * processor the same question, and the fold decides between them on the
 * processor's own clock.
 */

function known(status: PaymentStatus, updatedAt = "2026-09-05T10:00:00.000Z"): Payment {
  return {
    id: "row_a",
    statementId: "stmt_4021",
    hyperswitchPaymentId: "pay_X",
    amount: cents(3270),
    currency: "USD",
    status,
    tender: { class: "standard_card", last4: "4242", brand: "Visa" },
    failureReason: null,
    createdAt: "2026-09-05T09:00:00.000Z",
    updatedAt,
  };
}

function live(status: string, updated?: string): HyperswitchPayment {
  // `exactOptionalPropertyTypes` is on, so an absent field is absent rather
  // than present-and-undefined.
  return {
    payment_id: "pay_X",
    status: status as HyperswitchPayment["status"],
    client_secret: null,
    amount: 3270,
    currency: "USD",
    ...(updated === undefined ? {} : { updated }),
  };
}

const OBSERVED = "2026-09-05T12:00:00.000Z";

describe("needsReconciliation", () => {
  it("asks about payments the ledger has not resolved", () => {
    const rows = [known("requires_customer_action"), { ...known("succeeded"), id: "row_b" }];
    // Same processor id, so the fold keeps the newest; both share a timestamp
    // here, so assert on the shape rather than which survived.
    expect(needsReconciliation([rows[0]!])).toHaveLength(1);
  });

  it("does not ask about a payment that already settled", () => {
    expect(needsReconciliation([known("succeeded")])).toHaveLength(0);
    expect(needsReconciliation([known("failed")])).toHaveLength(0);
  });

  it("counts one processor payment once, however many rows describe it", () => {
    const intentRow = known("requires_payment_method", "1970-01-01T00:00:00.000Z");
    const laterRow = { ...known("processing", "2026-09-05T10:05:00.000Z"), id: "row_b" };
    expect(needsReconciliation([intentRow, laterRow])).toHaveLength(1);
  });
});

describe("reconciledRow", () => {
  it("records a settlement the webhook never delivered", () => {
    const row = reconciledRow(
      known("processing"),
      live("succeeded", "2026-09-05T11:00:00.000Z"),
      OBSERVED,
    );

    expect(row).not.toBeNull();
    expect(row!.status).toBe("succeeded");
    expect(row!.updatedAt).toBe("2026-09-05T11:00:00.000Z");
  });

  it("carries the processor's clock, not ours", () => {
    /**
     * The whole point. A reconciled row is compared against webhook rows on
     * this field, and stamping it with our clock is the D-018 defect: it would
     * beat a genuine later webhook and freeze a stale status in place.
     */
    const row = reconciledRow(
      known("processing"),
      live("succeeded", "2026-09-05T11:00:00.000Z"),
      OBSERVED,
    );
    expect(row!.updatedAt).not.toBe(OBSERVED);
  });

  it("writes nothing when the processor agrees with the ledger", () => {
    expect(reconciledRow(known("succeeded"), live("succeeded"), OBSERVED)).toBeNull();
  });

  it("writes nothing while the processor is still working", () => {
    // Reconciliation reports, it does not guess. A payment still at the issuer
    // has no outcome to record.
    expect(reconciledRow(known("processing"), live("requires_customer_action"), OBSERVED)).toBeNull();
    expect(reconciledRow(known("processing"), live("processing"), OBSERVED)).toBeNull();
  });

  it("writes nothing when its timestamp would lose the fold anyway", () => {
    // A row that cannot win is noise in a log somebody has to read.
    const row = reconciledRow(
      known("processing", "2026-09-05T13:00:00.000Z"),
      live("succeeded", "2026-09-05T11:00:00.000Z"),
      OBSERVED,
    );
    expect(row).toBeNull();
  });

  it("keeps the tender the webhook reported", () => {
    // The processor's payment object does not carry it, and blanking it would
    // lose the health account classification a refund depends on.
    const row = reconciledRow(known("processing"), live("succeeded", "2026-09-05T11:00:00.000Z"), OBSERVED);
    expect(row!.tender).toStrictEqual({ class: "standard_card", last4: "4242", brand: "Visa" });
  });

  it("records a failure as a failure", () => {
    const row = reconciledRow(known("processing"), live("failed", "2026-09-05T11:00:00.000Z"), OBSERVED);
    expect(row!.status).toBe("failed");
  });
});
