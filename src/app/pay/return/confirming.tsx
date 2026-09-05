"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { guidanceFor, isDeclineCategory, type DeclineCategory } from "@/lib/domain/decline";

/**
 * Waits for the ledger to catch up with the redirect.
 *
 * The redirect says the browser came back. It says nothing about money. So this
 * polls the derived statement status until a verified webhook has moved it, and
 * only then sends the patient to a receipt.
 *
 * Bounded, per docs/DESIGN.md section 14. A webhook that has not arrived in
 * half a minute is not necessarily lost, and the honest thing to tell a patient
 * at that point is that it is still confirming, not that it failed and not that
 * it worked.
 */

const SCHEDULE_MS = [1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000];

type Phase = "waiting" | "settled" | "declined" | "timed_out" | "no_access";

interface StatusResponse {
  readonly ref: string;
  readonly status: string;
  readonly remaining: number;
  readonly amountPaid: number;
  readonly lastAttemptStatus: string | null;
  readonly declineCategory: string | null;
}

export function Confirming({ redirectStatus }: { redirectStatus: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [elapsed, setElapsed] = useState(0);
  const [decline, setDecline] = useState<{ category: DeclineCategory; ref: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    async function poll() {
      if (cancelled) return;

      try {
        const res = await fetch("/api/statements/status", { cache: "no-store" });

        if (res.status === 401) {
          if (!cancelled) setPhase("no_access");
          return;
        }

        if (res.ok) {
          const body = (await res.json()) as StatusResponse;

          /**
           * A decline is as final as a success for this page's purpose: the
           * ledger has spoken, so there is nothing left to wait for. Waiting
           * out the full schedule before saying so would leave a patient
           * watching a spinner after their card had already been refused.
           */
          if (body.lastAttemptStatus === "failed") {
            if (!cancelled) {
              setDecline({
                category: isDeclineCategory(body.declineCategory)
                  ? body.declineCategory
                  : "unknown",
                ref: body.ref,
              });
              setPhase("declined");
            }
            return;
          }

          // Any collected money means a webhook landed and the ledger moved.
          if (body.amountPaid > 0) {
            if (!cancelled) {
              setPhase("settled");
              router.replace(`/statement/${encodeURIComponent(body.ref)}/receipt`);
            }
            return;
          }
        }
      } catch {
        // A failed poll is not a failed payment. Keep waiting.
      }

      if (attempt >= SCHEDULE_MS.length) {
        if (!cancelled) setPhase("timed_out");
        return;
      }

      const delay = SCHEDULE_MS[attempt] ?? 8000;
      attempt += 1;
      setElapsed((e) => e + delay);
      setTimeout(() => void poll(), delay);
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === "settled") {
    return <p className="muted">Confirmed. Taking you to your receipt.</p>;
  }

  if (phase === "declined" && decline !== null) {
    const { headline, guidance } = guidanceFor(decline.category);

    return (
      <>
        <p className="note note-warn" style={{ margin: 0 }}>
          <span style={{ fontWeight: 600 }}>{headline}</span>
          <br />
          {guidance}
        </p>
        <div style={{ maxWidth: "20rem", marginTop: "1.75rem" }}>
          <Link href={`/statement/${encodeURIComponent(decline.ref)}/pay`} className="btn">
            Try another method
          </Link>
        </div>
      </>
    );
  }

  if (phase === "no_access") {
    return (
      <p className="note">
        Your session has expired, which does not affect the payment. Look your statement
        up again to see its current balance.
      </p>
    );
  }

  if (phase === "timed_out") {
    return (
      <p className="note">
        Your payment is still confirming with the bank. This is normal and does not mean
        it failed. The balance updates as soon as the processor confirms it, and a receipt
        will be available on your statement then. It is safe to close this page, and you
        should not pay again.
      </p>
    );
  }

  return (
    <p className="muted" aria-live="polite">
      {redirectStatus === "failed"
        ? "Checking what the processor recorded."
        : "Waiting for the processor to confirm."}
      <span className="hint"> {Math.round(elapsed / 1000)}s</span>
    </p>
  );
}
