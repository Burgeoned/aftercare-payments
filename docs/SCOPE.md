# Built, and deliberately not built

The brief asks for the core flow end to end, and for an honest account of what
was left out and how it would be approached. This is that account.

Deferral here means a decision, not an omission. Each entry states what it is,
why it did not make the cut, and what building it would actually involve.

## Built

Status is stated per row because this table was written as a plan and would
otherwise read as a claim. `Built` means it works end to end against the
sandbox. `Planned` means it is designed, argued, and not yet implemented, which
is a different thing from deferred: the deferrals are in the next section and
are not coming back.

| Flow | Status | Why it is the core |
|---|---|---|
| Statement lookup without an account | Built | Patients pay from a paper or emailed statement. Forcing account creation is the single largest source of abandonment in this vertical |
| Bill presentation with payer adjustment detail | Built | The explanation is the product. A patient who does not understand the residual calls the billing office or disputes the charge |
| Card payment via Unified Checkout | Built | The default path, and the one that sets PCI scope |
| Health account card recognition and tender classification | Built | The domain-specific behavior, handled where it actually lives, at the BIN |
| ACH debit as an alternative method | Connector configured, untested | The economics argument from `DOMAIN.md` section 6, made real |
| Split tender across two payment attempts | Built | Health account balances are finite. Without this, a patient with a partial FSA balance cannot pay at all |
| Verified webhook ingestion as source of truth | Built | Money state does not come from a browser redirect |
| Partial refund after simulated re-adjudication | Built | The flow that separates this vertical from retail |
| Decline handling with immediate alternative method | Built | Highest-value error path in the vertical |

## Deferred

### 1. Payment plans and dunning

**What it is.** Balances over roughly $500 get paid in installments against a
stored credential, with retries when an installment fails.

**Why deferred.** The vaulting and mandate half is a day of work on its own, and
the interesting half is the recovery logic, which cannot be meaningfully
demonstrated inside a sandbox in a week. Showing a schedule that never fires
proves nothing.

**How it would be built.** Vault at the first payment with
`setup_future_usage: "off_session"` and a `customer_id`, capture explicit
patient consent covering amount, frequency, duration, and cancellation, and
store that consent record outside the processor so it survives a processor
change. Charge installments as merchant-initiated transactions against the
returned `payment_method_id`. For recovery, use Hyperswitch's Revenue Recovery
module rather than writing retry logic: it already normalizes decline codes
across processors and schedules retries against them. The healthcare-specific
addition is that a failed installment cannot silently escalate to collections,
because the balance is frequently disputed rather than abandoned.

### 2. ACH return handling

**What it is.** ACH debits succeed at submission and can return days later for
insufficient funds or a closed account.

**Why deferred.** Depends on whether the sandbox connector can simulate a return.
See `DESIGN.md` section 15.

**How it would be built.** Treat ACH success as provisional. The statement moves
to a `settling` state rather than `paid`, and only reaches `paid` after the
return window closes. The webhook handler must be able to walk a statement
backwards out of `paid`, which is why the state machine already compares
`updated` timestamps rather than assuming forward progress. The patient-facing
consequence is that the receipt language differs for ACH, and the design would
say so on the receipt rather than pretending the two rails settle alike.

### 3. Real IIAS substantiation

**What it is.** Line-level auto-substantiation of health account eligibility at
the point of sale.

**Why deferred.** Requires SIGIS registration and a certified inventory system.
It is an organizational qualification, not an integration.

**How it would be built.** It would not be built by us. The provider registers,
and the eligibility flags come from the practice management system's procedure
catalog. Our layer's job is to carry the flags to the checkout and record the
tender class for the audit trail. The prototype uses fixture flags and says so.

### 4. Pre-service estimates and prepayment

**What it is.** The No Surprises Act good-faith estimate, sometimes collected up
front.

**Why deferred.** It is a second, differently-shaped flow, and it competes with
the core flow for build time without exercising anything new in Hyperswitch.

**How it would be built.** This is the one place manual capture belongs, and only
when the final amount lands inside the authorization window. Otherwise the
pattern is a zero-amount authorization to validate and vault the card, then a
customer-initiated charge once the estimate is finalized. The refund obligation
when the real number lands lower is already covered by the partial refund path
that is built.

### 5. Guarantor and family billing

**What it is.** The payer of the bill is not the patient.

**Why deferred.** It is an identity modeling problem more than a payments
problem, and modeling it badly is worse than deferring it.

**How it would be built.** Separate the payment identity from the clinical
identity at the data layer, which the model in `DESIGN.md` section 12 already
anticipates by keeping `Patient` free of clinical data and carrying a guarantor
relationship. The payments consequence is narrow: the Hyperswitch `customer_id`
attaches to the guarantor, because that is whose payment method is on file, while
the statement attaches to the patient. Getting that backwards means a saved card
follows the wrong person.

### 6. Dispute and chargeback workflow

**What it is.** Responding to a patient chargeback with evidence.

**Why deferred.** Sandbox dispute simulation is thin, and the interesting part of
this problem is not technical.

**How it would be built.** Hyperswitch surfaces `dispute_opened` and the rest of
the dispute lifecycle as webhook events, and provides a unified dispute interface
across processors. The prototype receives and logs those events already. The hard
part is healthcare-specific and worth stating: the natural evidence that a
service was rendered is clinical documentation, which cannot be sent to a
processor. Evidence has to be assembled from non-clinical artifacts, meaning
proof of statement delivery, payment authorization records, and the consent
record. This is a strong argument for investing in the statement descriptor,
because the cheapest chargeback is the one the patient never files.

### 7. Collections handoff

**What it is.** Moving an uncollected balance to an agency.

**Why deferred.** Mostly a business process with a small payments surface.

**How it would be built.** The payments requirement is that the payment path must
fail closed once the balance leaves the provider. A statement in a
`transferred` state refuses intent creation outright rather than accepting money
for a balance the provider no longer owns. Payment Links, rejected for the core
flow in `DESIGN.md` section 3, are the right tool here, because the recipient has
no session and the amount is fixed.

### 8. Practice management integration

**What it is.** Real statements sourced from 837 claims and 835 remittances
instead of fixtures.

**Why deferred.** It is EDI integration work with no payments content.

**How it would be built.** An ingestion job maps 835 remittance advice into
statement line items, with the payer adjustment and patient responsibility
columns coming straight from the claim adjustment reason codes. Worth noting
because it is where the fixture data in this prototype would actually come from,
and because the shape of `LineItem` in `DESIGN.md` section 12 was chosen to match
what an 835 provides rather than invented.

### 9. Rate limiting on statement lookup

**What it is.** A limit on how many reference and date of birth combinations one
caller may try.

**Why deferred.** Found during the build rather than predicted, and it is
infrastructure rather than payments. It is listed because it is the one gap in
this prototype that would matter on the first day of real traffic, not because
it was a considered omission.

**How it would be built.** Two counters, one per source address and one per
statement reference, with the per-reference counter mattering more: an attacker
distributing an attack across addresses is still funnelling it at one statement.
On Vercel this needs the same shared store that the payment log needs, see
`DECISIONS.md` D-013, which is a good reason to solve both at once. The
public payment page is also a card testing target independently of lookup, which
build step 7 addresses in the Hyperswitch dashboard rather than here.

### 10. Authentication on the provider console

**What it is.** Staff authentication and an audit trail on
`/api/provider/readjudicate` and the page that drives it.

**Partially built, 2026-09-05, and the original deferral was wrong.** This entry
used to argue that leaving the console open and saying so was more honest than a
password field proving nothing. That reasoning is sound about fake logins and
was applied to the wrong thing: the endpoints issue refunds and toggle the
merchant's fraud guard, and they were reachable by anyone on the deployed URL. A
deferral describes something not built. That was something exposed. See D-030.

There is now a shared staff password exchanged for a signed session. What
remains deferred is below, and it is deferred rather than open.

**How the rest would be built.** Provider staff are employees, so per-user
identity is SSO against the practice's identity provider rather than a shared
password, with the acting user written into the correction record. That record is already stored
separately from the statement, so attributing it costs one field. The audit
requirement is the real one: a correction that moves money needs to say who
applied it and on what remittance.

## The general principle

Everything built exercises something specific about payments in this vertical.
Everything deferred is either a second instance of a pattern already
demonstrated, an organizational qualification rather than an integration, or a
flow whose interesting behavior cannot be observed inside a sandbox in a week.
