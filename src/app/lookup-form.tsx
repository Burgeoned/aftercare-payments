"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Guest lookup form.
 *
 * Posts JSON rather than submitting a native form, so the date of birth travels
 * in a request body instead of a query string. See docs/DECISIONS.md D-012.
 */

interface FieldState {
  readonly ref: string;
  readonly dateOfBirth: string;
}

export function LookupForm() {
  const router = useRouter();
  const [fields, setFields] = useState<FieldState>({ ref: "", dateOfBirth: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch("/api/statements/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } catch {
      setSubmitting(false);
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setSubmitting(false);
      setError(body?.message ?? "That lookup did not succeed.");
      return;
    }

    // The access cookie is set by the response. The statement page reads it, so
    // nothing identifying needs to travel in this navigation.
    router.push(`/statement/${encodeURIComponent(fields.ref.trim().toUpperCase())}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="ref" className="block text-sm font-medium">
          Statement reference
        </label>
        <input
          id="ref"
          name="ref"
          required
          autoComplete="off"
          placeholder="AFT-0000-0000"
          value={fields.ref}
          onChange={(e) => setFields({ ...fields, ref: e.target.value })}
          className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
        <p className="text-xs text-[var(--muted)]">Printed at the top of your statement.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="dateOfBirth" className="block text-sm font-medium">
          Date of birth
        </label>
        <input
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          required
          value={fields.dateOfBirth}
          onChange={(e) => setFields({ ...fields, dateOfBirth: e.target.value })}
          className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-[var(--foreground)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Looking up..." : "Find my statement"}
      </button>
    </form>
  );
}
