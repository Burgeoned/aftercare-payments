# Aftercare: design

Read `DOMAIN.md` first. This document turns the domain requirements into an
architecture. Every decision here cites the requirement it serves.

## 1. Scope

Build the post-adjudication patient responsibility flow end to end against the
Hyperswitch hosted sandbox:

> A patient looks up a statement, understands what insurance already paid, pays
> the residual balance with a card, health account card, or bank account, and the
> provider's ledger reflects the payment only after a verified webhook confirms
> it.

Plus one flow that most prototypes skip and this vertical cannot: a **partial
refund after re-adjudication**, routed back to the original tender.

`SCOPE.md` lists what is deferred and how each deferred piece would be built.

## 2. The decision everything else follows from

From `DOMAIN.md` section 2: the payer takes 15 to 45 days to adjudicate, and a
card authorization holds for about 7.

**Therefore authorization and collection are separated.** The prototype does not
attempt to hold funds across adjudication. The statement is generated after the
payer responds, and the payment is a fresh customer-initiated transaction against
a known amount.

`capture_method` is `automatic` for the core flow. Manual capture appears in the
codebase only where the domain actually calls for it, which is the same-day
estimate path, and that path is deferred.

This is the single most important thing to get right in this vertical, and it is
the thing a reviewer will probe first.

## 3. Integration approach

Hyperswitch offers three levels of integration. The choice is a compliance
decision before it is a convenience decision.

| Approach | PCI scope | Control over the page | Verdict |
|---|---|---|---|
| Payment Links (hosted page) | SAQ A | None. Hyperswitch renders the page | Rejected |
| Unified Checkout (web SDK) | SAQ A | Full control of surrounding page, SDK owns the card fields in an iframe | **Chosen** |
| Direct API / headless | SAQ D | Total | Rejected |

**Why not Payment Links.** In retail the checkout page is a formality. In
healthcare the bill explanation *is* the product. A patient who cannot see what
was charged, what insurance allowed, what insurance paid, and why the residual is
what it is will call the billing office instead of paying, or will dispute the
charge later. Handing that page to a hosted redirect gives away the part that
matters. Payment Links remain the right tool for the deferred collections and
guarantor flows, where the recipient has no account and the amount is fixed.

**Why not headless.** Direct API means card data transits our server, which moves
the provider from SAQ A to SAQ D. For a covered entity already carrying HIPAA
obligations, volunteering into full PCI scope to save a small amount of frontend
work is not a trade any provider would make.

**Unified Checkout** keeps the PAN inside a Hyperswitch-hosted iframe, so our
server only ever sees a payment id and a status. It also gets Apple Pay and
Google Pay as rendered buttons rather than two separate integrations, which
matters because most patients open statements on a phone.

## 4. System shape

```
  Browser                     Next.js (Vercel)                  Hyperswitch
  ---------------------       ---------------------------       -------------------
  Statement lookup    ---->   GET  /api/statements/:id
                              (our data, no PHI leaves)
       <----------------      statement + line items

  "Pay now"           ---->   POST /api/payments/intent
                                                        ---->   POST /payments
                                                                (amount, currency,
                                                                 customer_id,
                                                                 opaque metadata)
                                                        <----   payment_id,
                                                                client_secret
       <----------------      client_secret

  Hyperswitch SDK
  mounts, collects
  card in iframe,
  confirms directly   ------------------------------------->    confirm
  (PAN never touches our server)

  3DS redirect if required, returns to /pay/:id/return

                                                        <----   webhook
                              POST /api/webhooks/hyperswitch
                              verify HMAC-SHA512
                              apply state transition
                              mark statement paid

  Receipt             <----   GET  /api/statements/:id
```

Two things to notice.

**The browser confirms the payment directly with Hyperswitch, not through us.**
That is what keeps the PAN out of our infrastructure and PCI scope at SAQ A.

**The ledger updates on the webhook, not on the redirect.** The redirect tells us
the patient came back. It does not tell us money moved. A patient who closes the
tab after a successful payment must still end up with a paid statement, and a
patient who reaches the success page after a payment that later fails must not.

## 5. Payment state model

Hyperswitch payment statuses we handle:

```
requires_payment_method
        |
        v
requires_confirmation
        |
        v
requires_customer_action   (3DS challenge)
        |
        v
    processing
        |
   +----+----+
   v         v
succeeded  failed
```

Our statement carries its own state, deliberately not a mirror of the payment
status:

```
open --> payment_pending --> paid
  ^            |              |
  |            v              v
  +-------- failed      partially_refunded / refunded
```

The two are separate because a statement can have several payment attempts
against it, and because split tender produces one statement with two successful
payments. Collapsing them would make split tender unrepresentable.

## 6. Webhook handling

Confirmed against the Hyperswitch webhook documentation:

- Signature is **HMAC-SHA512** over the raw JSON payload, using the merchant's
  `payment_response_hash_key`.
- Delivered in the **`x-webhook-signature-512`** header. An HMAC-SHA256 variant
  exists at `x-webhook-signature-256`.
- Payload carries **`event_id`** for duplicate detection and **`updated`** for
  out-of-order handling.
- Event types we act on: `payment_succeeded`, `payment_failed`,
  `payment_processing`, `refund_succeeded`, `refund_failed`. Dispute and mandate
  events are received and logged but not acted on in the prototype.

Three rules the handler enforces:

1. **Verify before parse.** Compute the HMAC over the raw request body, compare
   in constant time, reject on mismatch. Next.js route handlers must read the raw
   body, not the parsed JSON, or the signature will not match.
2. **Idempotent on `event_id`.** Webhooks retry. Every event id is recorded and a
   repeat is acknowledged with 200 and discarded. Acknowledging a duplicate with
   an error causes an endless retry loop.
3. **Ordered by `updated`, not by arrival.** A `processing` event that arrives
   after a `succeeded` event must not walk the statement backwards. State
   transitions compare timestamps and refuse regressions.

## 7. HSA and FSA handling

Per `DOMAIN.md` section 5, this is BIN classification, not a connector
integration.

**What the prototype does:**

- Maintains a small BIN prefix table classifying a card as `health_account` or
  `standard`. Populated with the documented FSA and HSA test BIN ranges plus
  sandbox test cards mapped to each class.
- Classifies the tender at payment time and records `tender_class` on the
  payment record.
- Adapts the interface: line items on the statement are marked eligible or
  ineligible, and an ineligible total is shown when a health account card is
  selected.
- Constrains refunds. A payment made on a `health_account` tender can only be
  refunded to that same payment, never redirected.

**What the prototype does not do, and says so:**

- Real IIAS substantiation. Auto-substantiation requires SIGIS registration and
  a certified inventory system. The eligibility flags here come from a static
  fixture, and the doc states that plainly.
- Real balance checks. Health account balances live with the plan administrator
  and are not queryable at checkout. This is exactly why split tender exists as
  a fallback: the patient discovers the balance by having the card decline.

**The honest framing for the writeup:** correctly identifying that HSA and FSA
are a BIN and substantiation problem rather than a payment method is the domain
signal. Building a fake connector for it would have been the wrong answer.

## 8. Split tender

A single statement, two payment attempts, atomically reconciled.

```
Statement balance: $890.00
  Attempt 1: health account card, $340.00 -> succeeded
  Attempt 2: personal card,       $550.00 -> succeeded
  Statement: paid
```

Design constraints:

- The statement is not `paid` until the sum of succeeded payments equals the
  balance. Partial coverage leaves it `open` with a reduced remaining balance.
- If attempt 2 fails, attempt 1 stays succeeded. The patient owes $550, not
  $890. The prototype does not reverse attempt 1, because reversing a successful
  health account payment to force an all-or-nothing checkout is worse for the
  patient than leaving a partial payment in place.
- Remaining balance is derived from the payment records, never stored as a
  mutable field. A stored balance and a payment log will drift, and when they
  drift the patient is the one who finds out.

## 9. Refunds

The re-adjudication refund is the flow that distinguishes this vertical.

- Refunds are **partial by default**. The full-refund case is the exception.
- Refund destination is **constrained to the original payment**. Hyperswitch
  refunds reference a `payment_id`, which enforces this naturally. The tax
  constraint on HSA funds from `DOMAIN.md` section 5 is therefore satisfied by
  construction rather than by a rule we have to remember.
- On a split-tender statement, a refund has to choose which payment to draw
  from. The prototype refunds the health account payment last, because returning
  money to a personal card is unambiguously fine and returning it to a health
  account has tax consequences for the patient if done wrong.
- Refunds are driven by a simulated re-adjudication action in the provider view,
  not by a patient-facing button. Patients do not self-serve refunds on medical
  bills.

## 10. HIPAA posture

The rule from `CLAUDE.md`: no PHI reaches the processor.

| Field | What we send | What we never send |
|---|---|---|
| `description` | `Patient responsibility, statement 4471-A` | Procedure, diagnosis, department |
| `metadata` | `statement_ref`, opaque | Any clinical identifier, name, DOB, MRN |
| `statement_descriptor` | A neutral, recognizable provider name | Specialty or service line |
| `customer_id` | Opaque internal id | Name or email as the identifier |

The statement descriptor deserves its own note in the writeup. It has to be
recognizable enough to avoid a chargeback and generic enough that a line item on
a shared bank statement does not disclose that someone visited an oncology
clinic. The prototype uses the provider group name, not the service line, and
the doc explains the tradeoff.

## 11. Hyperswitch configuration

- **Connector:** Stripe in test mode, configured through the Hyperswitch
  dashboard with our own Stripe test API key. Confirmed: connector test
  credentials vary per connector and are supplied by the merchant.
- **Second connector if time allows:** a dummy connector, purely to demonstrate a
  routing rule and failover. The point is the routing configuration, not the
  second processor.
- **Routing rule to demonstrate:** amount-based. Balances over a threshold prefer
  ACH, which is the `DOMAIN.md` section 6 economics argument expressed as
  configuration rather than prose.
- **Risk controls:** enable the BIN blocklist and the card-testing guard. A
  public payment page reachable by statement number is a card-testing target, and
  saying so in the doc is worth more than the ten minutes it takes to turn on.

**To confirm at implementation time:** the exact server auth header name. The
API reference describes the secret key without naming the header. Verify against
the Postman collection or the dashboard before writing the client, rather than
assuming.

## 12. Data model

Deliberately small. Fixtures in memory or a single JSON file. No database, and
the writeup says why: the interesting complexity is in the payment state
machine, and a database would add operational surface without adding a single
insight about payments.

```
Provider        one, fixture
Patient         id, guarantor relationship, no clinical data
Statement       id, patient, service date, line items, payer adjustment,
                payer paid, patient responsibility, status
LineItem        description, charged, allowed, payer paid, patient owes,
                health_account_eligible
Payment         id, statement, hyperswitch_payment_id, amount, tender_class,
                status, created, updated
Refund          id, payment, amount, reason, hyperswitch_refund_id, status
WebhookEvent    event_id, type, updated, received, raw
```

`Payment` and `Refund` are append-only. Statement status is derived. That is the
`DOMAIN.md` section 8 requirement about ledgers not drifting, enforced by the
shape of the data rather than by discipline.

## 13. Internal API surface

```
POST /api/statements/lookup          lookup by statement ref + DOB
POST /api/payments/intent            create Hyperswitch payment, return client_secret
GET  /api/payments/:id               poll status, used only by the return page
POST /api/webhooks/hyperswitch       verified webhook sink, source of truth
POST /api/provider/readjudicate      simulate payer correction, issue partial refund
```

Five routes. The `intent` route is the only one that talks to Hyperswitch on the
happy path, because confirmation happens browser to Hyperswitch directly.

Statement lookup is a POST rather than the `GET /api/statements/:ref` this
section originally specified. A GET carrying a date of birth puts it in the URL,
and a URL is written to browser history, sent in the Referer header of every
subsequent request, and recorded in the access log of every proxy in between.
The lookup returns a signed, httpOnly access cookie scoped to one statement, so
the date of birth travels once and the statement page reads the cookie instead.
See `DECISIONS.md` D-012.

## 14. Failure modes we handle

| Failure | Response |
|---|---|
| Card declined | Show the normalized reason, offer a different method immediately. Per `DOMAIN.md` section 6 this is the highest-value error path in the vertical |
| 3DS abandoned | Statement returns to `open`, payment recorded as failed, no orphan state |
| Webhook never arrives | Return page polls payment status with a bounded backoff, then tells the patient the payment is confirming and will email a receipt. Never claims success it cannot verify |
| Duplicate webhook | Discarded on `event_id` |
| Out-of-order webhook | Rejected on `updated` timestamp comparison |
| Patient pays twice | Second attempt sees a zero remaining balance and is refused before an intent is created |
| Signature mismatch | 401, logged, no state change |

## 15. Open questions

1. ~~Exact server auth header name, see section 11.~~ Resolved: `api-key`
   carrying the secret key, with the merchant account inferred from the key.
   The path was resolved empirically rather than chosen, see `DECISIONS.md`
   D-007.
2. Whether ACH through the Stripe test connector supports a returned-payment
   simulation in sandbox. If not, ACH returns get described rather than
   demonstrated.
3. Whether Apple Pay renders in the sandbox SDK without domain verification. If
   it needs a verified domain, the wallet buttons are described rather than
   demonstrated.

Each of these resolves to either a built flow or a documented deferral. Neither
outcome is a problem as long as the doc is honest about which one happened.
