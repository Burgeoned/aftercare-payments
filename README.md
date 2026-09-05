# Aftercare

A prototype patient billing and payment experience for US healthcare providers,
built on [Juspay Hyperswitch](https://hyperswitch.io).

**Live:** https://aftercare-payments.vercel.app

Most payment prototypes assume the amount is known before the customer pays.
Healthcare does not work that way. The provider bills an insurer, the insurer
takes weeks to decide what it will cover, and only then does the patient learn
what they owe. Aftercare is the surface where that last step happens.

## The one thing this gets right

A card authorization holds for about seven days. Payer adjudication takes fifteen
to forty five.

That single mismatch invalidates the obvious design, which is to authorize an
estimate at check-in and capture the real amount once the claim clears. The
authorization expires long before the insurer answers. Authorization and
collection have to be separated entirely.

Everything else in this repo follows from that. See
[`docs/DOMAIN.md`](docs/DOMAIN.md) section 2.

## Try it

No account. Enter a statement reference and the matching date of birth.

| Statement | Date of birth | What it shows |
|---|---|---|
| `AFT-4021-8837` | `1988-03-14` | Paid, then partially refunded after a payer correction |
| `AFT-4108-2290` | `1975-11-02` | $927.00, mixed HSA eligibility, split tender |
| `AFT-3994-1177` | `1962-05-27` | $1,639.00, the payment plan candidate |

Sandbox test cards. `4242 4242 4242 4242` is an ordinary Visa.
`5555 5555 5555 4444` is recognised as a health account card, which is what
makes the split tender path appear on `AFT-4108-2290`. Any future expiry, any
CVC.

The billing office view is at [`/provider`](https://aftercare-payments.vercel.app/provider),
where a simulated payer correction issues a real partial refund.

## What is built

| Flow | Notes |
|---|---|
| Guest statement lookup | Reference plus date of birth, no account |
| Bill presentation with payer adjustment detail | Billed, plan rate, plan paid, residual, per line |
| Card payment via Unified Checkout | PAN never reaches this server |
| Health account recognition | BIN classification, not a payment method |
| Split tender | Pay the HSA-eligible portion, settle the rest separately |
| Verified webhook ingestion | HMAC-SHA512, idempotent, ordered |
| Partial refund after re-adjudication | Health account payments drawn from last |
| Decline handling | Normalized, actionable, tender-aware |

Deferred flows and the reasoning behind each are in
[`docs/SCOPE.md`](docs/SCOPE.md).

## Documentation

Read in this order.

| Document | What it covers |
|---|---|
| [`docs/DOMAIN.md`](docs/DOMAIN.md) | What healthcare patient billing needs from payments, before any architecture |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The architecture, and the requirement each decision serves |
| [`docs/SCOPE.md`](docs/SCOPE.md) | What was built, what was deferred, and how each deferred flow would be approached |
| [`src/lib/domain/types.ts`](src/lib/domain/types.ts) | The interface contract, written before implementation |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every call made during the build, including the ones that were wrong |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Why it looks like this, with the contrast ratios measured |
| [`HANDOFF.md`](HANDOFF.md) | Build brief: verified API facts, gated build order, invariants |
| [`ai-sessions/`](ai-sessions/) | The AI sessions that produced this, and an index of the moments worth reading |

## Notable decisions

- **Unified Checkout over hosted Payment Links.** In retail the checkout page is
  a formality. In healthcare the bill explanation is the product, and handing
  that page to a redirect gives away the part that matters. Payment Links remain
  the right tool for the deferred collections flow.
- **Webhooks are the source of truth, not the browser redirect.** A verified
  `x-webhook-signature-512` HMAC decides whether money moved. This stopped being
  theoretical when a misconfigured return URL sent a patient to a dead address
  after a payment that had already succeeded. The money was fine. See D-014.
- **HSA and FSA are treated as a BIN classification problem, not a payment
  method.** No processor exposes them as a distinct method because they are not
  one. They are ordinary card credentials on restricted BIN ranges.
- **The client names a portion, never an amount.** Validating a client-supplied
  amount is not enough: JSON parses `927.00` to the integer `927`, so a caller
  meaning $927 is charged $9.27 and every integer check passes. See D-015.
- **No protected health information reaches the processor.** Payments carry an
  opaque statement reference. Clinical context resolves only inside the
  application.
- **Buy-now-pay-later is deliberately excluded.** Applying general purpose
  consumer lending to a bill the patient did not choose the price of invites
  regulatory exposure a provider does not want.

## Running locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` needs a [Hyperswitch sandbox](https://app.hyperswitch.io) account
with a connector configured, a session signing secret, and Upstash Redis
credentials for the payment ledger. `.env.example` documents each and says why.

Webhooks cannot reach `localhost`, so the ledger only moves on a deployed
instance unless you tunnel. Deploying is easier.

```bash
npm run verify        # typecheck, lint, tests
npm run smoke         # resolve the sandbox API path against the live account
npm run export-sessions
```
