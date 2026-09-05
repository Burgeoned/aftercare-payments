"use client";

import { useState } from "react";

import { formatUsd } from "@/lib/domain/money";
import type { Cents } from "@/lib/domain/types";
import { Checkout } from "./checkout";

/**
 * Split tender, as a choice made before the payment exists.
 *
 * Health account balances are finite and only some lines are eligible, so a
 * patient with an FSA card and a mixed statement cannot pay the whole thing
 * from it. Without this they would enter the card, be declined for insufficient
 * funds or ineligible spend, and have no idea why. See docs/DOMAIN.md section 5.
 *
 * The choice has to come first because it determines the amount, and the amount
 * is fixed when the intent is created. The server still decides what each
 * option is worth: the browser sends "full" or "health_account" and never a
 * number. See docs/DECISIONS.md D-015.
 *
 * Changing the choice after checkout has mounted creates a second intent and
 * abandons the first. That is the known idempotency gap, and it is a real cost
 * rather than a hidden one: an abandoned intent sits in the log until a webhook
 * resolves it.
 */

type Portion = "full" | "health_account";

export function PayPanel({
  remaining,
  eligible,
  returnUrl,
}: {
  remaining: Cents;
  eligible: Cents;
  returnUrl: string;
}) {
  // Only a mix is a decision. If every line is eligible, or none is, there is
  // one sensible amount and asking about it is a question with one answer.
  const mixed = eligible > 0 && eligible < remaining;

  const [portion, setPortion] = useState<Portion | null>(mixed ? null : "full");

  const amount = portion === "health_account" ? eligible : remaining;
  const leftOver = (remaining - eligible) as Cents;

  if (portion === null) {
    return (
      <>
        <p className="eyebrow" style={{ margin: "2.25rem 0 0.9rem" }}>
          Amount due
        </p>
        <p className="answer">{formatUsd(remaining)}</p>

        <p className="muted" style={{ marginTop: "1.25rem", maxWidth: "34rem" }}>
          {formatUsd(eligible)} of this is eligible for HSA or FSA funds. The rest is not,
          so a health account card cannot cover all of it. Choose how you want to start.
        </p>

        <div style={{ display: "grid", gap: "0.9rem", marginTop: "2rem", maxWidth: "30rem" }}>
          <button type="button" className="btn" onClick={() => setPortion("health_account")}>
            Pay {formatUsd(eligible)} with a health account card
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setPortion("full")}>
            Pay the full {formatUsd(remaining)} with one method
          </button>
        </div>

        <p className="hint" style={{ marginTop: "1.5rem", maxWidth: "34rem" }}>
          Paying the eligible part first leaves {formatUsd(leftOver)} to settle with another
          method. Nothing is charged until you enter a card.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow" style={{ margin: "2.25rem 0 0.9rem" }}>
        Paying now
      </p>
      <p className="answer">{formatUsd(amount)}</p>

      {portion === "health_account" && (
        <p className="note" style={{ marginTop: "1.5rem" }}>
          This is the health account eligible portion. {formatUsd(leftOver)} will remain on
          the statement afterwards, payable with another method.
        </p>
      )}

      {mixed && portion === "full" && (
        <p className="note note-warn" style={{ marginTop: "1.5rem" }}>
          A health account card cannot cover this whole amount. Only{" "}
          {formatUsd(eligible)} of it is eligible.
        </p>
      )}

      <div className="panel" style={{ marginTop: "2.5rem" }}>
        {/* Keyed on the portion so a changed choice mounts a fresh checkout
            against a fresh intent, rather than reusing a client secret issued
            for a different amount. */}
        <Checkout key={portion} portion={portion} returnUrl={returnUrl} />
      </div>

      {mixed && (
        <p style={{ marginTop: "1.5rem" }}>
          <button
            type="button"
            onClick={() => setPortion(null)}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              font: "inherit",
              fontSize: "var(--fs-small)",
              color: "var(--accent-dark)",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            Change the amount
          </button>
        </p>
      )}
    </>
  );
}
