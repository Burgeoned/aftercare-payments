import Link from "next/link";

import { PROVIDER_NAME } from "@/lib/domain/fixtures";
import { RiskConsole } from "./risk-console";

/**
 * The risk surface.
 *
 * Build step 7. The exposure is specific and worth stating plainly rather than
 * gesturing at: a checkout reachable by a statement reference, with no account,
 * accepting any card for a small amount, is a card testing target. An attacker
 * holding stolen card numbers needs somewhere cheap to find out which ones
 * still work. The reference is printed on paper, so it is not a secret and
 * cannot be treated as one.
 *
 * That exposure is a direct consequence of the guest lookup decision in
 * `DOMAIN.md` section 8, which exists because requiring an account in front of
 * a medical bill is the largest source of abandonment in this vertical. The
 * tradeoff was taken deliberately. This page is where its cost is visible.
 */

export const dynamic = "force-dynamic";

export default function RiskPage() {
  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap" style={{ paddingTop: "3.5rem", paddingBottom: "4.5rem" }}>
        <p className="eyebrow">{PROVIDER_NAME} &middot; Billing office</p>

        <h1 className="hero-title mixed" style={{ margin: "1rem 0 1rem" }}>
          Risk
          <em>what a public checkout invites.</em>
        </h1>

        <p className="muted lede">
          A payment page reachable by a statement reference, with no account, accepting
          any card for a small amount, is a card testing target. That is not a flaw in the
          design, it is the price of the design: requiring an account in front of a medical
          bill is the single largest source of abandonment in this vertical. The tradeoff
          was taken on purpose and this is where its cost shows up.
        </p>

        <RiskConsole />

        <section style={{ marginTop: "var(--gap-section)" }}>
          <p className="eyebrow">Honest inventory</p>
          <h2 className="section-title" style={{ margin: "0.75rem 0 1.25rem" }}>
            Controls, and the ones that are missing
          </h2>

          <div className="panel" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: "34rem" }}>
                <thead>
                  <tr>
                    <th>Control</th>
                    <th>State</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Blocklist by BIN or fingerprint</td>
                    <td>Available</td>
                    <td>Hyperswitch, API configured. Read live above</td>
                  </tr>
                  <tr>
                    <td>Amount cannot be set by the client</td>
                    <td>In place</td>
                    <td>The browser names a portion, never a number. D-015</td>
                  </tr>
                  <tr>
                    <td>Payment bound to a verified statement grant</td>
                    <td>In place</td>
                    <td>An intent needs the access cookie, not just a reference</td>
                  </tr>
                  <tr>
                    <td>Webhook signature verification</td>
                    <td>In place</td>
                    <td>HMAC-SHA512 over the raw body, unverified is 401</td>
                  </tr>
                  <tr>
                    <td>Lookup enumeration resistance</td>
                    <td>Partial</td>
                    <td>Missing reference and wrong date of birth answer alike. D-012</td>
                  </tr>
                  <tr>
                    <td>Rate limiting on lookup</td>
                    <td>
                      <span className="flag-warn">Missing</span>
                    </td>
                    <td>Counted, not limited. SCOPE.md item 9</td>
                  </tr>
                  <tr>
                    <td>Velocity limiting on payment attempts</td>
                    <td>
                      <span className="flag-warn">Missing</span>
                    </td>
                    <td>Distinct cards are surfaced above, nothing acts on them</td>
                  </tr>
                  <tr>
                    <td>Authentication on this console</td>
                    <td>
                      <span className="flag-warn">Missing</span>
                    </td>
                    <td>Deliberate boundary, not an oversight. SCOPE.md item 10</td>
                  </tr>
                  <tr>
                    <td>3DS on high risk attempts</td>
                    <td>
                      <span className="flag-warn">Missing</span>
                    </td>
                    <td>Supported by the connector, not conditioned on risk here</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="note note-warn" style={{ marginTop: "1.5rem" }}>
            Four rows say missing. That is the point of the table. A risk page listing only
            what is present tells an operator they are covered, which is the failure this
            kind of screen exists to prevent.
          </p>
        </section>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/provider" style={{ fontSize: "var(--fs-small)" }}>
            Re-adjudication
          </Link>
        </p>
      </div>
    </main>
  );
}
