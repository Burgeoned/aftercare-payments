import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { healthAccountEligibleAmount } from "@/lib/domain/balance";
import { PROVIDER_NAME } from "@/lib/domain/fixtures";
import { viewStatement } from "@/lib/domain/lookup";
import { formatUsd } from "@/lib/domain/money";
import { findStatementByRef } from "@/lib/domain/store";
import type { Cents, StatementBalance } from "@/lib/domain/types";

/**
 * The statement a patient sees after a successful lookup.
 *
 * Two grounds, and the split is the argument. The balance and the act of paying
 * are the instrument: that is what the patient came for and it is stated once,
 * large, at the top. The adjudication is the document: what was billed, what
 * the plan allowed, what it paid, what is left.
 *
 * The explanation is the product. A patient who does not understand why they
 * owe the residual calls the billing office or disputes the charge, and both
 * cost more than the balance. See docs/DOMAIN.md section 8.
 */

export const dynamic = "force-dynamic";

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A zero deduction is not a negative number, and "-$0.00" reads as a defect. */
function deduction(value: Cents): string {
  return value > 0 ? `-${formatUsd(value)}` : formatUsd(value);
}

function LedgerRow({
  label,
  value,
  note,
  total = false,
  marked = false,
}: {
  label: string;
  value: string;
  note?: string;
  total?: boolean;
  marked?: boolean;
}) {
  return (
    <div className={`ledger-row${total ? " ledger-total" : ""}`}>
      <span className={total ? undefined : "muted"}>
        {label}
        {note !== undefined && <span className="hint"> {note}</span>}
      </span>
      <span className={marked ? "paid-mark" : undefined}>{value}</span>
    </div>
  );
}

function DueHeader({
  balance,
  statementRef,
}: {
  balance: StatementBalance;
  statementRef: string;
}) {
  if (balance.status === "settling") {
    return (
      <>
        <p className="eyebrow" style={{ marginBottom: "0.9rem" }}>
          Clearing
        </p>
        <p className="answer">{formatUsd(balance.patientResponsibility)}</p>
        <p className="muted" style={{ marginTop: "1rem", maxWidth: "34rem" }}>
          Received from your bank account. Bank debits take a few days to clear and can
          still be returned in that time, so nothing is final yet. There is nothing for
          you to do.
        </p>
        <div style={{ maxWidth: "20rem", marginTop: "2rem" }}>
          <Link
            href={`/statement/${encodeURIComponent(statementRef)}/receipt`}
            className="btn btn-quiet"
          >
            View receipt
          </Link>
        </div>
      </>
    );
  }

  if (balance.status === "paid") {
    return (
      <>
        <p className="eyebrow" style={{ marginBottom: "0.9rem" }}>
          Paid in full
        </p>
        <p className="answer paid-mark">{formatUsd(balance.patientResponsibility)}</p>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Nothing further is owed on this statement.
        </p>
        <div style={{ maxWidth: "20rem", marginTop: "2rem" }}>
          <Link
            href={`/statement/${encodeURIComponent(statementRef)}/receipt`}
            className="btn btn-quiet"
          >
            View receipt
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: "0.9rem" }}>
        {balance.amountPaid > 0 ? "Remaining balance" : "Amount due"}
      </p>
      <p className="answer">{formatUsd(balance.remaining)}</p>

      {balance.amountPaid > 0 && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          <span className="paid-mark num">{formatUsd(balance.amountPaid)}</span> already paid
          against a {formatUsd(balance.patientResponsibility)} responsibility.
        </p>
      )}

      <div style={{ maxWidth: "20rem", marginTop: "2rem", display: "grid", gap: "0.7rem" }}>
        <Link href={`/statement/${encodeURIComponent(statementRef)}/pay`} className="btn">
          Pay this balance
        </Link>
        {balance.amountPaid > 0 && (
          <Link
            href={`/statement/${encodeURIComponent(statementRef)}/receipt`}
            className="btn btn-quiet"
          >
            Receipt for what you paid
          </Link>
        )}
      </div>
    </>
  );
}

export default async function StatementPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: routeRef } = await params;

  const statement = findStatementByRef(decodeURIComponent(routeRef));
  if (statement === null) redirect("/");

  /**
   * The access grant proves a date of birth was supplied, and it is checked
   * against this specific statement. A grant for one statement must not open
   * another, or the credential is just the reference again.
   */
  const granted = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (granted !== statement.id) redirect("/");

  const view = await viewStatement(statement);
  if (view === null) redirect("/");

  const { balance, patientDisplayName } = view;
  const eligible = healthAccountEligibleAmount(statement);
  const mixedEligibility = eligible > 0 && eligible < balance.patientResponsibility;

  return (
    <>
      <section className="instrument">
        <div className="wrap" style={{ paddingTop: "3rem", paddingBottom: "3.5rem" }}>
          <p className="eyebrow">
            {PROVIDER_NAME} &middot; Statement {statement.ref}
          </p>
          <p className="muted" style={{ margin: "0.75rem 0 2.25rem", fontSize: "var(--fs-small)" }}>
            {patientDisplayName} &middot; Date of service {longDate(statement.serviceDate)}
          </p>

          <DueHeader balance={balance} statementRef={statement.ref} />
        </div>
      </section>

      <section className="document">
        <div className="wrap" style={{ paddingTop: "3.5rem", paddingBottom: "4.5rem" }}>
          <div className="stack">
            <div>
              <p className="eyebrow">Explanation</p>
              <h2 className="section-title mixed" style={{ margin: "0.75rem 0 1.5rem" }}>
                What your plan did with this bill
                <em>and what it left to you.</em>
              </h2>

              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th className="n">Billed</th>
                        <th className="n">Plan rate</th>
                        <th className="n">Plan paid</th>
                        <th className="n">You owe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.lineItems.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.description}
                            {!item.healthAccountEligible && (
                              <span className="flag-warn">Not HSA/FSA</span>
                            )}
                          </td>
                          <td className="n muted">{formatUsd(item.charged)}</td>
                          <td className="n muted">{formatUsd(item.allowed)}</td>
                          <td className="n muted">{formatUsd(item.payerPaid)}</td>
                          <td className="n">{formatUsd(item.patientOwes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  className="ledger rule-top"
                  style={{ padding: "1.25rem 0.9rem 1.4rem", marginTop: "0" }}
                >
                  <LedgerRow label="Total billed" value={formatUsd(balance.totalCharged)} />
                  <LedgerRow
                    label="Plan discount"
                    note="your plan's contracted rate"
                    value={deduction(balance.payerAdjustment)}
                  />
                  <LedgerRow label="Plan paid" value={deduction(balance.payerPaid)} />
                  <LedgerRow
                    label="Your responsibility"
                    value={formatUsd(balance.patientResponsibility)}
                    total
                  />

                  {(balance.amountPaid > 0 || balance.amountRefunded > 0) && (
                    <>
                      <LedgerRow
                        label="Paid to date"
                        value={deduction(balance.amountPaid)}
                        marked
                      />
                      {balance.amountRefunded > 0 && (
                        <LedgerRow
                          label="Refunded to you"
                          note="after re-adjudication"
                          value={`+${formatUsd(balance.amountRefunded)}`}
                        />
                      )}
                      <LedgerRow label="Remaining" value={formatUsd(balance.remaining)} total />
                    </>
                  )}
                </div>
              </div>
            </div>

            {mixedEligibility && (
              <p className="note note-warn">
                {formatUsd(eligible)} of this balance is eligible for HSA or FSA funds. The
                rest is not, so a health account card cannot cover the whole amount and the
                remainder has to come from another method.
              </p>
            )}

            <p className="hint">
              Amounts come from the payer&rsquo;s remittance. The plan rate is what your
              insurer&rsquo;s contract allows the provider to charge, which is why the billed
              column and the rate column differ.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
