import { Checkout } from "./checkout";
import { serverEnv } from "@/lib/env";

/**
 * The return URL is read from validated server configuration, not from
 * `process.env` with a fallback.
 *
 * It used to default to `http://localhost:3000` when the variable was absent.
 * That is how a payment on the deployed site sent a patient to a return URL on
 * their own machine: the payment succeeded at the processor and the patient
 * landed on a page that could not load. A fallback here does not make a
 * misconfiguration survivable, it makes it invisible. See docs/DECISIONS.md
 * D-014.
 */

export const dynamic = "force-dynamic";

export default function PayPage() {
  const { appUrl } = serverEnv();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Integration smoke test</h1>
        <p className="text-sm text-[var(--muted)]">
          A real $1.00 payment in the Hyperswitch sandbox. Use test card
          4242&nbsp;4242&nbsp;4242&nbsp;4242, any future expiry, any CVC.
        </p>
      </div>
      <Checkout returnUrl={`${appUrl}/pay/return`} />
    </main>
  );
}
