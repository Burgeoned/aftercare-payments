import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { healthAccountEligibleAmount } from "@/lib/domain/balance";
import { PROVIDER_NAME } from "@/lib/domain/fixtures";
import { viewStatement } from "@/lib/domain/lookup";
import { formatUsd } from "@/lib/domain/money";
import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { findStatementByRef } from "@/lib/domain/store";
import type { Cents, StatementBalance } from "@/lib/domain/types";

/**
 * The statement a patient sees after a successful lookup.
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

/** A zero deduction is not a negative number, and "-$0.00" reads as a bug. */
function deduction(value: Cents): string {
  return value > 0 ? `-${formatUsd(value)}` : formatUsd(value);
}

function SummaryRow({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        emphasis ? "border-t border-[var(--line)] pt-3 text-base font-semibold" : "text-sm"
      }`}
    >
      <span className={emphasis ? "" : "text-[var(--muted)]"}>
        {label}
        {note !== undefined && (
          <span className="ml-2 text-xs text-[var(--muted)]">{note}</span>
        )}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function PaymentProgress({ balance }: { balance: StatementBalance }) {
  if (balance.amountPaid === 0 && balance.amountRefunded === 0) return null;

  return (
    <div className="mt-4 space-y-0 border-t border-[var(--line)] pt-2">
      <SummaryRow label="Paid to date" value={deduction(balance.amountPaid)} />
      {balance.amountRefunded > 0 && (
        <SummaryRow
          label="Refunded to you"
          value={`+${formatUsd(balance.amountRefunded)}`}
          note="after re-adjudication"
        />
      )}
      <SummaryRow label="Remaining balance" value={formatUsd(balance.remaining)} emphasis />
    </div>
  );
}

export default async function StatementPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;

  const statement = findStatementByRef(decodeURIComponent(ref));
  if (statement === null) redirect("/");

  /**
   * The access grant is what proves the date of birth was supplied, and it is
   * checked against this specific statement. A grant for one statement must not
   * open another, or the credential is just the reference again.
   */
  const granted = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (granted !== statement.id) redirect("/");

  const view = await viewStatement(statement);
  if (view === null) redirect("/");

  const { balance, patientDisplayName } = view;
  const eligible = healthAccountEligibleAmount(statement);
  const hasMixedEligibility = eligible > 0 && eligible < balance.patientResponsibility;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">{PROVIDER_NAME}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Statement {statement.ref}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {patientDisplayName} &middot; Date of service {longDate(statement.serviceDate)}
        </p>
      </header>

      <section className="rounded-lg border border-[var(--line)]">
        <div className="border-b border-[var(--line)] px-5 py-3">
          <h2 className="text-sm font-medium">What your plan did with this bill</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-5 py-2 font-medium">Service</th>
                <th className="px-3 py-2 text-right font-medium">Billed</th>
                <th className="px-3 py-2 text-right font-medium">Plan rate</th>
                <th className="px-3 py-2 text-right font-medium">Plan paid</th>
                <th className="px-5 py-2 text-right font-medium">You owe</th>
              </tr>
            </thead>
            <tbody>
              {statement.lineItems.map((item) => (
                <tr key={item.id} className="border-t border-[var(--line)]">
                  <td className="px-5 py-3">
                    {item.description}
                    {!item.healthAccountEligible && (
                      <span className="ml-2 rounded border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                        not HSA/FSA eligible
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--muted)]">
                    {formatUsd(item.charged)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--muted)]">
                    {formatUsd(item.allowed)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--muted)]">
                    {formatUsd(item.payerPaid)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium">
                    {formatUsd(item.patientOwes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-[var(--line)] px-5 py-4">
          <SummaryRow label="Total billed" value={formatUsd(balance.totalCharged)} />
          <SummaryRow
            label="Plan discount"
            value={deduction(balance.payerAdjustment)}
            note="your plan's contracted rate"
          />
          <SummaryRow label="Plan paid" value={deduction(balance.payerPaid)} />
          <SummaryRow
            label="Your responsibility"
            value={formatUsd(balance.patientResponsibility)}
            emphasis
          />
          <PaymentProgress balance={balance} />
        </div>
      </section>

      {hasMixedEligibility && (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {formatUsd(eligible)} of this balance is eligible for HSA or FSA funds. The
          remainder is not, so a health account card cannot cover the whole amount.
        </p>
      )}

      <div className="mt-8 rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-1 font-medium">Pay this balance</h2>
        <p className="text-sm text-[var(--muted)]">
          Payment against a real statement lands in build step 4. This page proves the
          adjudication breakdown first, because a patient who does not understand the
          residual does not pay it.
        </p>
      </div>
    </main>
  );
}
