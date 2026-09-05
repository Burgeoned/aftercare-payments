"use client";

import { useEffect, useState } from "react";
import { loadHyper } from "@juspay-tech/hyper-js";
import {
  HyperElements,
  UnifiedCheckout,
  useHyper,
  useWidgets,
} from "@juspay-tech/react-hyper-js";

import { publishableKey } from "@/lib/env";

/**
 * Unified Checkout, mounted against a statement.
 *
 * The browser confirms the payment directly with Hyperswitch. Card details are
 * collected inside a Hyperswitch-hosted iframe and never reach our server,
 * which is what keeps PCI scope at SAQ A. See docs/DESIGN.md section 3.
 *
 * The intent request names a portion, never an amount. The server reads the
 * statement from the access cookie and computes what that portion is worth, so
 * there is no number here for a client to tamper with. See D-015.
 */

// Created once at module scope. Calling loadHyper on every render remounts the
// iframe and loses whatever the patient has typed.
const hyperPromise = loadHyper(publishableKey);

interface IntentResponse {
  readonly paymentId: string;
  readonly hyperswitchPaymentId: string;
  readonly clientSecret: string;
  readonly amount: number;
  readonly currency: string;
}

function PayButton({ returnUrl }: { returnUrl: string }) {
  const hyper = useHyper();
  const widgets = useWidgets();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPay() {
    if (hyper === null || widgets === null) return;

    setSubmitting(true);
    setError(null);

    const result = await hyper.confirmPayment({
      elements: widgets,
      confirmParams: { return_url: returnUrl },
      // 3DS needs a full redirect. "always" keeps one code path for both the
      // challenged and frictionless cases rather than branching on the result.
      redirect: "always",
    });

    // Reached only when the redirect did not happen, which means confirmation
    // failed before the processor took over.
    setSubmitting(false);
    setError(result.error?.message ?? "Payment could not be confirmed.");
  }

  return (
    <div style={{ marginTop: "1.75rem" }}>
      <button
        onClick={onPay}
        disabled={submitting || hyper === null || widgets === null}
        className="btn"
      >
        {submitting ? "Confirming" : "Pay now"}
      </button>
      {error !== null && (
        <p role="alert" className="note note-warn" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkout({
  portion,
  returnUrl,
}: {
  portion: "full" | "health_account";
  returnUrl: string;
}) {
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/payments/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portion }),
        });
        const body: unknown = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          const message =
            typeof body === "object" && body !== null && "message" in body
              ? String((body as { message: unknown }).message)
              : `Request failed with ${res.status}`;
          setError(message);
          return;
        }

        setIntent(body as IntentResponse);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Network error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [portion]);

  if (error !== null) {
    return (
      <div className="note note-warn">
        <p style={{ margin: 0, fontWeight: 600 }}>This payment could not be started.</p>
        <p style={{ margin: "0.4rem 0 0" }}>{error}</p>
      </div>
    );
  }

  if (intent === null) {
    return <p className="hint">Starting payment</p>;
  }

  return (
    <>
      <HyperElements hyper={hyperPromise} options={{ clientSecret: intent.clientSecret }}>
        <UnifiedCheckout id="unified-checkout" />
        <PayButton returnUrl={returnUrl} />
      </HyperElements>
      <p className="hint" style={{ marginTop: "1.5rem" }}>
        {/*
          The amount the server actually created the intent for, not the one the
          page computed to display. The two are derived independently, and if
          they ever disagree the patient sees the figure they will really be
          charged before they confirm rather than after.
        */}
        Charging{" "}
        <span className="num">
          {(intent.amount / 100).toLocaleString("en-US", {
            style: "currency",
            currency: intent.currency,
          })}
        </span>{" "}
        &middot; reference <span className="num">{intent.hyperswitchPaymentId}</span>
      </p>
    </>
  );
}
