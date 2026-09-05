import type { TenderClass } from "./types";

/**
 * Turns a processor decline into something a patient can act on.
 *
 * This is the highest-value error path in this vertical. A retail customer who
 * is declined abandons a basket. A patient who is declined still owes the
 * money, and what happens next decides whether the provider collects it or
 * writes it off. See docs/DOMAIN.md section 6.
 *
 * Two rules shape the wording. It never implies the patient did something
 * wrong, because a medical bill arriving after the fact is already an
 * unpleasant surprise and a decline reads as an accusation if you let it. And
 * it always says what to do next, because "your card was declined" with no
 * suggestion is where collection stops.
 *
 * ON HYPERSWITCH'S UNIFIED CODES. The API carries `unified_code` and
 * `unified_message`, which are normalized across connectors and are exactly
 * what this module would rather consume. The source marks both as "not live
 * yet". They are read here when present, and the mapping below is the fallback
 * that does the work until they ship. When they do, most of this becomes
 * deletable, which is the intended direction.
 */

const CATEGORIES: ReadonlySet<string> = new Set([
  "insufficient_funds",
  "health_account_limit",
  "not_eligible",
  "expired_card",
  "incorrect_details",
  "card_blocked",
  "processing_error",
  "unknown",
]);

export type DeclineCategory =
  | "insufficient_funds"
  | "health_account_limit"
  | "not_eligible"
  | "expired_card"
  | "incorrect_details"
  | "card_blocked"
  | "processing_error"
  | "unknown";

export interface DeclineGuidance {
  readonly category: DeclineCategory;
  /** Patient-facing. Never the connector's own wording. */
  readonly headline: string;
  readonly guidance: string;
  /** Whether trying the same card again could plausibly work. */
  readonly retrySameMethod: boolean;
}

export interface DeclineInput {
  readonly unifiedCode: string | null;
  readonly unifiedMessage: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly tenderClass: TenderClass | null;
}

function categorise(haystack: string): DeclineCategory {
  const has = (...needles: string[]) => needles.some((n) => haystack.includes(n));

  if (has("insufficient", "not_sufficient", "nsf")) return "insufficient_funds";
  if (has("expired")) return "expired_card";
  if (has("incorrect_cvc", "invalid_cvc", "incorrect_number", "invalid_number", "incorrect_zip"))
    return "incorrect_details";
  if (has("lost_card", "stolen_card", "pickup_card", "restricted_card", "blocked"))
    return "card_blocked";
  if (has("processing_error", "try_again", "issuer_unavailable", "processing"))
    return "processing_error";
  if (has("declined", "do_not_honor", "generic_decline", "transaction_not_allowed"))
    return "insufficient_funds";

  return "unknown";
}

/**
 * Parses a stored category back into guidance.
 *
 * The ledger stores the category rather than the sentence, so the wording can
 * be improved without rewriting history, and a record written months ago still
 * renders in today's language.
 */
export function isDeclineCategory(value: string | null): value is DeclineCategory {
  return value !== null && CATEGORIES.has(value);
}

export function classifyDecline(input: DeclineInput): DeclineGuidance {
  const haystack = [input.unifiedCode, input.errorCode, input.unifiedMessage, input.errorMessage]
    .filter((v): v is string => v !== null)
    .join(" ")
    .toLowerCase();

  let category = categorise(haystack);
  const isHealthAccount = input.tenderClass === "health_account";

  /**
   * A health account card declining for funds means something different from a
   * personal card declining for funds, and the advice is different too. The
   * balance in the account is finite and often smaller than the bill, so the
   * answer is not "try again later", it is "pay what the account covers and
   * settle the rest another way". See docs/DOMAIN.md section 5.
   */
  if (isHealthAccount && category === "insufficient_funds") {
    category = "health_account_limit";
  }

  if (isHealthAccount && haystack.includes("not_allowed")) {
    category = "not_eligible";
  }

  return guidanceFor(category);
}

export function guidanceFor(category: DeclineCategory): DeclineGuidance {
  switch (category) {
    case "health_account_limit":
      return {
        category,
        headline: "Your health account did not cover this amount",
        guidance:
          "HSA and FSA balances are often smaller than a bill. Pay the eligible portion " +
          "from the health account if you have not already, and settle the rest with " +
          "another card or a bank account.",
        retrySameMethod: false,
      };

    case "not_eligible":
      return {
        category,
        headline: "This charge is not eligible for health account funds",
        guidance:
          "Health accounts can only pay for qualifying medical costs, and part of this " +
          "statement does not qualify. Use another card or a bank account for it.",
        retrySameMethod: false,
      };

    case "insufficient_funds":
      return {
        category,
        headline: "Your bank did not approve this payment",
        guidance:
          "This is usually a limit or a balance on the bank's side rather than anything " +
          "wrong with the card. Another card or a bank account will often work, and you " +
          "can also pay part of the balance now and the rest later.",
        retrySameMethod: false,
      };

    case "expired_card":
      return {
        category,
        headline: "That card has expired",
        guidance: "Use a card with a current expiry date, or pay from a bank account.",
        retrySameMethod: false,
      };

    case "incorrect_details":
      return {
        category,
        headline: "Some of the card details did not match",
        guidance:
          "Check the number, expiry, security code and billing ZIP code, then try again. " +
          "Nothing has been charged.",
        // The one category where the same card genuinely is the right answer.
        retrySameMethod: true,
      };

    case "card_blocked":
      return {
        category,
        headline: "Your bank blocked this card",
        guidance:
          "Contact your bank if this is unexpected. In the meantime another card or a " +
          "bank account will work.",
        retrySameMethod: false,
      };

    case "processing_error":
      return {
        category,
        headline: "The payment could not be completed just now",
        guidance:
          "This was a problem reaching your bank rather than a decision by it. Trying " +
          "again usually works. Nothing has been charged.",
        retrySameMethod: true,
      };

    case "unknown":
      return {
        category,
        headline: "That payment did not go through",
        guidance:
          "Nothing has been charged. You can try the same method again or use a " +
          "different one. If it keeps failing, the billing office can take the payment " +
          "another way.",
        retrySameMethod: true,
      };
  }
}
