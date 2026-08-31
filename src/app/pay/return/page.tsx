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
 * what the redirect claimed and labels it as unverified.
 */
export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const status = typeof params["status"] === "string" ? params["status"] : "unknown";
  const paymentId =
    typeof params["payment_id"] === "string" ? params["payment_id"] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Payment returned</h1>
      <dl className="rounded-lg border border-[var(--line)] p-4 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-[var(--muted)]">Redirect status</dt>
          <dd className="font-mono">{status}</dd>
        </div>
        {paymentId !== null && (
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-[var(--muted)]">Payment</dt>
            <dd className="font-mono break-all">{paymentId}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-[var(--muted)]">
        This reflects the redirect only, and is not confirmation that money moved. The
        ledger updates when a signature-verified webhook arrives. See docs/DESIGN.md
        section 6.
      </p>
    </main>
  );
}
