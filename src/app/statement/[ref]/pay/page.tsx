import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, resolveAccess } from "@/lib/access";
import { healthAccountEligibleAmount } from "@/lib/domain/balance";
import { PROVIDER_NAME } from "@/lib/domain/fixtures";
import { viewStatement } from "@/lib/domain/lookup";
import { findStatementByRef } from "@/lib/domain/store";
import { serverEnv } from "@/lib/env";
import type { Cents } from "@/lib/domain/types";
import { PayPanel } from "./pay-panel";

/**
 * Checkout for one statement.
 *
 * Entirely on the instrument ground. There is nothing to read here, only
 * something to operate, and the explanation the patient needed is one page
 * back.
 *
 * The amount is not passed to the browser as an authority. It is rendered so
 * the patient can see what they are about to pay, while the server derives the
 * charged amount independently from the payment log.
 */

export const dynamic = "force-dynamic";

export default async function PayStatementPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref: routeRef } = await params;

  const statement = findStatementByRef(decodeURIComponent(routeRef));
  if (statement === null) redirect("/");

  const granted = resolveAccess((await cookies()).get(ACCESS_COOKIE)?.value);
  if (granted !== statement.id) redirect("/");

  const view = await viewStatement(statement);
  if (view === null) redirect("/");

  const { balance } = view;

  // Nothing to collect. Sending the patient to a checkout that will be refused
  // by the intent route is worse than not offering it.
  if (balance.remaining === 0) redirect(`/statement/${encodeURIComponent(statement.ref)}`);

  const eligible = healthAccountEligibleAmount(statement);

  // Never offer more than is still owed. A patient who already paid part of the
  // balance with another method must not be shown the full eligible figure.
  const eligibleNow = (eligible < balance.remaining ? eligible : balance.remaining) as Cents;

  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "3rem", paddingBottom: "4rem" }}>
        <p className="eyebrow">
          {PROVIDER_NAME} &middot; Statement {statement.ref}
        </p>

        <PayPanel
          remaining={balance.remaining}
          eligible={eligibleNow}
          returnUrl={`${serverEnv().appUrl}/pay/return`}
        />

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
