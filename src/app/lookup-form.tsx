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
    // nothing identifying travels in this navigation.
    router.push(`/statement/${encodeURIComponent(fields.ref.trim().toUpperCase())}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="ref">Statement reference</label>
        <input
          id="ref"
          name="ref"
          className="input"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="AFT-0000-0000"
          value={fields.ref}
          onChange={(e) => setFields({ ...fields, ref: e.target.value })}
        />
        <p className="hint" style={{ marginTop: "var(--gap-label)" }}>
          Printed at the top of your statement.
        </p>
      </div>

      <div className="field">
        <label htmlFor="dateOfBirth">Date of birth</label>
        <input
          id="dateOfBirth"
          name="dateOfBirth"
          className="input"
          type="date"
          required
          value={fields.dateOfBirth}
          onChange={(e) => setFields({ ...fields, dateOfBirth: e.target.value })}
        />
      </div>

      {error !== null && (
        <p role="alert" className="note note-warn" style={{ marginBottom: "var(--gap-field)" }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? "Looking up" : "Find my statement"}
      </button>
    </form>
  );
}
