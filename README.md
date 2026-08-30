# Aftercare

A prototype patient billing and payment experience for US healthcare providers,
built on [Juspay Hyperswitch](https://hyperswitch.io).

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

## Documentation

Read in this order.

| Document | What it covers |
|---|---|
| [`docs/DOMAIN.md`](docs/DOMAIN.md) | What healthcare patient billing needs from payments, before any architecture |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The architecture, and the requirement each decision serves |
| [`docs/SCOPE.md`](docs/SCOPE.md) | What was built, what was deferred, and how each deferred flow would be approached |
| [`src/lib/domain/types.ts`](src/lib/domain/types.ts) | The interface contract, written before implementation |

## Notable decisions

- **Unified Checkout over hosted Payment Links.** In retail the checkout page is
  a formality. In healthcare the bill explanation is the product, and handing
  that page to a redirect gives away the part that matters. Payment Links remain
  the right tool for the deferred collections flow.
- **Webhooks are the source of truth, not the browser redirect.** A verified
  `x-webhook-signature-512` HMAC decides whether money moved. The redirect only
  tells us the patient came back.
- **HSA and FSA are treated as a BIN classification problem, not a payment
  method.** No processor exposes them as a distinct method because they are not
  one. They are ordinary card credentials on restricted BIN ranges with
  post-authorization substitution rules.
- **No protected health information reaches the processor.** Payments carry an
  opaque statement reference. Clinical context resolves only inside the
  application.
- **Buy-now-pay-later is deliberately excluded.** Applying general purpose
  consumer lending to a bill the patient did not choose the price of invites
  regulatory exposure a provider does not want.

## Status

Design complete. Implementation in progress.

## Running locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Requires a [Hyperswitch sandbox](https://app.hyperswitch.io) account with a
connector configured. Connector test credentials are supplied by the merchant
and vary per connector; this prototype targets Stripe in test mode. See
`.env.example` for the required variables.
