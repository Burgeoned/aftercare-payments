import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { deriveBalance, patientResponsibility, settledActivity } from "@/lib/domain/balance";
import { PROVIDER_NAME, STATEMENT_DESCRIPTOR } from "@/lib/domain/fixtures";
import { formatUsd } from "@/lib/domain/money";
import { describeTender } from "@/lib/domain/tender";
import {
  findStatementByRef,
  findPatientById,
  paymentsForStatement,
  readjudicationFor,
  refundsForPayments,
} from "@/lib/domain/store";
import type { Payment } from "@/lib/domain/types";

/**
 * The receipt.
 *
 * Entirely on the document ground, because that is what a receipt is. It shows
 * only what the ledger records: payments that a verified webhook reported as
 * succeeded, folded the same way the balance folds them. A receipt derived from
 * a different view of the log than the balance is how a patient ends up holding
 * a receipt that does not add up to what they were charged.
 *
 * Nothing here is generated from the redirect. A patient who closed the tab
 * before returning has the same receipt as one who did not.
 */

export const dynamic = "force-dynamic";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div
      className="rule-top"
      style={{ padding: "1.1rem 0", display: "grid", gap: "0.3rem" }}
    >
      <div className="ledger-row" style={{ fontSize: "var(--fs-figure)", fontWeight: 600 }}>
        <span className={payment.tender?.class === "health_account" ? "tender-health" : undefined}>
          {describeTender(payment.tender)}
        </span>
        <span className="num paid-mark">{formatUsd(payment.amount)}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {stamp(payment.updatedAt)}
      </p>
      <p className="hint" style={{ margin: 0 }}>
        Reference <span className="num">{payment.hyperswitchPaymentId}</span>
      </p>
    </div>
  );
}

export default async function ReceiptPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: routeRef } = await params;

  const statement = findStatementByRef(decodeURIComponent(routeRef));
  if (statement === null) redirect("/");

  const granted = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (granted !== statement.id) redirect("/");

  const patient = findPatientById(statement.patientId);
  if (patient === null) redirect("/");

  const allPayments = await paymentsForStatement(statement.id);
  const allRefunds = await refundsForPayments(allPayments.map((p) => p.id));
  const revision = await readjudicationFor(statement.id);
  const balance = deriveBalance(statement, allPayments, allRefunds, revision);
  const activity = settledActivity(statement, allPayments, allRefunds);

  // Nothing has settled. Sending the patient to an empty receipt would suggest
  // their payment failed, when the likely truth is that the webhook has not
  // arrived yet, so the return page keeps waiting instead.
  if (activity.payments.length === 0) {
    redirect(`/pay/return?payment_id=&status=pending`);
  }

  const settled = balance.remaining === 0;
  const settling = balance.status === "settling";

  return (
    <main className="document" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "3.5rem", paddingBottom: "4.5rem" }}>
        <p className="eyebrow">{PROVIDER_NAME} &middot; Receipt</p>

        <h1 className="hero-title mixed" style={{ margin: "1rem 0 0.5rem" }}>
          {balance.amountRefunded > 0
            ? "Corrected, and settled."
            : settling
              ? "Received, and clearing."
              : settled
                ? "Paid in full."
                : "Payment received."}
          <em>Statement {statement.ref}</em>
        </h1>

        <p className="muted lede" style={{ marginBottom: "2.5rem" }}>
          {patient.displayName} &middot; Date of service{" "}
          {new Date(`${statement.serviceDate}T00:00:00Z`).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>

        <div className="card" style={{ padding: "0 1.25rem 0.5rem" }}>
          {activity.payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} />
          ))}

          {activity.refunds.map((refund) => (
            <div key={refund.id} className="rule-top" style={{ padding: "1.1rem 0" }}>
              <div className="ledger-row" style={{ fontSize: "var(--fs-figure)", fontWeight: 600 }}>
                <span className="refund-mark">Refunded to your original payment method</span>
                <span className="num refund-mark">+{formatUsd(refund.amount)}</span>
              </div>
              <p className="hint" style={{ margin: "0.3rem 0 0" }}>
                {stamp(refund.updatedAt)} &middot; after re-adjudication
              </p>
            </div>
          ))}

          <div className="ledger rule-top" style={{ padding: "1.25rem 0 1.4rem" }}>
            <div className="ledger-row">
              <span className="muted">Your responsibility</span>
              <span>{formatUsd(balance.patientResponsibility)}</span>
            </div>
            <div className="ledger-row">
              <span className="muted">Paid</span>
              <span className="paid-mark">{formatUsd(balance.amountPaid)}</span>
            </div>
            {balance.amountRefunded > 0 && (
              <div className="ledger-row">
                <span className="muted">Returned to you</span>
                <span className="refund-mark">-{formatUsd(balance.amountRefunded)}</span>
              </div>
            )}
            <div className="ledger-row ledger-total">
              <span>{settled ? "Balance" : "Still owed"}</span>
              <span>{formatUsd(balance.remaining)}</span>
            </div>
          </div>
        </div>

        {activity.payments.some((p) => p.tender?.class === "health_account") && (
          <p className="note" style={{ marginTop: "2rem" }}>
            Part of this was paid with a health account card. If any of it is refunded,
            the money returns to that same account rather than to another card, because
            returning health account funds elsewhere turns a qualified distribution into
            a taxable one.
          </p>
        )}

        {revision !== null && (
          <p className="note" style={{ marginTop: "2rem" }}>
            Your insurer reprocessed this claim on{" "}
            {new Date(revision.at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            , which changed what you owe from{" "}
            {formatUsd(patientResponsibility(statement))} to{" "}
            {formatUsd(balance.patientResponsibility)}. {revision.reason}.
            {balance.amountRefunded > 0
              ? " The difference was returned to the card you paid with."
              : balance.remaining > 0
                ? " Your remaining balance was reduced rather than refunded."
                : " Nothing was over-collected, so no refund was due."}
          </p>
        )}

        {settling && (
          <p className="note note-warn" style={{ marginTop: "2rem" }}>
            You paid from a bank account. Bank debits clear over the following few days
            and can still be returned in that time, for an insufficient balance or a
            closed account, so this is not final yet. Nothing more is owed unless the
            debit is returned, and you will be told if it is. A card would have settled
            immediately; these two work differently and this receipt says so rather than
            treating them alike.
          </p>
        )}

        <p className="note" style={{ marginTop: "2rem" }}>
          This receipt reflects payments confirmed by the payment processor, not the
          browser redirect that followed them. It is the same record the balance is
          derived from.
        </p>

        <p className="hint" style={{ marginTop: "1.5rem" }}>
          Charges appear on your statement as{" "}
          <span className="num">{STATEMENT_DESCRIPTOR}</span>. No description of your care
          is sent to the payment processor or printed on your card statement.
        </p>

        {!settled && (
          <div style={{ maxWidth: "20rem", marginTop: "2rem" }}>
            <Link href={`/statement/${encodeURIComponent(statement.ref)}/pay`} className="btn">
              Pay the remaining {formatUsd(balance.remaining)}
            </Link>
          </div>
        )}

        <p style={{ marginTop: "2rem" }}>
          <Link
            href={`/statement/${encodeURIComponent(statement.ref)}`}
            style={{ fontSize: "var(--fs-small)" }}
          >
            Back to the statement
          </Link>
        </p>
      </div>
    </main>
  );
}
