"use client";

import { useEffect, useState } from "react";

/**
 * The risk console.
 *
 * Everything on the left of the screen is derived from this application's own
 * payment log. Everything on the right is read live from Hyperswitch, because a
 * risk screen that reports a control it has not checked is worse than one that
 * reports nothing: it tells an operator they are protected without knowing.
 */

interface StatementRisk {
  readonly ref: string;
  readonly attempts: number;
  readonly failures: number;
  readonly distinctCards: number;
  readonly lastAttemptAt: string | null;
}

interface RiskPayload {
  readonly risk: {
    readonly attempts: number;
    readonly failures: number;
    readonly succeeded: number;
    readonly failureRate: number;
    readonly declineMix: readonly { category: string; count: number }[];
    readonly perStatement: readonly StatementRisk[];
    readonly flagged: readonly StatementRisk[];
  };
  readonly lookupFailures: readonly { day: string; count: number }[];
  readonly blocklist: readonly { kind: string; entries: readonly unknown[] }[] | null;
  readonly blocklistError: string | null;
}

const KINDS = ["card_bin", "extended_card_bin", "fingerprint"] as const;

export function RiskConsole() {
  const [data, setData] = useState<RiskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("card_bin");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Bumped to re-read after a blocklist change. The effect owns the fetch, so
   * state is only set from inside it rather than from a callback the effect
   * also calls, which is the shape the lint rule is asking for and the shape
   * the checkout component already uses.
   */
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/provider/risk", { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        const body = (await res.json()) as RiskPayload;
        if (cancelled) return;
        setData(body);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load risk data");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloads]);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/provider/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json()) as { error?: string; message?: string };
      setMessage(res.ok ? "Applied." : (out.message ?? out.error ?? `Failed with ${res.status}`));
      setReloads((n) => n + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null) {
    return <p className="note note-warn">{error}</p>;
  }

  if (data === null) {
    return <p className="hint">Reading the ledger and the blocklist</p>;
  }

  const { risk, lookupFailures, blocklist, blocklistError } = data;
  const lookupTotal = lookupFailures.reduce((n, d) => n + d.count, 0);

  return (
    <>
      <section style={{ marginTop: "2.5rem" }}>
        <p className="eyebrow">Signals &middot; from this ledger</p>
        <h2 className="section-title" style={{ margin: "0.75rem 0 1.25rem" }}>
          What has been attempted
        </h2>

        <div className="panel">
          <div className="ledger">
            <div className="ledger-row">
              <span className="muted">Payment attempts</span>
              <span>{risk.attempts}</span>
            </div>
            <div className="ledger-row">
              <span className="muted">Succeeded</span>
              <span className="paid-mark">{risk.succeeded}</span>
            </div>
            <div className="ledger-row">
              <span className="muted">Failed</span>
              <span>{risk.failures}</span>
            </div>
            <div className="ledger-row ledger-total">
              <span>Failure rate</span>
              <span>{(risk.failureRate * 100).toFixed(0)}%</span>
            </div>
          </div>

          <p className="hint" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
            Counted per processor payment, not per log row. An ordinary payment writes two
            rows and is one attempt.
          </p>
        </div>
      </section>

      <section style={{ marginTop: "var(--gap-section)" }}>
        <p className="eyebrow">Card testing</p>
        <h2 className="section-title" style={{ margin: "0.75rem 0 0.75rem" }}>
          Distinct cards per statement
        </h2>
        <p className="muted lede" style={{ marginBottom: "1.25rem" }}>
          The number of failures does not separate an attack from a patient having a bad
          day. The number of distinct cards does. A patient retries with one card, then
          maybe a second. Nobody legitimately tries eleven.
        </p>

        {risk.perStatement.length === 0 ? (
          <p className="hint">Nothing has been attempted yet.</p>
        ) : (
          <div className="panel" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: "30rem" }}>
                <thead>
                  <tr>
                    <th>Statement</th>
                    <th className="n">Attempts</th>
                    <th className="n">Failed</th>
                    <th className="n">Distinct cards</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.perStatement.map((s) => (
                    <tr key={s.ref}>
                      <td className="num">
                        {s.ref}
                        {risk.flagged.some((f) => f.ref === s.ref) && (
                          <span className="flag-warn">Review</span>
                        )}
                      </td>
                      <td className="n">{s.attempts}</td>
                      <td className="n">{s.failures}</td>
                      <td className="n">{s.distinctCards}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {risk.declineMix.length > 0 && (
          <div className="panel" style={{ marginTop: "1.25rem" }}>
            <p className="eyebrow" style={{ marginBottom: "1rem" }}>
              Decline mix
            </p>
            <div className="ledger">
              {risk.declineMix.map((d) => (
                <div key={d.category} className="ledger-row">
                  <span className="muted">{d.category.replace(/_/g, " ")}</span>
                  <span>{d.count}</span>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: "1rem", marginBottom: 0 }}>
              A run of `insufficient_funds` across many cards is the card testing shape.
              A run of `incorrect_details` on one card is somebody mistyping.
            </p>
          </div>
        )}
      </section>

      <section style={{ marginTop: "var(--gap-section)" }}>
        <p className="eyebrow">Lookup</p>
        <h2 className="section-title" style={{ margin: "0.75rem 0 0.75rem" }}>
          Failed statement lookups
        </h2>
        <p className="muted lede" style={{ marginBottom: "1.25rem" }}>
          The credential is a reference printed on paper plus a date of birth. Nothing
          currently rate limits it. Counting failures does not slow an attacker down
          either, but it is the difference between a gap somebody can see and one nobody
          can.
        </p>

        <div className="panel">
          <div className="ledger">
            {lookupFailures.map((d) => (
              <div key={d.day} className="ledger-row">
                <span className="muted">{d.day}</span>
                <span>{d.count}</span>
              </div>
            ))}
            <div className="ledger-row ledger-total">
              <span>Last 7 days</span>
              <span>{lookupTotal}</span>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: "var(--gap-section)" }}>
        <p className="eyebrow">Control &middot; live from Hyperswitch</p>
        <h2 className="section-title" style={{ margin: "0.75rem 0 0.75rem" }}>
          Blocklist
        </h2>
        <p className="muted lede" style={{ marginBottom: "1.25rem" }}>
          The only control here that actually refuses a card. Configured by API rather
          than in the dashboard, and there is no separate card-testing guard: this toggle
          is it. A blocked payment fails with <span className="num">HE_03</span>.
        </p>

        {blocklistError !== null ? (
          <p className="note note-warn">
            The blocklist could not be read, so its state is unknown rather than empty:{" "}
            {blocklistError}
          </p>
        ) : (
          <div className="panel">
            {blocklist?.map((group) => (
              <div key={group.kind} className="ledger-row" style={{ marginBottom: "0.5rem" }}>
                <span className="muted">{group.kind.replace(/_/g, " ")}</span>
                <span>{group.entries.length} blocked</span>
              </div>
            ))}

            <div style={{ marginTop: "1.5rem" }}>
              <div className="field">
                <label htmlFor="kind">Kind</label>
                <select
                  id="kind"
                  className="input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="value">Value</label>
                <input
                  id="value"
                  className="input num"
                  placeholder={kind === "card_bin" ? "424242" : "value to block"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gap: "0.7rem" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || value.trim() === ""}
                  onClick={() => void mutate({ action: "block", type: kind, data: value })}
                >
                  Block it
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy || value.trim() === ""}
                  onClick={() => void mutate({ action: "unblock", type: kind, data: value })}
                >
                  Unblock it
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => void mutate({ action: "toggle", enabled: true })}
                >
                  Enable the guard
                </button>
              </div>

              {message !== null && (
                <p className="note" style={{ marginTop: "1.25rem" }}>
                  {message}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
