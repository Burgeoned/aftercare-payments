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

Current as of 2026-09-05. This section is the only record of state that lives
outside the repository, so it is kept accurate rather than historical.

**Deployed.**

- GitHub: https://github.com/Burgeoned/aftercare-payments, public, `main`
- Production: https://aftercare-payments.vercel.app, built from `main` on push
- Vercel builds from source. The Dockerfile is the dev environment, not the
  deploy path. See D-005

**Environment variables.** Ten, all documented in `.env.example`.

| Variable | Where it comes from |
|---|---|
| `HYPERSWITCH_API_KEY` | Dashboard, Developers, API Keys. Secret |
| `HYPERSWITCH_BASE_URL` | `https://sandbox.hyperswitch.io` |
| `NEXT_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY` | Dashboard. Public by design, inlined into the bundle |
| `HYPERSWITCH_PROFILE_ID` | Dashboard, Settings, Business Profiles |
| `HYPERSWITCH_WEBHOOK_SECRET` | The profile's payment response hash key |
| `AFTERCARE_SESSION_SECRET` | Generated. Signs guest access cookies, see D-013 |
| `AFTERCARE_STAFF_PASSWORD` | Chosen. Gates the provider console, see D-030. Validated separately from the rest so a missing console password cannot take down the patient path, see D-032 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Set by the Vercel Upstash integration. Never entered by hand, see D-013 |

`NEXT_PUBLIC_APP_URL` is the production URL on Vercel and `http://localhost:3000`
in development, and those must differ. It has no fallback in code for the reason in
D-014.

**Hyperswitch account state.**

- Connector configured with cards and ACH debit. ACH is enabled and has never
  been used, which `SCOPE.md` states rather than implying otherwise
- Webhook endpoint registered at
  `https://aftercare-payments.vercel.app/api/webhooks/hyperswitch`. The path
  matters: pointing it at the origin sends webhooks to a page rather than a
  route handler, and Hyperswitch retries a 404 for 24 hours before giving up
- Blocklist guard enabled, card BIN `411111` blocked as a demonstration. Neither
  demo card is in that range. See D-028
- **The connector is not the dummy one, established without checking.** A real
  partial refund settled against a real payment on 2026-09-04. Dummy connector
  payments cannot be refunded, so a successful refund answers the question the
  original version of this section asked somebody to verify by hand

**Verified end to end against the live sandbox.**

- Payment `pay_hz3mLO8GL41QrB5AgEN1`, $32.70, card, succeeded
- Refund `ref_gmey0mFKKTTx5cRWbhBa`, $12.70, partial, after re-adjudication
- Both moved the ledger only after a signature-verified webhook

Webhooks cannot reach `localhost`. The ledger only advances on a deployed
instance unless you tunnel, and deploying is easier.

## Confirmed API facts

Verified against the Hyperswitch docs. Do not re-derive these, and do not assume
anything beyond them.

- Sandbox base URL: `https://sandbox.hyperswitch.io`
- Payment creation: `POST /payments`. The quickstart documents `/v1/payments`; the
  API reference and this account use `/payments`, resolved empirically rather
  than chosen. See D-007
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

~~**Unresolved, resolve before writing the API client:** the exact HTTP header
name for server-side authentication.~~ **Resolved:** `api-key` carrying the
secret key, with the merchant account inferred from it. See `DESIGN.md` section
15.

## Build order

Each step ends in something observable. Do not proceed past a failing gate.

**1. Scaffold.** Next.js App Router, TypeScript strict, Tailwind. No other
dependencies without asking. `npm run build` passes.

**2. One payment through the sandbox, however ugly.** DONE, 2026-08-30.
Verified end to end: `/api/payments/intent` creates a real payment, the Unified
Checkout SDK mounts and renders Card and ACH Debit, and a test card payment
reached `succeeded` (`pay_iOpVKoaAvGIt6mEyaEe5`). The integration is no longer a
risk. *Gate passed.*

Two things learned here that the next steps depend on:

- The card fields live in an iframe nested inside the payment element iframe.
  Browser automation cannot type into them, so any end-to-end test of the
  confirmation step is manual. Plan test coverage around the server and webhook
  paths, which are automatable, rather than the SDK surface, which is not.
- Wallets do not render on `http://localhost`. Google Pay mounts at 0x0 and
  Apple Pay does not appear. Retest both on the Vercel URL before concluding
  anything about them.

**3. Fixtures and statement lookup.** DONE, 2026-09-03. Three statements, all
reconciling `allowed = payerPaid + patientOwes` under test: a $32.70 routine
visit, a $927.00 statement mixing health-account-eligible imaging with a
non-covered cosmetic line, and a $1,639.00 surgical balance standing in as the
payment plan candidate. Guest lookup by reference plus date of birth, no account,
with a missing reference and a wrong date of birth returning the same error so
the endpoint is not an oracle for valid references. *Gate passed:* the breakdown
renders billed, plan rate, plan paid, and patient residual per line.

Two things learned here that the next steps depend on:

- Lookup had to become a POST. A GET carrying a date of birth puts it in browser
  history, the Referer header, and every proxy log in between. See D-012.
- **In-memory mutable state does not survive a Next module boundary.** A route
  handler and a page importing the same module get different copies of its state
  in one process. Access grants are now stateless signed tokens, but the payment
  log has the same problem and it is unsolved. Step 5 cannot work until it is.
  See D-013. Resolve this before starting step 5, not during it.

**4. Real payment against a real statement.** DONE, 2026-09-04.
`POST /api/payments/intent` reads the statement from the access cookie rather
than the request body, derives the balance from the payment log, creates the
Hyperswitch payment and returns `client_secret`. Checkout lives at
`/statement/:ref/pay` and confirms browser to Hyperswitch directly. Verified:
an intent for `AFT-4108-2290` is created for exactly $927.00 with no amount
supplied, and requests without the cookie are refused with 401.

The `/pay` smoke test page was removed. Once the intent route is bound to a
statement, an unauthenticated payment path is a hole rather than a convenience.

One thing learned here that the next steps depend on:

- **A validated client amount is not safe.** `{"amount": 927.00}` created a
  927 cent payment against a $927.00 balance, because JSON parses it to the
  integer 927 and every check passes. The request now names a portion instead.
  See D-015. Any future endpoint that takes money should take a portion or a
  server-known quantity, never a number from a client.

**5. Webhooks as source of truth.** DONE, 2026-09-04. *Gate passed*, verified
against the running application with real signatures:

```
3. unsigned webhook            401, balance unchanged
4. verified payment_succeeded  applied, remaining 0, status paid
5. replay, same event_id       duplicate, balance unchanged
6. older updated, failed       stale, balance did not walk back
```

Signature is HMAC-SHA512 over the raw body in `x-webhook-signature-512`,
verified before the JSON is parsed. Idempotent on `event_id` with a 24 hour
claim, matching the retry window. Ordering compares the resource timestamp, and
the balance fold applies the same comparison again at read time.

One thing learned here that step 6 depends on:

- **The intent record must carry the processor's clock.** It carried ours, and
  every genuine webhook was rejected as stale. The create response does return
  `updated`, confirmed live. See D-018. Any record that will later be compared
  against a webhook has to be stamped from the same clock the webhook uses.
*Gate: a payment marks the statement paid only after a verified webhook. Replaying
a webhook changes nothing. An out-of-order webhook does not walk state backwards.*

Two things already in place that this step depends on:

- **The read side already collapses the log.** `deriveBalance` folds to one
  record per `hyperswitchPaymentId`, newest `updatedAt` winning, so appending a
  webhook row for a payment the intent route already wrote does not double count
  it. See D-017. Append a superseding row; never edit one.
- **Correlation needs an index and there is not one yet.** A webhook carries the
  Hyperswitch payment id, and the ledger is keyed by statement, so there is no
  way to find the statement without scanning. The payload does echo
  `metadata.statement_ref`, but resolving our own ledger through a field the
  processor round-tripped is fragile. Write
  `aftercare:payment-index:<hyperswitchPaymentId> -> statementId` at intent
  creation before starting this step.

Confirmed against the docs on 2026-09-04, beyond what is listed above: the
`event_id` duplicate window is 24 hours, and there are 18 event types rather
than the 5 listed here, including `payment_cancelled`, `payment_authorized`,
`payment_captured`, `action_required`, the full dispute lifecycle, and mandate
events.

**6. Domain flows.** Health account BIN classification and tender recording.
Split tender across two attempts. Partial refund via a provider-side
re-adjudication action. Decline handling that offers another method immediately.
*Gate: the split tender and partial refund scenarios both complete.*

**7. Risk controls.** A public payment page reachable by statement reference is a
card testing target. Note the configuration in `docs/DECISIONS.md`.

Correction to this step, verified against the docs on 2026-09-04: the blocklist
is configured by API, not in the dashboard, and there is no separate
card-testing guard. The blocklist toggle is the guard. It blocks three resource
kinds: card fingerprint, card BIN (6 digits), and extended card BIN (8 digits).

```
POST   /blocklist/toggle?status=true
POST   /blocklist
GET    /blocklist?data_kind=payment_method
DELETE /blocklist
```

A blocked payment fails with `HE_03`, "The payment is blocked".

DONE, 2026-09-05. The guard is enabled on the account and a demonstration BIN is
blocked. `/provider/risk` reads the blocklist live and derives card testing
signals from the payment log. One further correction, found by calling the API
rather than reading about it: the list endpoint's `data_kind` and the create
endpoint's `type` are different vocabularies for the same concept. See D-028.

**8. Deploy and test cold.** PARTIALLY DONE, 2026-09-05.

Verified against the production URL with no prior session:

```
/                                200
/statement/:ref                  307   grant required
/statement/:ref/pay              307
/statement/:ref/receipt          307
POST /api/payments/intent        401   no cookie
GET  /api/statements/status      401
POST /api/webhooks/hyperswitch   401   unsigned
cross-statement cookie           307   a grant opens one statement only
```

The full journey completes from a cold jar: lookup, statement, checkout. At a
375px viewport the document is 375px wide with zero horizontal overflow, the
statement table scrolls inside its own box, and the split tender chooser works.

**Not verified, and it should be before submitting.** The Hyperswitch payment
element did not render during the mobile pass. The cause is not this
application: `beta.hyperswitch.io`, which serves the SDK, returned 429 to the
test browser after a day of repeated loads. The same assets return 200 to a
clean client, and server-side API calls to the sandbox were unaffected. So the
card form on a phone remains untested rather than working or broken. Open it on
an actual handset once, which is what this step asked for anyway.

`DESIGN.md` section 15 open question 3, whether wallets render on a verified
HTTPS domain, is still open for the same reason.

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
6. **Amounts are server-derived.** ~~A client-supplied amount is validated
   against the derived remaining balance, never trusted.~~ **Corrected by
   D-015:** validation is not enough, because JSON parses `927.00` to the
   integer `927`. The client names a portion and sends no number at all.
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

## Working with subagents

Subagent turns are written into the same transcript file flagged
`isSidechain: true`. The exporter fences them into quoted blocks and counts them
separately, so they will be visible but clearly marked as delegated work.

That has a consequence worth planning around: **a subagent's reasoning is buried
where nobody will read it.** If a decision gets made inside a sidechain, it is
effectively undocumented.

So:

1. **Delegate investigation, not decisions.** A subagent is good for "find every
   place X is referenced" or "read these three doc pages and report the API
   shape." The call about what to do with the answer belongs in the main thread.
2. **Summarize every subagent result back into the main thread in your own
   words** before acting on it. One or two sentences. That is what a reader sees.
3. **Verify before trusting.** A subagent report is a claim, not a fact,
   especially about API shapes. `docs/DECISIONS.md` D-007 exists because a
   documented endpoint path disagreed with another documented endpoint path.
4. **Record the delegation in `docs/DECISIONS.md`** when it changed the outcome:
   what was delegated, what came back, what was done with it.

## Documenting as you go

One deliverable shares these sessions, so the reasoning has to survive outside
the transcript. Two rules.

**Write decisions down when you make them, not afterwards.** A decision
reconstructed at the end of the week is a rationalization. `docs/DECISIONS.md`
is append-only for that reason.

**Do not perform for the reader.** Do not narrate for an audience, do not
manufacture deliberation, and do not tidy away the parts where something was
wrong. Record the dead ends, the reversals, and the times a documented API turned
out not to match reality. A log in which every decision was correct on the first
try is not evidence of good judgment, it is evidence of editing, and the reader
is a payments engineer who will spot it immediately.

The honest version is also the strongest version. Write it that way and no
curation is needed later.

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
