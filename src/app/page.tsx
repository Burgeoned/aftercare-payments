import Link from "next/link";

/**
 * Placeholder landing page. Statement lookup replaces this in build step 3.
 * It exists now so the deploy is verifiable before any domain code is written.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">Aftercare</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Patient billing, built on Hyperswitch
        </h1>
        <p className="text-[var(--muted)]">
          A prototype for the post-adjudication patient responsibility flow. The statement
          lookup lands in build step 3. This page exists so the deploy can be verified
          before any domain code is written.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-2 font-medium">Integration smoke test</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Creates a real payment in the Hyperswitch sandbox and mounts Unified Checkout
          against it. Proves credentials, connector, and SDK before anything is built on
          top of them.
        </p>
        <Link
          href="/pay"
          className="inline-block rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Run it
        </Link>
      </div>
    </main>
  );
}
