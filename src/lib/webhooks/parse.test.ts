import { describe, expect, it } from "vitest";

import { isFailure, parseWebhook } from "./parse";

/**
 * Field names here are taken from the Hyperswitch source, not inferred, so
 * these fixtures double as the record of what the payload is understood to be.
 * If a real webhook ever disagrees with them, this file is where the
 * disagreement should be corrected.
 */

function paymentPayload(over: Record<string, unknown> = {}): unknown {
  return {
    merchant_id: "merchant_123",
    event_id: "evt_abc",
    event_type: "payment_succeeded",
    timestamp: "2026-09-04T12:00:05.000Z",
    content: {
      type: "payment_details",
      object: {
        payment_id: "pay_XYZ",
        status: "succeeded",
        amount: 92700,
        currency: "USD",
        updated: "2026-09-04T12:00:00.000Z",
        payment_method_data: {
          card: { last4: "4242", card_network: "Visa", card_isin: "424242" },
        },
        ...over,
      },
    },
  };
}

describe("parseWebhook, payments", () => {
  it("reads the envelope and the payment resource", () => {
    const event = parseWebhook(paymentPayload());

    expect(isFailure(event)).toBe(false);
    if (isFailure(event) || event.kind !== "payment") throw new Error("expected a payment");

    expect(event.eventId).toBe("evt_abc");
    expect(event.eventType).toBe("payment_succeeded");
    expect(event.hyperswitchPaymentId).toBe("pay_XYZ");
    expect(event.status).toBe("succeeded");
    expect(event.amount).toBe(92700);
    expect(event.updatedAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("prefers the resource timestamp over the envelope timestamp", () => {
    // The envelope records when the webhook was sent; the resource records when
    // it changed. Ordering cares about the second.
    const event = parseWebhook(paymentPayload());
    if (isFailure(event) || event.kind !== "payment") throw new Error("expected a payment");

    expect(event.updatedAt).not.toBe("2026-09-04T12:00:05.000Z");
  });

  it("falls back to the envelope timestamp when the resource carries none", () => {
    const payload = paymentPayload();
    delete (payload as never as Record<string, never>)["x"];
    const body = JSON.parse(JSON.stringify(payload)) as {
      content: { object: Record<string, unknown> };
    };
    delete body.content.object["updated"];

    const event = parseWebhook(body);
    if (isFailure(event) || event.kind !== "payment") throw new Error("expected a payment");

    expect(event.updatedAt).toBe("2026-09-04T12:00:05.000Z");
  });

  it("carries the card BIN through, because step 6 classifies on it", () => {
    const event = parseWebhook(paymentPayload());
    if (isFailure(event) || event.kind !== "payment") throw new Error("expected a payment");

    expect(event.cardIsin).toBe("424242");
    expect(event.last4).toBe("4242");
    expect(event.cardNetwork).toBe("Visa");
  });

  it("accepts a payment with no card data, which is what bank debit looks like", () => {
    const body = JSON.parse(JSON.stringify(paymentPayload())) as {
      content: { object: Record<string, unknown> };
    };
    delete body.content.object["payment_method_data"];

    const event = parseWebhook(body);
    if (isFailure(event) || event.kind !== "payment") throw new Error("expected a payment");

    expect(event.last4).toBeNull();
    expect(event.cardIsin).toBeNull();
  });

  it("rejects an unrecognised status rather than passing it through", () => {
    const result = parseWebhook(paymentPayload({ status: "partially_captured_and_capturable" }));

    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.reason).toContain("unrecognised payment status");
  });

  it("rejects a non-integer amount", () => {
    // A float here would become a wrong charge recorded against a statement.
    expect(isFailure(parseWebhook(paymentPayload({ amount: 927.5 })))).toBe(true);
    expect(isFailure(parseWebhook(paymentPayload({ amount: "92700" })))).toBe(true);
  });
});

describe("parseWebhook, refunds", () => {
  function refundPayload(over: Record<string, unknown> = {}): unknown {
    return {
      event_id: "evt_ref",
      event_type: "refund_succeeded",
      timestamp: "2026-09-04T13:00:00.000Z",
      content: {
        type: "refund_details",
        object: {
          refund_id: "ref_1",
          payment_id: "pay_XYZ",
          status: "succeeded",
          amount: 5000,
          // Refunds name this differently from payments. That inconsistency is
          // in the API, not in this parser.
          updated_at: "2026-09-04T12:59:00.000Z",
          ...over,
        },
      },
    };
  }

  it("reads updated_at, which is where refunds keep their timestamp", () => {
    const event = parseWebhook(refundPayload());
    if (isFailure(event) || event.kind !== "refund") throw new Error("expected a refund");

    expect(event.hyperswitchRefundId).toBe("ref_1");
    expect(event.hyperswitchPaymentId).toBe("pay_XYZ");
    expect(event.updatedAt).toBe("2026-09-04T12:59:00.000Z");
    expect(event.amount).toBe(5000);
  });

  it("accepts the v2 id field as well as the v1 refund_id", () => {
    const body = JSON.parse(JSON.stringify(refundPayload())) as {
      content: { object: Record<string, unknown> };
    };
    delete body.content.object["refund_id"];
    body.content.object["id"] = "ref_v2";

    const event = parseWebhook(body);
    if (isFailure(event) || event.kind !== "refund") throw new Error("expected a refund");
    expect(event.hyperswitchRefundId).toBe("ref_v2");
  });
});

describe("parseWebhook, everything else", () => {
  it("marks disputes and mandates as unhandled rather than failing", () => {
    const event = parseWebhook({
      event_id: "evt_d",
      event_type: "dispute_opened",
      timestamp: "2026-09-04T12:00:00.000Z",
      content: { type: "dispute_details", object: { dispute_id: "dp_1" } },
    });

    if (isFailure(event)) throw new Error("expected an unhandled event, not a failure");
    expect(event.kind).toBe("unhandled");
  });

  it("names the missing field rather than defaulting it", () => {
    for (const [body, expected] of [
      [null, "not a JSON object"],
      [{ event_type: "x", content: {} }, "missing event_id"],
      [{ event_id: "e", content: {} }, "missing event_type"],
      [{ event_id: "e", event_type: "x" }, "missing content"],
      [{ event_id: "e", event_type: "x", content: { object: {} } }, "missing content.type"],
    ] as const) {
      const result = parseWebhook(body);
      expect(isFailure(result)).toBe(true);
      if (!isFailure(result)) continue;
      expect(result.reason).toContain(expected);
    }
  });
});
