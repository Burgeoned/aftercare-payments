# Handoff: build brief

You are picking up a designed but unimplemented prototype. Design is done and it
is not up for renegotiation without a stated reason. Your job is to build it.

**Read in this order before writing code:** `CLAUDE.md`, `docs/DOMAIN.md`,
`docs/DESIGN.md`, `docs/SCOPE.md`, `src/lib/domain/types.ts`.

## What this is

A patient billing and payment prototype for US healthcare providers, built on
Juspay Hyperswitch. It is a submission for a Juspay interview round. It is judged
on payments domain judgment first, code second.

The design's load-bearing insight, in one line: **a card authorization holds
about 7 days, payer adjudication takes 15 to 45, so authorization and collection
must be separated.** If you find yourself proposing manual capture across
adjudication, stop and re-read `docs/DOMAIN.md` section 2.

## Environment state

Confirmed working:

- GitHub: https://github.com/Burgeoned/aftercare-payments, public, `main`
- Hyperswitch sandbox account exists. API key, publishable key, and payment
  response hash key are captured in `.env.local`, which is gitignored
- Stripe test account exists
- A connector is configured in the Hyperswitch dashboard

Outstanding before the webhook path can be tested end to end:

1. **Verify the connector is Stripe, not the dummy connector.** Dashboard →
   Connectors. Dummy connector payments expire after 2 days and cannot be
   refunded, which makes the partial refund flow undemonstrable. Stripe holding
   an `sk_test_` key is what is required.
2. **Profile id.** Dashboard → Settings → Business Profiles. Add to `.env.local`
   as `HYPERSWITCH_PROFILE_ID`.
3. **Vercel project.** Import the GitHub repo, capture the production URL.
4. **Register the webhook endpoint.** Dashboard → Developers → Payment Settings →
   Webhook Setup, pointed at `https://<vercel-url>/api/webhooks/hyperswitch`.

Local dev needs a tunnel for webhooks, or deploy-to-test. Prefer deploying early
and often over building a local tunnel setup.

## Confirmed API facts

Verified against the Hyperswitch docs. Do not re-derive these, and do not assume
anything beyond them.

- Sandbox base URL: `https://sandbox.hyperswitch.io`
- Payment creation: `POST /v1/payments`
- Statuses: `requires_payment_method`, `requires_confirmation`,
  `requires_customer_action`, `processing`, `succeeded`, `failed`, `cancelled`
- Manual capture: `capture_method: "manual"` yields `requires_capture`, then
  `POST /payments/{id}/capture`. **Not used in the core flow.** See above
- 3DS: `authentication_type: "three_ds"`, progresses
  `processing` to `requires_customer_action` to `succeeded`
- Vaulting: `setup_future_usage` of `on_session` or `off_session`, with a
  `customer_id`, returns a `payment_method_id`
- Webhook signature: **HMAC-SHA512** over the raw JSON body using the merchant's
  `payment_response_hash_key`, delivered in header **`x-webhook-signature-512`**.
  A SHA256 variant exists at `x-webhook-signature-256`
- Webhook payload carries **`event_id`** for duplicate detection and **`updated`**
  for out-of-order handling
- Events acted on: `payment_succeeded`, `payment_failed`, `payment_processing`,
  `refund_succeeded`, `refund_failed`

**Unresolved, resolve before writing the API client:** the exact HTTP header name
for server-side authentication with the secret key. The API reference describes
the key without naming the header. Check the Hyperswitch Postman collection or
the dashboard's code samples. Do not guess and do not ship a guess.

## Build order

Each step ends in something observable. Do not proceed past a failing gate.

**1. Scaffold.** Next.js App Router, TypeScript strict, Tailwind. No other
dependencies without asking. `npm run build` passes.

**2. One payment through the sandbox, however ugly.** A hardcoded amount, a
button, the Unified Checkout SDK, a `succeeded` status in the Hyperswitch
dashboard. This de-risks the entire week. Do it before any domain modeling.
*Gate: a real sandbox payment reaches `succeeded`.*

**3. Fixtures and statement lookup.** Implement against `types.ts`. Two or three
statements with realistic adjudication data: charged, allowed, payer paid,
patient owes. One statement large enough to be a payment plan candidate, one with
mixed health-account-eligible and ineligible lines. Guest lookup by statement ref
plus date of birth, no account creation.
*Gate: a statement renders with a comprehensible payer adjustment breakdown.*

**4. Real payment against a real statement.** `POST /api/payments/intent` creates
the Hyperswitch payment and returns `client_secret`. Browser confirms directly
with Hyperswitch. Amount comes from the derived balance, never from the client.
*Gate: paying a statement produces a succeeded payment for the right amount.*

**5. Webhooks as source of truth.** Verify HMAC over the **raw** body, not the
parsed JSON, or the signature will not match. Idempotent on `event_id`. Reject
transitions whose `updated` is older than what is recorded. Statement status is
derived from the payment log.
*Gate: a payment marks the statement paid only after a verified webhook. Replaying
a webhook changes nothing. An out-of-order webhook does not walk state backwards.*

**6. Domain flows.** Health account BIN classification and tender recording.
Split tender across two attempts. Partial refund via a provider-side
re-adjudication action. Decline handling that offers another method immediately.
*Gate: the split tender and partial refund scenarios both complete.*

**7. Risk controls.** Enable the BIN blocklist and card-testing guard in the
dashboard. A public payment page reachable by statement reference is a card
testing target. Note the configuration in `docs/DECISIONS.md`.

**8. Deploy and test cold.** Public URL, on a phone, with no local state.

## Hard invariants

Violating any of these is a defect, not a tradeoff.

1. **No PHI reaches the processor.** Not in `description`, `metadata`, or the
   statement descriptor. Payments carry an opaque statement reference.
2. **No PAN touches our server.** The SDK collects and confirms directly. Our
   server sees a payment id and a status.
3. **Webhooks are the source of truth.** The browser redirect is a hint. Never
   mark a statement paid from a redirect.
4. **Every webhook is signature-verified before it is trusted.**
5. **Money is `Cents`, an integer.** Never a float, never dollars.
6. **Amounts are server-derived.** A client-supplied amount is validated against
   the derived remaining balance, never trusted.
7. **`Payment` and `Refund` are append-only. Statement status is derived.**

## Log your decisions as you go

There is a deliverable that shares this AI session, so the reasoning has to exist
in writing rather than only in a transcript.

Maintain `docs/DECISIONS.md` as a running log. Append an entry whenever you make
a call a reviewer would ask about. Keep entries short:

```
## D-007: Statement descriptor uses the provider group name
Date: 2026-09-01
Decision: ...
Why: ...
Rejected alternative: ...
```

Include the decisions that went badly. A log where nothing was ever reconsidered
reads as fabricated, and the reviewer is a payments engineer who will know.

Also append to `docs/SCOPE.md` if something planned gets deferred during the
build. The deferral list is graded, and a deferral discovered while building with
a real reason attached is worth more than one predicted in advance.

## Exporting the sessions

One deliverable shares the AI sessions. `scripts/export-session.mjs` converts
this repo's Claude Code transcripts to readable Markdown:

```
npm run export-sessions
```

It reads `~/.claude/projects/<slug-of-this-repo>/*.jsonl`, so only sessions
started inside this repo are picked up and sessions from other projects cannot
leak in. It truncates tool output, and it redacts credential-shaped strings as a
safety net. The safety net is not permission to be careless: keys still never
belong in a session.

Run it at the end, then write `ai-sessions/README.md` pointing at the handful of
moments worth reading. The index is the deliverable. Nobody reads a raw
transcript, and "here is how I supervise a model" is what was actually asked for.

Review every exported file before committing it.

## Do not

- Do not write the 3-page architecture doc. That deliverable is explicitly
  self-written by the candidate, and this session's transcript is being shared.
  Producing that prose here would directly contradict the submission.
- Do not add dependencies without asking.
- Do not invent a Hyperswitch API field. If the docs do not confirm it, say so
  and stop.
- Do not build deferred flows from `docs/SCOPE.md`. They were deferred on
  purpose, and the reasoning is part of the submission.
- Do not put real keys in any committed file, in a code sample, or in chat.

## Voice

Plain declarative prose in docs and comments. No em dashes. Comments explain why,
not what. Specific over impressive.
