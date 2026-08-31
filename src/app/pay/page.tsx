import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

export default function PayPage() {
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

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
