# Aftercare

A prototype patient billing and payment experience for US healthcare providers,
built on Juspay Hyperswitch.

This file is the working agreement for any AI agent or contributor touching this
repo. Read `docs/DESIGN.md` before writing code.

## What this is

A patient receives care. The provider bills the payer. The payer adjudicates and
returns an explanation of benefits. Whatever the payer does not cover becomes the
patient's responsibility, and the provider has to collect it. Aftercare is the
surface where that collection happens.

Scope is deliberately narrow: the post-adjudication patient responsibility flow,
end to end, against the Hyperswitch hosted sandbox.

## Order of work

1. `docs/DOMAIN.md` establishes what healthcare patient billing needs from payments.
2. `docs/DESIGN.md` turns that into an architecture.
3. `src/lib/domain/types.ts` is the interface contract. It is written before
   implementation and changes deliberately, not incidentally.
4. Implementation follows the contract.
5. `docs/DECISIONS.md` records every choice that a reviewer would ask about.

Do not skip ahead. If the design does not cover something, update the design
first.

## Hard rules

1. **No PHI reaches the payment processor.** Not in metadata, not in the
   statement descriptor, not in the payment description. Payments carry an opaque
   reference that resolves to clinical context only inside this application.
   This is a HIPAA constraint and it is not negotiable for convenience.
2. **No card data touches our server.** The Hyperswitch SDK collects and
   tokenizes card details in the browser. Our server sees a payment id and a
   status, never a PAN. This keeps PCI scope at SAQ A.
3. **Webhooks are the source of truth for payment state.** The browser redirect
   is a hint. A payment is settled when a verified webhook says so.
4. **Every webhook is signature-verified before it is trusted.** An unverified
   webhook is discarded, not processed optimistically.
5. **Money amounts are integers in the smallest currency unit.** Never floats.
   The type system enforces this via a branded `Cents` type.
6. **Payment state transitions are explicit.** No inferring status from the
   absence of a field.

## Code style

- TypeScript strict mode. No implicit `any`, no `any` without a written reason.
- `interface` for object shapes, `type` for unions and branded primitives.
- Comments explain why a thing is done, not what the line does.
- Modules have one job with clear inputs and outputs.
- Errors are specific. No bare catch-all that swallows a failure silently.

## Voice for docs

Plain declarative prose. No em dashes. Specific over impressive. Assume the
reader is a payments engineer who will ask a follow-up question about every
claim, and write so the follow-up is already answered.

## What this prototype is not

Not a production billing system. It does not integrate with a practice
management system, does not parse 835 remittance files, and does not implement
the full payment plan lifecycle. `docs/SCOPE.md` lists what was deferred and how
each deferred piece would be approached.
