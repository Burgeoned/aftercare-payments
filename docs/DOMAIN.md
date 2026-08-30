# What healthcare patient billing needs from payments

This document establishes the domain before any architecture. Everything in
`DESIGN.md` traces back to a requirement stated here.

## 1. The money path

A single episode of care produces two separate financial transactions, and only
the second one is a consumer payment.

```
Patient receives care
        |
        v
Provider submits claim (837) to payer
        |
        v
Payer adjudicates: allowed amount, deductible, coinsurance, denial
        |
        v
Payer remits (835) to provider and sends EOB to patient
        |
        v
Residual balance becomes PATIENT RESPONSIBILITY   <-- this is the payment
        |
        v
Provider bills patient, patient pays or does not
```

The consumer-facing payment is the last step. Everything upstream is business to
business and settles over rails that have nothing to do with card networks.

This matters because it produces the defining property of the vertical:

> **The provider does not know what the patient owes at the time of service.**

In retail, the amount is known before authorization. In healthcare, the amount is
determined by a third party, weeks after the service, and can be revised again
after that. Every architecture decision downstream follows from this.

## 2. The timeline problem

| Event | Typical elapsed time |
|---|---|
| Service rendered | Day 0 |
| Claim submitted | Day 1 to 5 |
| Payer adjudication | Day 15 to 45 |
| Patient statement issued | Day 30 to 60 |
| Patient pays | Day 45 to 120 |
| Payer reprocesses or corrects | Day 60 to 180, sometimes later |

A card authorization holds for roughly 7 days. Extended authorization products
stretch that, but nothing on the card networks holds for 45 days.

**The naive design is manual capture: authorize the estimate at check-in, capture
the real amount after adjudication. It does not work.** The auth expires long
before the payer responds. Any prototype that proposes it has not looked at the
timeline.

The correct pattern separates authorization from collection entirely:

- Vault the payment method at or before service, with explicit consent.
- Charge nothing, or charge only a known copay.
- After adjudication produces a real number, initiate a merchant-initiated
  transaction against the vaulted method, or send the patient a statement with a
  payment link.

Manual capture still has a legitimate home here, just a narrower one: same-day
scenarios where the final amount lands inside the auth window, such as a
pharmacy pickup or an elective cash-pay procedure priced from a good-faith
estimate.

## 3. Flows the industry needs

Ranked by how much collected dollar volume flows through them.

**1. Post-adjudication balance payment.** The patient gets a statement and pays
the residual. Highest volume, highest average ticket, and the flow most likely
to fail. This is the core flow.

**2. Payment plans.** Balances above roughly $500 are frequently paid in
installments. Requires a stored credential, a mandate with explicit patient
consent, a schedule, and retry logic when an installment fails. Involuntary
churn is severe: the population carrying medical debt is the population whose
cards decline.

**3. Point-of-service collection.** Copay at check-in. Small, known amount, low
risk. Easy flow, and the one most systems already handle.

**4. Pre-service estimates and prepayment.** The No Surprises Act requires a
good-faith estimate for uninsured and self-pay patients. Some providers collect
against it up front, which creates a refund obligation when the real number
lands lower.

**5. Refunds after re-adjudication.** The payer reprocesses, the patient
overpaid, money goes back. Almost always partial, and the destination is
constrained by how the patient paid.

**6. Guarantor billing.** The person paying is frequently not the patient. A
parent pays for a minor, an adult child pays for a parent. Payment identity and
clinical identity are different entities and must be modeled separately.

**7. Financial assistance and charity care.** A balance is reduced or written off
after the fact, sometimes after partial payment. Adjustments must be
distinguishable from refunds in the ledger, because they carry different
accounting and reporting treatment.

**8. Collections handoff.** After a defined sequence of failed attempts the
balance moves to an agency. Any payment link must either survive the handoff or
fail closed, never accept a payment for a balance that no longer belongs to the
provider.

## 4. Payment methods, US market

| Method | Why it matters here | Verdict |
|---|---|---|
| Credit and debit cards | Default expectation, universal | Required |
| HSA and FSA cards | Tax-advantaged health dollars, high intent to use | Required, see section 5 |
| ACH debit | Decisive economics on large balances, see section 6 | Required |
| Apple Pay and Google Pay | Most patients open statements on a phone. Removes manual card entry on a high-friction, high-abandonment page | Required |
| PayPal | Marginal in healthcare. Adds a connector for little lift | Defer |
| Klarna, Affirm, generic BNPL | Deliberately excluded, see below | Exclude |
| Healthcare lending (CareCredit, AccessOne) | The domain-appropriate version of financing. A separate underwriting relationship, not a checkout method | Out of scope, noted |

**On BNPL.** General-purpose buy-now-pay-later against medical debt is a live
regulatory question in the US. Medical debt already receives special treatment in
credit reporting, and applying a consumer lending product to a bill the patient
did not choose the price of invites scrutiny a provider does not want. Excluding
it is a domain judgment, not an oversight. Internal payment plans, where the
provider carries the balance without interest, serve the same patient need
without the exposure.

## 5. Constraints unique to this vertical

### HIPAA: the processor is not a covered entity

Payment metadata routinely carries an order description. In healthcare that
description becomes protected health information the moment it names a
procedure, a diagnosis, a department, or in some contexts a provider.

Two consequences:

1. **Payment records carry an opaque reference only.** The processor sees
   `Patient responsibility, statement 4471-A`. It never sees `MRI lumbar spine
   w/o contrast`. Clinical context resolves only inside the covered entity's own
   system.
2. **The statement descriptor is a design decision with a chargeback
   consequence.** It has to be recognizable enough that the patient does not
   dispute the charge, and generic enough that a line on a shared bank statement
   does not disclose a diagnosis. That is a real tension, and it gets resolved
   deliberately rather than by defaulting to the legal entity name.

### HSA and FSA are not a payment method

No processor exposes HSA or FSA as a distinct payment method, because they are
not one. They are ordinary Visa and Mastercard credentials issued against a
custodial account, identified by restricted BIN ranges, and accepted only at
merchants carrying health-related merchant category codes. Eligibility is
enforced in two places:

- **At authorization**, by MCC. A health MCC lets the auth through.
- **After authorization**, by IIAS substantiation. Merchants on the SIGIS
  inventory list auto-substantiate eligible items at the line level. Merchants
  not on it push the burden to the patient, who must submit a receipt to the
  plan administrator or have the distribution treated as taxable.

Three design consequences:

1. HSA and FSA support is a **BIN classification concern**, not a connector
   concern. The application recognizes the card, adapts the interface, and
   records the tender type. There is no separate integration to build.
2. **Split tender is a real requirement.** Health account balances are finite and
   frequently smaller than the bill. A patient with $340 in an FSA and an $890
   balance needs to pay part from each, which means two payment attempts against
   one balance, atomically reconciled.
3. **Refunds to an HSA must return to the originating HSA.** Returning health
   account funds to a personal card converts a qualified distribution into a
   taxable one. Refund destination is constrained by original tender, and that is
   an IRS constraint rather than a payments convention.

### Consent for stored credentials

Storing a card for a payment plan requires explicit, recorded, patient-facing
authorization: amount or amount range, frequency, duration, and how to cancel.
The consent record is an artifact that has to survive independently of the
processor, because it is the evidence in a dispute and it has to outlive any
decision to change processors.

## 6. Economics

Two numbers drive most of the architecture.

**Average ticket is high.** A retail basket is $40. A post-adjudication patient
balance is commonly $200 to $3,000. Interchange scales roughly with amount, so a
$1,200 balance paid by credit card costs the provider somewhere near $30 to $40
in fees. The same payment over ACH costs cents. At the margins a provider
actually operates at, steering large balances toward ACH is not an optimization.
It is the difference between collecting profitably and not.

The tension: ACH settles slowly and returns days later on insufficient funds, so
the provider trades fee savings for settlement risk and a return-handling flow.
Cards fail immediately and cleanly. ACH fails quietly, later, after the balance
was already marked paid.

**Authorization rates are poor.** Large charges on consumer debit cards, against
a population under financial stress, decline often. Every declined payment on a
medical bill has a high chance of never being retried by the patient, because
the statement is unpleasant and easy to set aside.

That makes retry strategy, decline-code handling, and offering a second method
immediately after a failure high-value work rather than polish.

## 7. Why an orchestration layer, specifically

An orchestration layer has to justify itself against integrating one processor
directly. For a provider organization the case is unusually strong.

1. **Processor plurality is the existing condition.** Health systems grow by
   acquisition. A system that absorbed four physician groups inherited four
   merchant relationships and four processors. Orchestration unifies the patient
   experience across that without renegotiating every contract first.
2. **Vault portability is the escape from lock-in.** Cards on file for payment
   plans are hostage to whichever processor holds them. A vault at the
   orchestration layer, with network tokenization, means changing processors does
   not mean asking thousands of patients to re-enter a card.
3. **Least-cost routing on regulated debit is real money.** Durbin-regulated
   debit can be routed across networks. At the ticket sizes in this vertical the
   savings justify the routing complexity.
4. **Failover has outsized value.** A patient who fails to pay a medical bill
   once often does not come back. Processor downtime does not defer revenue here,
   it loses it.
5. **Retry and recovery logic is centralized.** Decline-code normalization across
   processors is exactly the undifferentiated work a provider should not be
   writing.

## 8. What good looks like

A patient opens a statement on a phone, sees a bill they can understand,
recognizes what insurance already paid, pays with the health account card they
were already planning to use, and gets a receipt that will not confuse them when
it shows up on a bank statement six days later.

Nothing about that is technically exotic. It is unusual in this industry anyway,
and that is the whole opportunity.
