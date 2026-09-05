import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isStaff, STAFF_COOKIE } from "@/lib/staff";
import Link from "next/link";

import { PROVIDER_NAME, STATEMENTS } from "@/lib/domain/fixtures";
import { ReadjudicateForm } from "./readjudicate-form";

/**
 * The provider console, reduced to the one action this prototype needs.
 *
 * On the instrument ground because it is an operator surface: someone in a
 * billing office acting on a remittance, not a patient reading a bill.
 *
 * In production the correction arrives as an 835 remittance and nobody types
 * anything. This form is that same input with the EDI removed, which is the
 * honest way to demonstrate a flow whose interesting half is what happens
 * afterwards. See docs/SCOPE.md item 8.
 *
 * Unauthenticated, and said out loud rather than quietly: this page moves money
 * out of the provider, so a real one sits behind staff authentication and an
 * audit trail. That is a stated prototype boundary.
 */

export const dynamic = "force-dynamic";

export default async function ProviderPage() {
  // The console moves money and controls the fraud guard. See D-030.
  if (!isStaff((await cookies()).get(STAFF_COOKIE)?.value)) redirect("/provider/login");

  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "3.5rem", paddingBottom: "4.5rem" }}>
        <p className="eyebrow">{PROVIDER_NAME} &middot; Billing office</p>

        <h1 className="hero-title mixed" style={{ margin: "1rem 0 1rem" }}>
          Re-adjudication
          <em>the payer changed its mind.</em>
        </h1>

        <p className="muted lede">
          A payer reprocesses a claim after the patient has already paid, and the residual
          drops. Money has to go back, almost always partially, and it can only go back to
          the instrument it came from.
        </p>

        <p className="note" style={{ marginTop: "1.75rem" }}>
          This endpoint moves money out of the provider, so it is behind a staff password.
          What is still deferred is per-user identity and an audit trail: a real console
          records who applied a correction and against which remittance. See D-030.
        </p>

        <ReadjudicateForm refs={STATEMENTS.map((s) => s.ref)} />

        <div className="panel" style={{ marginTop: "2.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "1rem" }}>
            Where the money goes
          </p>
          <p className="muted" style={{ margin: 0, fontSize: "var(--fs-small)" }}>
            A refund references a payment, not a statement, so it physically cannot land
            anywhere except the card or account it came from. On a split tender balance
            that still leaves a choice, and health account payments are drawn from last:
            returning money to a personal card is unambiguously fine, while returning it to
            a health account is a reversal against a tax-advantaged account.
          </p>
        </div>

        <p style={{ marginTop: "2rem", display: "flex", gap: "1.5rem" }}>
          <Link href="/provider/risk" style={{ fontSize: "var(--fs-small)" }}>
            Risk
          </Link>
          <Link href="/" style={{ fontSize: "var(--fs-small)" }}>
            Patient view
          </Link>
        </p>
      </div>
    </main>
  );
}
