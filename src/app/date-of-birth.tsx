"use client";

import { useRef, useState } from "react";

/**
 * Date of birth entry, as three fields.
 *
 * Not a date picker. A calendar is built for choosing a date near today, and a
 * birth date is decades away: the patient would page back sixty years through a
 * grid. Not dropdowns either, because a year select is a hundred item list and
 * a month select trades typing for scrolling.
 *
 * Three short text fields is the pattern for a date somebody knows from memory,
 * and it is what the GOV.UK design system uses for this exact case. The patient
 * types the digits they would say out loud.
 *
 * `inputMode="numeric"` rather than `type="number"`: a number input strips
 * leading zeros, so a January birthday typed as 01 becomes 1, and it puts
 * spinner arrows on a field where incrementing a month is meaningless.
 */

export interface DateParts {
  readonly month: string;
  readonly day: string;
  readonly year: string;
}

export const EMPTY_DATE: DateParts = { month: "", day: "", year: "" };

/**
 * Assembles an ISO date, or null if the parts are not a real one.
 *
 * Validated here rather than trusted, because the server rejects a malformed
 * date with the same deliberately vague message it gives a wrong one, and
 * telling a patient "no statement matches" when they typed month 13 is a bad
 * way to learn about a typo.
 */
export function toIsoDate(parts: DateParts): string | null {
  const month = Number(parts.month);
  const day = Number(parts.day);
  const year = Number(parts.year);

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(year) || parts.year.length !== 4) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Rejects the 31st of a 30 day month and the 29th of a common year, which
  // Date silently rolls forward into the next month rather than refusing.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCDate() !== day || parsed.getUTCMonth() + 1 !== month) return null;

  return iso;
}

export function DateOfBirthField({
  value,
  onChange,
  invalid,
}: {
  value: DateParts;
  onChange: (next: DateParts) => void;
  invalid: boolean;
}) {
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);

  function digitsOnly(raw: string, max: number): string {
    return raw.replace(/\D/g, "").slice(0, max);
  }

  const showError = invalid && touched;

  return (
    <fieldset
      className="field"
      style={{ border: 0, padding: 0, margin: "0 0 var(--gap-field)", minInlineSize: 0 }}
    >
      <legend
        style={{
          padding: 0,
          marginBottom: "var(--gap-label)",
          fontSize: "var(--fs-small)",
          fontWeight: 600,
        }}
      >
        Date of birth
      </legend>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
        {(
          [
            { key: "month", label: "Month", placeholder: "MM", max: 2, width: "4.5rem" },
            { key: "day", label: "Day", placeholder: "DD", max: 2, width: "4.5rem" },
            { key: "year", label: "Year", placeholder: "YYYY", max: 4, width: "6rem" },
          ] as const
        ).map((part) => (
          <div key={part.key} style={{ width: part.width }}>
            <label
              htmlFor={`dob-${part.key}`}
              className="hint"
              style={{ display: "block", marginBottom: "4px" }}
            >
              {part.label}
            </label>
            <input
              id={`dob-${part.key}`}
              ref={part.key === "day" ? dayRef : part.key === "year" ? yearRef : undefined}
              className="input num"
              inputMode="numeric"
              autoComplete={
                part.key === "month"
                  ? "bday-month"
                  : part.key === "day"
                    ? "bday-day"
                    : "bday-year"
              }
              placeholder={part.placeholder}
              value={value[part.key]}
              onBlur={() => setTouched(true)}
              onChange={(e) => {
                const next = digitsOnly(e.target.value, part.max);
                onChange({ ...value, [part.key]: next });

                // Advances only when the field is unambiguously finished, so a
                // patient typing 1 for January is not thrown into the next box
                // before they can type the 2 of 12.
                if (next.length === part.max) {
                  if (part.key === "month") dayRef.current?.focus();
                  if (part.key === "day") yearRef.current?.focus();
                }
              }}
              aria-invalid={showError}
              style={{ textAlign: "center" }}
            />
          </div>
        ))}
      </div>

      {showError && (
        <p role="alert" className="hint" style={{ marginTop: "var(--gap-label)" }}>
          That is not a date. Check the month and day.
        </p>
      )}
    </fieldset>
  );
}
