"use client";

import { useState } from "react";

/**
 * Returning the demo to a known state.
 *
 * Two-step on purpose. The action deletes a payment ledger, and while these are
 * fixture statements against a sandbox account, a control that erases billing
 * history should never be one click away from a mis-tap. The confirm step is
 * the whole safety mechanism, so it says what will happen rather than asking
 * whether you are sure.
 */

interface ResetResult {
  readonly cleared: {
    readonly statements: number;
    readonly payments: number;
    readonly refunds: number;
    readonly indexes: number;
    readonly readjudications: number;
  };
  readonly rebuilt: readonly string[];
  readonly skipped: readonly string[];
}

export function ResetForm() {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/provider/reset", { method: "POST" });
      const body: unknown = await res.json();

      if (!res.ok) {
        setError(
          res.status === 401
            ? "That session is no longer signed in. Sign in again and retry."
            : "The reset did not complete.",
        );
        return;
      }

      setResult(body as ResetResult);
      setConfirming(false);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  if (result !== null) {
    return (
      <div className="panel" style={{ marginTop: "2.5rem" }}>
        <p className="eyebrow" style={{ marginBottom: "1rem" }}>
          Fixtures reset
        </p>

        <div className="ledger">
          <div className="ledger-row">
            <span className="muted">Payments cleared</span>
            <span className="num">{result.cleared.payments}</span>
          </div>
          <div className="ledger-row">
            <span className="muted">Refunds cleared</span>
            <span className="num">{result.cleared.refunds}</span>
          </div>
          <div className="ledger-row">
            <span className="muted">Corrections cleared</span>
            <span className="num">{result.cleared.readjudications}</span>
          </div>
          <div className="ledger-row">
            <span className="muted">Webhook routes cleared</span>
            <span className="num">{result.cleared.indexes}</span>
          </div>
          <div className="ledger-row ledger-total">
            <span>Rebuilt from the processor</span>
            <span className="num">{result.rebuilt.length}</span>
          </div>
        </div>

        {result.skipped.length > 0 && (
          <div className="note note-warn" style={{ marginTop: "1.25rem" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Not everything was rebuilt.</p>
            {result.skipped.map((reason) => (
              <p key={reason} style={{ margin: "0.4rem 0 0" }}>
                {reason}
              </p>
            ))}
          </div>
        )}

        <p className="hint" style={{ marginTop: "1.25rem" }}>
          Nothing at the processor was touched. The payments and the refund still exist in
          the Hyperswitch account, which is where the rebuilt statement was read from.
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: "2.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "1rem" }}>
        Reset the demo
      </p>

      <p className="muted" style={{ margin: 0, fontSize: "var(--fs-small)" }}>
        The fixtures are shared and the ledger only grows, so paying a statement spends it
        for everyone who looks afterwards and every declined attempt stays in its history.
        This returns all three to a known state.
      </p>

      {!confirming ? (
        <div style={{ maxWidth: "20rem", marginTop: "1.75rem" }}>
          <button onClick={() => setConfirming(true)} className="btn btn-quiet">
            Reset the fixtures
          </button>
        </div>
      ) : (
        <>
          <div className="note note-warn" style={{ marginTop: "1.5rem" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>This deletes the payment ledger.</p>
            <p style={{ margin: "0.4rem 0 0" }}>
              All three statements return to unpaid, then AFT-4021-8837 is rebuilt to paid
              and partially refunded by retrieving the real payment and refund from
              Hyperswitch. Nothing at the processor changes, and the risk console&rsquo;s
              signals are left alone.
            </p>
          </div>

          <div style={{ maxWidth: "20rem", marginTop: "1.5rem", display: "grid", gap: "0.7rem" }}>
            <button onClick={run} disabled={running} className="btn">
              {running ? "Resetting" : "Yes, reset the fixtures"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={running}
              className="btn btn-quiet"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {error !== null && (
        <p role="alert" className="note note-warn" style={{ marginTop: "1.25rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
