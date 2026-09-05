import { describe, expect, it } from "vitest";

import { classifyByBin, classifyTender, describeTender } from "./tender";

/**
 * The classification decides what a patient is told about their own funds and,
 * later, where a refund is allowed to go. Returning health account money to a
 * personal card turns a qualified distribution into a taxable one, so a wrong
 * answer here has a tax consequence rather than a cosmetic one.
 */

describe("classifyByBin", () => {
  it("recognises a health account range", () => {
    expect(classifyByBin("555555")).toBe("health_account");
    expect(classifyByBin("400005")).toBe("health_account");
  });

  it("reads only the first six digits of a longer BIN", () => {
    // card_extended_bin is eight digits. The six digit range still decides.
    expect(classifyByBin("55555500")).toBe("health_account");
    expect(classifyByBin("42424200")).toBe("standard_card");
  });

  it("treats an unrecognised BIN as a standard card", () => {
    expect(classifyByBin("424242")).toBe("standard_card");
    expect(classifyByBin("510510")).toBe("standard_card");
  });

  it("fails towards standard_card on missing or malformed input", () => {
    /**
     * The safe direction. Calling a health account card standard means the
     * patient is offered no special handling; calling a standard card a health
     * account tells them funds are eligible when they are not.
     */
    expect(classifyByBin(null)).toBe("standard_card");
    expect(classifyByBin("")).toBe("standard_card");
    expect(classifyByBin("42")).toBe("standard_card");
    expect(classifyByBin("abcdef")).toBe("standard_card");
  });
});

describe("classifyTender", () => {
  it("classifies a health account card from its BIN", () => {
    const tender = classifyTender({
      paymentMethod: "card",
      cardIsin: "555555",
      last4: "4444",
      cardNetwork: "Mastercard",
    });

    expect(tender).toStrictEqual({
      class: "health_account",
      last4: "4444",
      brand: "Mastercard",
    });
  });

  it("classifies an ordinary card", () => {
    const tender = classifyTender({
      paymentMethod: "card",
      cardIsin: "424242",
      last4: "4242",
      cardNetwork: "Visa",
    });

    expect(tender?.class).toBe("standard_card");
  });

  it("never asks the BIN table about a bank account", () => {
    // A bank account has no IIN, so the range lookup is a category error.
    const tender = classifyTender({
      paymentMethod: "bank_debit",
      cardIsin: "555555",
      last4: "6789",
      cardNetwork: null,
    });

    expect(tender?.class).toBe("bank_debit");
  });

  it("returns null when the processor reported no method at all", () => {
    expect(
      classifyTender({ paymentMethod: null, cardIsin: null, last4: null, cardNetwork: null }),
    ).toBeNull();
  });

  it("still classifies when payment_method is absent but a card network is present", () => {
    const tender = classifyTender({
      paymentMethod: null,
      cardIsin: "555555",
      last4: "4444",
      cardNetwork: "Mastercard",
    });

    expect(tender?.class).toBe("health_account");
  });
});

describe("describeTender", () => {
  it("names a health account card as one", () => {
    expect(
      describeTender({ class: "health_account", last4: "4444", brand: "Mastercard" }),
    ).toBe("Health account card ending 4444");
  });

  it("uses the network for an ordinary card", () => {
    expect(describeTender({ class: "standard_card", last4: "4242", brand: "Visa" })).toBe(
      "Visa ending 4242",
    );
  });

  it("names a bank account", () => {
    expect(describeTender({ class: "bank_debit", last4: "6789", brand: null })).toBe(
      "Bank account ending 6789",
    );
  });

  it("says so when the processor reported nothing", () => {
    expect(describeTender(null)).toBe("Payment method not reported");
  });
});
