import Link from "next/link";

import { Confirming } from "./confirming";

export const dynamic = "force-dynamic";

interface ReturnPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Where Hyperswitch redirects after confirmation.
 *
 * This page does not decide whether the payment succeeded. The redirect only
 * tells us the patient came back. It waits for the ledger, which moves when a
 * signature-verified webhook says so, and then hands the patient a receipt.
 *
 * That distinction stopped being theoretical on 2026-09-03, when a
 * misconfigured return URL sent a patient to a dead address after a payment
 * that had already succeeded. The money was fine. See docs/DECISIONS.md D-014.
 */
export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const status = typeof params["status"] === "string" ? params["status"] : "unknown";
  const paymentId = typeof params["payment_id"] === "string" ? params["payment_id"] : null;

  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "4.5rem", paddingBottom: "4rem" }}>
        <p className="eyebrow">Confirming</p>

        <h1 className="hero-title mixed" style={{ margin: "1rem 0 2rem" }}>
          You are back.
          <em>Now we wait for the ledger.</em>
        </h1>

        <div className="panel">
          <Confirming redirectStatus={status} />
        </div>

        <div className="panel" style={{ marginTop: "1.25rem" }}>
          <div className="ledger">
            <div className="ledger-row">
              <span className="muted">Redirect status</span>
              <span>{status}</span>
            </div>
            {paymentId !== null && paymentId !== "" && (
              <div className="ledger-row">
                <span className="muted">Payment</span>
                <span style={{ wordBreak: "break-all" }}>{paymentId}</span>
              </div>
            )}
          </div>
        </div>

        <p className="note" style={{ marginTop: "2rem" }}>
          A redirect tells us the browser came back. It does not tell us money moved, and
          a patient who closes the tab never sends one at all. The balance changes when a
          signature-verified webhook arrives, not here. See docs/DESIGN.md section 6.
        </p>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/" style={{ fontSize: "var(--fs-small)" }}>
            Look up a statement
          </Link>
        </p>
      </div>
    </main>
  );
}
