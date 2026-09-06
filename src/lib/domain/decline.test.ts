import { describe, expect, it } from "vitest";

import { classifyDecline, type DeclineInput } from "./decline";
import type { TenderClass } from "./types";

/**
 * A patient who is declined still owes the money. What this function says next
 * decides whether the provider collects it, so the tests are about the advice
 * rather than about the classification for its own sake.
 */

function input(over: Partial<DeclineInput> = {}): DeclineInput {
  return {
    unifiedCode: null,
    unifiedMessage: null,
    errorCode: null,
    errorMessage: null,
    tenderClass: "standard_card",
    ...over,
  };
}

describe("classifyDecline", () => {
  it("reads the connector code when the unified code is absent", () => {
    // unified_code is documented as not live yet, so the connector code is
    // what actually arrives today.
    const result = classifyDecline(input({ errorCode: "insufficient_funds" }));
    expect(result.category).toBe("insufficient_funds");
  });

  it("prefers to work from whatever it is given, including the message", () => {
    expect(classifyDecline(input({ errorMessage: "Your card has expired." })).category).toBe(
      "expired_card",
    );
  });

  it("treats a health account running out as its own case", () => {
    /**
     * The domain-specific one. The same decline code means something different
     * on a health account card, and the advice is different: the balance is
     * finite, so the answer is another method rather than another attempt.
     */
    const personal = classifyDecline(
      input({ errorCode: "insufficient_funds", tenderClass: "standard_card" }),
    );
    const health = classifyDecline(
      input({ errorCode: "insufficient_funds", tenderClass: "health_account" }),
    );

    expect(personal.category).toBe("insufficient_funds");
    expect(health.category).toBe("health_account_limit");
    expect(health.guidance).toContain("eligible portion");
    expect(health.retrySameMethod).toBe(false);
  });

  it("recognises an ineligible spend on a health account", () => {
    const result = classifyDecline(
      input({ errorCode: "transaction_not_allowed", tenderClass: "health_account" }),
    );
    expect(result.category).toBe("not_eligible");
  });

  it("only suggests retrying the same card when that could work", () => {
    // A mistyped security code is worth retrying. An empty account is not.
    expect(classifyDecline(input({ errorCode: "incorrect_cvc" })).retrySameMethod).toBe(true);
    expect(classifyDecline(input({ errorCode: "processing_error" })).retrySameMethod).toBe(true);
    expect(classifyDecline(input({ errorCode: "insufficient_funds" })).retrySameMethod).toBe(
      false,
    );
    expect(classifyDecline(input({ errorCode: "expired_card" })).retrySameMethod).toBe(false);
    expect(classifyDecline(input({ errorCode: "lost_card" })).retrySameMethod).toBe(false);
  });

  it("never repeats the connector's own wording back to the patient", () => {
    const raw = "Your card was declined. do_not_honor / issuer response 05";
    const result = classifyDecline(input({ errorMessage: raw }));

    expect(result.headline).not.toContain("do_not_honor");
    expect(result.guidance).not.toContain("05");
    expect(result.headline).not.toContain(raw);
  });

  it("says something useful when it recognises nothing at all", () => {
    const result = classifyDecline(input({ errorCode: "wat_is_this" }));

    expect(result.category).toBe("unknown");
    // Still tells the patient nothing was charged and what to do next, which is
    // the whole job. A shrug is not an acceptable output here.
    expect(result.guidance).toContain("Nothing has been charged");
    expect(result.guidance.length).toBeGreaterThan(40);
  });

  it("never blames the patient for a bank decision", () => {
    for (const code of ["insufficient_funds", "do_not_honor", "generic_decline", "lost_card"]) {
      const { headline, guidance } = classifyDecline(input({ errorCode: code }));
      const text = `${headline} ${guidance}`.toLowerCase();
      expect(text).not.toContain("you failed");
      expect(text).not.toContain("invalid card");
      expect(text).not.toContain("rejected");
    }
  });
});

describe("messages observed on real failed payments", () => {
  /**
   * Read off the sandbox account rather than invented. Three failed payments,
   * two distinct messages, and `error_code`, `issuer_error_code`,
   * `unified_code` and `unified_message` null on every one of them. The message
   * is the only signal, which is why these strings are pinned here: a change to
   * `categorise` that stops matching them is a regression nobody would
   * otherwise notice until a patient was told to retry a card that cannot work.
   */
  const only = (errorMessage: string, tenderClass: TenderClass | null = "standard_card") =>
    classifyDecline({
      unifiedCode: null,
      unifiedMessage: null,
      errorCode: null,
      errorMessage,
      tenderClass,
    });

  it("classifies a refused card as one that cannot be used, not as unknown", () => {
    const result = only(
      "We're unable to accept this card, please try another card or a different payment method",
    );

    expect(result.category).toBe("card_not_accepted");
    // The point of the category. "unknown" invites a retry that cannot succeed.
    expect(result.retrySameMethod).toBe(false);
  });

  it("classifies a plain decline as a bank decision", () => {
    expect(only("Payment declined: Card declined").category).toBe("insufficient_funds");
  });

  it("does not name the control that refused the card", () => {
    const { headline, guidance } = only("We're unable to accept this card");
    const copy = `${headline} ${guidance}`.toLowerCase();

    // Naming the control tells someone testing cards what to vary next.
    for (const word of ["blocklist", "blocked", "block", "fraud", "risk"]) {
      expect(copy).not.toContain(word);
    }

    // Offering a bank account as an alternative is fine and is the point. What
    // must not happen is attributing the refusal to the patient's bank, which
    // is what `card_blocked` says and is wrong here: it was refused before it
    // ever reached them.
    for (const phrase of ["your bank", "contact your bank", "issuer"]) {
      expect(copy).not.toContain(phrase);
    }
  });

  it("still reads unified fields first, for when they ship", () => {
    const result = classifyDecline({
      unifiedCode: "UE_9000",
      unifiedMessage: "expired_card",
      errorCode: null,
      errorMessage: "We're unable to accept this card",
      tenderClass: "standard_card",
    });

    expect(result.category).toBe("expired_card");
  });
});
