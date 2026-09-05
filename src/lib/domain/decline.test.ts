import { describe, expect, it } from "vitest";

import { classifyDecline, type DeclineInput } from "./decline";

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
