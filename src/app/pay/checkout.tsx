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
 * Unified Checkout mount.
 *
 * The browser confirms the payment directly with Hyperswitch. Card details are
 * collected inside a Hyperswitch-hosted iframe and never reach our server,
 * which is what keeps PCI scope at SAQ A. See docs/DESIGN.md section 3.
 */

// Created once at module scope. Calling loadHyper on every render remounts the
// iframe and loses whatever the patient has typed.
const hyperPromise = loadHyper(publishableKey);

interface IntentResponse {
  readonly clientSecret: string;
  readonly paymentId: string;
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
    <div className="space-y-3">
      <button
        onClick={onPay}
        disabled={submitting || hyper === null || widgets === null}
        className="w-full rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Confirming..." : "Pay"}
      </button>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkout({ returnUrl }: { returnUrl: string }) {
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/payments/intent", { method: "POST" });
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
  }, []);

  if (error !== null) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">Could not start a payment.</p>
        <p className="mt-1 font-mono text-xs break-all">{error}</p>
      </div>
    );
  }

  if (intent === null) {
    return <p className="text-sm text-[var(--muted)]">Starting payment...</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted)]">
        Payment <span className="font-mono">{intent.paymentId}</span> for{" "}
        {(intent.amount / 100).toLocaleString("en-US", {
          style: "currency",
          currency: intent.currency,
        })}
      </p>
      <HyperElements hyper={hyperPromise} options={{ clientSecret: intent.clientSecret }}>
        <UnifiedCheckout id="unified-checkout" />
        <div className="mt-5">
          <PayButton returnUrl={returnUrl} />
        </div>
      </HyperElements>
    </div>
  );
}
