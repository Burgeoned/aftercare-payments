"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DateOfBirthField, EMPTY_DATE, toIsoDate, type DateParts } from "./date-of-birth";

/**
 * Guest lookup form.
 *
 * Posts JSON rather than submitting a native form, so the date of birth travels
 * in a request body instead of a query string. See docs/DECISIONS.md D-012.
 */

export function LookupForm() {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [dob, setDob] = useState<DateParts>(EMPTY_DATE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const anyDobEntered = dob.month !== "" || dob.day !== "" || dob.year !== "";
  const isoDate = toIsoDate(dob);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isoDate === null) {
      setError("Enter your date of birth as month, day and year.");
      return;
    }

    setSubmitting(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch("/api/statements/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, dateOfBirth: isoDate }),
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
    router.push(`/statement/${encodeURIComponent(ref.trim().toUpperCase())}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="ref">Statement reference</label>
        <input
          id="ref"
          name="ref"
          className="input num"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="AFT-0000-0000"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <p className="hint" style={{ marginTop: "var(--gap-label)" }}>
          Printed at the top of your statement.
        </p>
      </div>

      <DateOfBirthField
        value={dob}
        onChange={setDob}
        invalid={anyDobEntered && isoDate === null}
      />

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
