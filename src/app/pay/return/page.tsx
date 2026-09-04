import Link from "next/link";

export const dynamic = "force-dynamic";

interface ReturnPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Where Hyperswitch redirects after confirmation.
 *
 * This page deliberately does not decide whether the payment succeeded. The
 * redirect only tells us the patient came back. Money state comes from a
 * verified webhook, which lands in build step 5. Until then this page reports
 * what the redirect claimed and says plainly that it is not the ledger.
 *
 * That distinction stopped being theoretical on 2026-09-03, when a
 * misconfigured return URL sent a patient to a dead address after a payment
 * that had already succeeded. See docs/DECISIONS.md D-014.
 */
export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const status = typeof params["status"] === "string" ? params["status"] : "unknown";
  const paymentId = typeof params["payment_id"] === "string" ? params["payment_id"] : null;

  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "4.5rem", paddingBottom: "4rem" }}>
        <p className="eyebrow">Redirect received</p>

        <h1 className="hero-title mixed" style={{ margin: "1rem 0 2rem" }}>
          You are back.
          <em>That is all this page knows.</em>
        </h1>

        <div className="panel">
          <div className="ledger">
            <div className="ledger-row">
              <span className="muted">Redirect status</span>
              <span>{status}</span>
            </div>
            {paymentId !== null && (
              <div className="ledger-row">
                <span className="muted">Payment</span>
                <span style={{ wordBreak: "break-all" }}>{paymentId}</span>
              </div>
            )}
          </div>
        </div>

        <p className="note" style={{ marginTop: "2rem" }}>
          A redirect tells us the browser came back. It does not tell us money moved, and a
          patient who closes the tab never sends one at all. The balance changes when a
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
