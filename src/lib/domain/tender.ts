import type { TenderClass, TenderDetail } from "./types";

/**
 * Health account recognition, at the BIN.
 *
 * No processor exposes HSA or FSA as a payment method, because it is not one.
 * They are ordinary Visa and Mastercard credentials issued against a custodial
 * account and identified by restricted IIN ranges. So this is a classification
 * problem in our application, not an integration problem at the connector. See
 * docs/DOMAIN.md section 5.
 *
 * The classification is what earns its keep downstream. It decides what the
 * checkout can tell a patient before they enter a card, it decides what the
 * receipt says, and it decides where a refund has to go, because returning
 * health account funds to a personal card converts a qualified distribution
 * into a taxable one. That last one is an IRS constraint, not a payments
 * convention.
 *
 * WHERE THIS TABLE COMES FROM, AND WHERE IT DOES NOT.
 *
 * The authoritative list of health benefit IIN ranges is published by the card
 * networks to SIGIS-registered merchants under licence. It is not public data
 * and it is not reproduced here. A production deployment subscribes to it and
 * refreshes it; the shape of the lookup does not change, only the contents.
 *
 * The ranges below are therefore a stand-in with two clearly separated parts,
 * and the separation is the point: nothing here is presented as a real BIN.
 * See docs/SCOPE.md item 3.
 */

interface BinRange {
  /** Inclusive lower bound, as a 6 digit IIN. */
  readonly from: number;
  /** Inclusive upper bound, as a 6 digit IIN. */
  readonly to: number;
  readonly note: string;
}

/**
 * Demonstration ranges, chosen so the flow can be exercised in the sandbox.
 *
 * The Mastercard test card `5555 5555 5555 4444` classifies as a health
 * account and the Visa test card `4242 4242 4242 4242` does not, which makes
 * split tender demonstrable with cards anyone can use. These are test BINs. In
 * the real world `555555` is not a health benefit range and this table would be
 * replaced wholesale.
 */
const DEMONSTRATION_RANGES: readonly BinRange[] = [
  { from: 555555, to: 555555, note: "Mastercard sandbox test BIN, demo health account" },
  { from: 400005, to: 400005, note: "Visa sandbox test BIN, demo health account" },
];

/**
 * The shape a licensed table takes: contiguous ranges within a network's IIN
 * space, matched on the first six digits, with eight digit ranges where a
 * network has subdivided a six digit block.
 *
 * Left empty rather than populated with plausible looking numbers. An invented
 * range that looks real is worse than an empty table, because it invites
 * someone to trust it.
 */
const LICENSED_RANGES: readonly BinRange[] = [];

const HEALTH_ACCOUNT_RANGES: readonly BinRange[] = [
  ...LICENSED_RANGES,
  ...DEMONSTRATION_RANGES,
];

/**
 * Classifies a card by its issuer identification number.
 *
 * Returns `standard_card` when the BIN is absent or unrecognised, which is the
 * safe direction: treating a health account card as standard means the patient
 * is offered no health-account-specific handling, while treating a standard
 * card as a health account would tell them funds are eligible when they are
 * not, and could route a refund on a false premise.
 */
export function classifyByBin(cardIsin: string | null): TenderClass {
  if (cardIsin === null) return "standard_card";

  const digits = cardIsin.replace(/\D/g, "");
  if (digits.length < 6) return "standard_card";

  const iin = Number(digits.slice(0, 6));
  if (!Number.isInteger(iin)) return "standard_card";

  const matched = HEALTH_ACCOUNT_RANGES.some((r) => iin >= r.from && iin <= r.to);
  return matched ? "health_account" : "standard_card";
}

/**
 * Builds the tender record for a payment.
 *
 * `paymentMethod` comes from the processor and settles card versus bank debit.
 * Only once it is a card does the BIN decide anything, because a bank account
 * has no IIN and asking the range table about one is a category error.
 */
export function classifyTender(input: {
  readonly paymentMethod: string | null;
  readonly cardIsin: string | null;
  readonly last4: string | null;
  readonly cardNetwork: string | null;
}): TenderDetail | null {
  const isBankDebit = input.paymentMethod === "bank_debit";
  const isCard = input.paymentMethod === "card" || input.cardNetwork !== null;

  if (!isBankDebit && !isCard && input.last4 === null) return null;

  if (isBankDebit) {
    return { class: "bank_debit", last4: input.last4, brand: input.cardNetwork };
  }

  return {
    class: classifyByBin(input.cardIsin),
    last4: input.last4,
    brand: input.cardNetwork,
  };
}

/** Patient-facing wording. Used on receipts and in checkout copy. */
export function describeTender(tender: TenderDetail | null): string {
  if (tender === null) return "Payment method not reported";

  const method =
    tender.class === "bank_debit"
      ? "Bank account"
      : tender.class === "health_account"
        ? "Health account card"
        : (tender.brand ?? "Card");

  return tender.last4 === null ? method : `${method} ending ${tender.last4}`;
}
