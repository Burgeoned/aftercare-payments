import Link from "next/link";

import { PROVIDER_NAME, STATEMENTS } from "@/lib/domain/fixtures";
import { PATIENTS } from "@/lib/domain/fixtures";
import { LookupForm } from "./lookup-form";

/**
 * Guest lookup. No account, no password, no email verification.
 *
 * Requiring account creation in front of a medical bill is the single largest
 * source of abandonment in this vertical, so the patient gets in with what is
 * printed on the paper they are holding. See docs/DOMAIN.md section 8 and the
 * security tradeoff recorded in src/lib/domain/lookup.ts.
 */

export default function Home() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="mb-8 space-y-3">
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">{PROVIDER_NAME}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Pay your bill</h1>
        <p className="text-sm text-[var(--muted)]">
          Enter the reference from your statement and your date of birth. There is no
          account to create.
        </p>
      </div>

      <LookupForm />

      <div className="mt-10 rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-1 text-sm font-medium">Fixture data</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          This is a prototype with no practice management system behind it. These are the
          statements it knows about.
        </p>
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          {STATEMENTS.map((statement) => {
            const patient = PATIENTS.find((p) => p.id === statement.patientId);
            return (
              <li key={statement.id} className="flex justify-between gap-4 tabular-nums">
                <span>{statement.ref}</span>
                <span>{patient?.dateOfBirth}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-6 text-xs text-[var(--muted)]">
        <Link href="/pay" className="underline underline-offset-2">
          Integration smoke test
        </Link>{" "}
        creates a real $1.00 sandbox payment, separate from any statement.
      </p>
    </main>
  );
}
