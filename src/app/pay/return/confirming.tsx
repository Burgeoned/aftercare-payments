"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
  /** Null when the redirect named no payment. */
  readonly thisPaymentSettled: boolean | null;
}

/**
 * What the page says at the top, for each phase.
 *
 * The heading used to be fixed in the server page: "You are back. Now we wait
 * for the ledger." That is right while waiting and wrong the moment the ledger
 * answers, so a declined payment showed a page still announcing a wait above a
 * panel that had already said the card was refused. The heading is the largest
 * text on the screen and it was the least accurate.
 *
 * The phase lives here, so the heading does too.
 */
const HEADINGS: Record<Phase, { eyebrow: string; lead: string; tail: string }> = {
  waiting: {
    eyebrow: "Confirming",
    lead: "You are back.",
    tail: "Now we wait for the ledger.",
  },
  settled: {
    eyebrow: "Confirmed",
    lead: "That went through.",
    tail: "Taking you to your receipt.",
  },
  declined: {
    eyebrow: "Declined",
    lead: "That did not go through.",
    tail: "Nothing has been charged.",
  },
  timed_out: {
    // Deliberately not "failed". The processor has not said no, it has not
    // said anything, and telling a patient their payment failed when it may
    // yet settle is how one bill gets paid twice.
    eyebrow: "Still confirming",
    lead: "Still with your bank.",
    tail: "There is nothing more to do here.",
  },
  no_access: {
    eyebrow: "Session expired",
    lead: "Your session expired.",
    tail: "The payment is not affected.",
  },
};

export function Confirming({
  redirectStatus,
  paymentId,
}: {
  redirectStatus: string;
  paymentId: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [elapsed, setElapsed] = useState(0);
  const [decline, setDecline] = useState<{ category: DeclineCategory; ref: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let reconciled = false;

    async function poll() {
      if (cancelled) return;

      try {
        const res = await fetch(
          paymentId === null
            ? "/api/statements/status"
            : `/api/statements/status?payment_id=${encodeURIComponent(paymentId)}`,
          { cache: "no-store" },
        );

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

          /**
           * This payment, when the redirect named one. Falling back to "the
           * statement has collected something" is only correct for a first
           * payment; on a split tender second leg it is already true.
           */
          const settled =
            body.thisPaymentSettled === null ? body.amountPaid > 0 : body.thisPaymentSettled;

          if (settled) {
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
        /**
         * Before giving up, ask the processor directly. The poll above watches
         * a ledger that only a webhook can move, so waiting longer cannot
         * resolve an undelivered webhook. This can. See D-033.
         */
        if (!reconciled) {
          reconciled = true;
          try {
            const repair = await fetch("/api/statements/reconcile", { method: "POST" });
            if (repair.ok) {
              const outcome = (await repair.json()) as { applied: unknown[] };
              if (outcome.applied.length > 0) {
                attempt = Math.max(attempt - 2, 0);
                setTimeout(() => void poll(), 500);
                return;
              }
            }
          } catch {
            // The repair is best effort. Falling through to the honest message
            // is better than showing a network error for a payment that may
            // well have succeeded.
          }
        }

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
  }, [router, paymentId]);

  const { eyebrow, lead, tail } = HEADINGS[phase];

  function frame(children: ReactNode) {
    return (
      <>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="hero-title mixed" style={{ margin: "1rem 0 2rem" }} aria-live="polite">
          {lead}
          <em>{tail}</em>
        </h1>
        <div className="panel">{children}</div>
      </>
    );
  }

  if (phase === "settled") {
    return frame(<p className="muted">Confirmed. Taking you to your receipt.</p>);
  }

  if (phase === "declined" && decline !== null) {
    const { headline, guidance } = guidanceFor(decline.category);

    return frame(
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
      </>,
    );
  }

  if (phase === "no_access") {
    return frame(
      <p className="note" style={{ margin: 0 }}>
        Your session has expired, which does not affect the payment. Look your statement
        up again to see its current balance.
      </p>,
    );
  }

  if (phase === "timed_out") {
    return frame(
      <p className="note" style={{ margin: 0 }}>
        Your payment is still confirming with the bank. We asked the processor directly
        and it has not finished either, so this is a wait rather than a failure. The
        balance updates as soon as it settles, and the receipt appears on your statement
        then. It is safe to close this page, and you should not pay again.
      </p>,
    );
  }

  return frame(
    <p className="muted" aria-live="polite" style={{ margin: 0 }}>
      {redirectStatus === "failed"
        ? "Checking what the processor recorded."
        : "Waiting for the processor to confirm."}
      <span className="hint"> {Math.round(elapsed / 1000)}s</span>
    </p>,
  );
}
