"use client";

import { useState } from "react";

/**
 * The provider-side correction form.
 *
 * Takes dollars and converts to cents once, here, before anything is sent. The
 * API takes minor units only, and a person typing into a form is exactly where
 * a unit mistake gets made: 627 meaning six hundred and twenty seven dollars
 * would otherwise refund $6.27. See docs/DECISIONS.md D-015 for the same
 * mistake arriving from a browser.
 */

interface Issued {
  readonly paymentId: string;
  readonly amount: number;
  readonly hyperswitchRefundId: string;
}

interface Result {
  readonly ref: string;
  readonly revisedPatientResponsibility: number;
  readonly refunded: number;
  readonly refunds: readonly Issued[];
  readonly note?: string;
}

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Dollars to cents, without floating point rounding on the way through. */
function toCents(input: string): number | null {
  const trimmed = input.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function ReadjudicateForm({ refs }: { refs: readonly string[] }) {
  const [ref, setRef] = useState(refs[0] ?? "");
  const [revised, setRevised] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = toCents(revised);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setError(null);

    if (parsed === null) {
      setError("Enter the revised patient responsibility in dollars, for example 627.00");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/provider/readjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, revisedPatientResponsibility: parsed, reason }),
      });
      const body = (await res.json()) as Result & { error?: string; message?: string };

      if (!res.ok) {
        setError(body.message ?? body.error ?? `Request failed with ${res.status}`);
        return;
      }
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} style={{ marginTop: "2rem" }}>
        <div className="field">
          <label htmlFor="ref">Statement</label>
          <select
            id="ref"
            className="input"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          >
            {refs.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="revised">Revised patient responsibility</label>
          <input
            id="revised"
            className="input num"
            inputMode="decimal"
            placeholder="627.00"
            value={revised}
            onChange={(e) => setRevised(e.target.value)}
          />
          <p className="hint" style={{ marginTop: "var(--gap-label)" }}>
            In dollars. What the payer now says the patient owes, after reprocessing.
            {parsed !== null && <> Sends {parsed} cents.</>}
          </p>
        </div>

        <div className="field">
          <label htmlFor="reason">Reason</label>
          <input
            id="reason"
            className="input"
            placeholder="Payer reprocessed the claim"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error !== null && (
          <p role="alert" className="note note-warn" style={{ marginBottom: "var(--gap-field)" }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Reprocessing" : "Apply correction"}
        </button>
      </form>

      {result !== null && (
        <div className="panel" style={{ marginTop: "2rem" }}>
          <p className="eyebrow" style={{ marginBottom: "1rem" }}>
            Applied
          </p>
          <div className="ledger">
            <div className="ledger-row">
              <span className="muted">Revised responsibility</span>
              <span>{usd(result.revisedPatientResponsibility)}</span>
            </div>
            <div className="ledger-row">
              <span className="muted">Refunded</span>
              <span className="refund-mark">{usd(result.refunded)}</span>
            </div>
          </div>

          {result.refunds.length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <p className="hint" style={{ margin: "0 0 0.5rem" }}>
                Drawn from, personal tenders first:
              </p>
              {result.refunds.map((r) => (
                <p key={r.hyperswitchRefundId} className="hint" style={{ margin: "0.2rem 0" }}>
                  <span className="num">{usd(r.amount)}</span> to{" "}
                  <span className="num">{r.paymentId}</span> &middot;{" "}
                  <span className="num">{r.hyperswitchRefundId}</span>
                </p>
              ))}
            </div>
          )}

          {result.note !== undefined && (
            <p className="note" style={{ marginTop: "1.25rem" }}>
              {result.note}
            </p>
          )}

          <p className="note" style={{ marginTop: "1.25rem" }}>
            Refunds are recorded as pending. The balance moves when a verified
            `refund_succeeded` webhook arrives, exactly like a payment.
          </p>
        </div>
      )}
    </>
  );
}
