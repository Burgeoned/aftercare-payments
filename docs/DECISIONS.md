# Decision log

Appended to during the build. Each entry records a call a reviewer would ask
about, why it was made, and what was rejected.

Entries that were later reversed stay in the log with the reversal recorded
underneath. A decision log where nothing was ever reconsidered is not a record of
thinking, it is a record of writing things down afterwards.

Decisions made before implementation are already argued in `DOMAIN.md`,
`DESIGN.md`, and `SCOPE.md` and are not duplicated here. This file starts at the
first line of code.

---

## D-001: npm lifecycle scripts are disabled repo-wide

Date: 2026-08-30

**Decision.** `.npmrc` sets `ignore-scripts=true`.

**Why.** `@juspay-tech/hyper-js` depends on `rescript`, because the Hyperswitch
web SDK is written in ReScript. The `rescript` postinstall spawns a bundled
`ninja.exe` and fails on a Windows host:

```
Error getting ninja version. The ninja binary at
node_modules/rescript/win32/ninja.exe may not be compatible with this platform:
Error: spawnSync ... UNKNOWN
```

Nothing in this project compiles ReScript. The published SDK ships compiled
artifacts in `dist/` and resolves correctly through its `exports` map with the
postinstall skipped, verified by importing it and confirming `loadHyper` is
exported. Disabling lifecycle scripts makes installs behave identically on
Windows, in the Linux dev container, and in CI.

**Rejected alternative.** Loading the SDK from a CDN script tag instead of npm.
That works and sidesteps the problem, but it gives up type definitions and
version pinning, and it hides a real integration constraint rather than
recording it.

**Worth reporting to Juspay.** This is a genuine friction point in the web SDK
on Windows, and a team wants to hear about it.

---

## D-002: a local declaration shim for @juspay-tech/react-hyper-js

Date: 2026-08-30

**Decision.** `src/types/react-hyper-js.d.ts` declares the module surface this
prototype uses.

**Why.** The published package (2.3.0) sets `main: dist/bundle.js` and ships no
`types` field and no `.d.ts`. Under `strict` it resolves as an implicit any and
the build fails. Its sibling `@juspay-tech/hyper-js` (2.1.0) does ship types at
`dist/index.d.ts` through its exports map and needs no shim.

The shim declares only what is used: `HyperElements`, `UnifiedCheckout`,
`useHyper`, `useWidgets`, and the `confirmPayment` signature.

**Rejected alternative.** Declaring the module as `any`. That compiles and is one
line, but it removes type checking from the single integration point most likely
to break, which is exactly backwards. A narrow honest shim fails at compile time
when the API is used wrongly. `any` fails in a patient's browser.

---

## D-003: eslint-config-next is used as a native flat config

Date: 2026-08-30

**Decision.** `eslint.config.mjs` spreads `eslint-config-next/core-web-vitals`
directly. `@eslint/eslintrc`'s `FlatCompat` was removed.

**Why.** Version 16 of the config exports a flat config array. Wrapping it in
`FlatCompat` throws a circular-structure error inside the eslintrc validator.
The compat shim exists for legacy `.eslintrc` configs and this is not one.

---

## D-004: TypeScript pinned to 6.x

Date: 2026-08-30

**Decision.** `typescript@^6` rather than `@latest`.

**Why.** `npm install typescript@latest` resolved 7.0.2, and typescript-eslint
does not yet support TS 7:

```
Error: typescript-eslint does not support TS 7.0.
```

Typecheck itself passed on TS 7. Only linting broke. Pinning to 6.x keeps the
whole toolchain working. Revisit once typescript-eslint ships TS 7 support.

**Rejected alternative.** Dropping the TypeScript ESLint rules to stay on 7. Those
rules catch more than the version bump is worth on a one-week prototype.

---

## D-005: Docker is the dev environment, not the deploy path

Date: 2026-08-30

**Decision.** `Dockerfile.dev` and `docker-compose.yml` provide a Linux dev
container. Deployment remains Vercel building from source.

**Why.** Vercel does not build a project's Dockerfile, so containerizing for
deploy would be decoration. The container earns its place for a different
reason: per D-001 the SDK's dependency chain misbehaves on Windows, and a Linux
container gives every contributor and every agent an identical working
environment regardless of host OS. `node_modules` is kept in the image rather
than bind-mounted, so a Windows host's install cannot shadow the Linux one.

**Rejected alternative.** Running the full Hyperswitch stack locally with the
project's own compose file. Technically interesting, but the brief says to use
the hosted sandbox, and doing otherwise would read as not following instructions.

---

## D-006: the return page does not assert that a payment succeeded

Date: 2026-08-30

**Decision.** `/pay/return` renders the redirect status and explicitly labels it
as unverified.

**Why.** The redirect only tells us the patient came back. Money state comes from
a signature-verified webhook, which lands in build step 5. Writing this page as a
success screen now would mean writing it wrong and rewriting it later, and in the
interim it would claim something it cannot know.

**Rejected alternative.** Polling `GET /payments/:id` from the return page and
showing the real status. That is closer to correct and is what step 5 adds as a
fallback, but it still is not the source of truth, and building it before the
webhook path exists would invert the dependency the whole design rests on.

---

## D-007: the payments path is resolved empirically, not chosen

Date: 2026-08-30

**Decision.** `scripts/smoke.mjs` tries `/payments` and then `/v1/payments` and
reports which one the account answers on.

**Why.** The Hyperswitch quickstart documents `POST /v1/payments` while the API
reference curl example uses `POST /payments`. Rather than pick one and discover
the mistake at runtime, the smoke test resolves it against the live sandbox
before any application code depends on the answer. The client currently uses
`/payments`, matching the API reference.

---

## D-008: ACH debit, not ACH credit transfer

Date: 2026-08-30

**Decision.** The connector enables ACH under Bank Debit. The ACH listed under
Bank Transfer is left off, as is the entire Bank Redirect group.

**Why.** They are different rails despite sharing a name. Bank Debit ACH is a
pull: the patient authorizes once and the provider initiates. Bank Transfer ACH
is a push: the patient is shown bank details and moves the money themselves.

Push is wrong for patient billing twice over. It sends the patient into their
banking app to finish paying a medical bill, which is where an unpleasant task
gets abandoned. And it converts collection into a reconciliation problem,
matching unattributed incoming funds to a balance, which is precisely the drift
the derived-status model in `DESIGN.md` section 12 exists to prevent.

Bank Redirect is entirely European: iDEAL, Giropay, EPS, Bancontact, Przelewy24,
Multibanco. Same for Bacs and Sepa. The brief scopes this to the US market.

**Final connector configuration.** Cards and ACH debit, plus Apple Pay and Google
Pay once the app is on a verified HTTPS domain. Nothing else was enabled merely
because it was available, and BNPL was left off deliberately per `DOMAIN.md`
section 4 rather than by omission.

---

## D-009: the SDK confirmation step is not end-to-end testable in automation

Date: 2026-08-30

**Observation, not a choice.** Hyperswitch nests a per-field iframe inside the
payment element iframe to isolate card entry. Clicks focus the outer frame and
keyboard events do not route into the inner one, so a browser automation harness
cannot fill the card form. Verified at two viewport scales to rule out a
coordinate mismatch.

**Consequence for testing.** Automated coverage targets the server and webhook
paths: intent creation, signature verification, idempotency on `event_id`,
ordering on `updated`, and balance derivation. The confirmation step is verified
manually and documented as such. Writing a brittle harness against a
deliberately isolated iframe would be effort spent fighting a security control.

**Worth saying out loud:** the thing that blocked the test is the same thing that
keeps PCI scope at SAQ A. The isolation is the feature.

**First successful payment.** `pay_iOpVKoaAvGIt6mEyaEe5`, $1.00, card, reached
`succeeded` on 2026-08-30.

---

## D-010: tool results are not operator prompts

Date: 2026-09-02

**Defect, found while reviewing an export.** `scripts/export-session.mjs`
counted every user-role message as a prompt. Claude Code returns tool results as
user-role messages carrying `tool_result` blocks, so the exporter reported 151
operator prompts for a session that actually had 17, and rendered every build
log as its own numbered heading.

**Fix.** A user-role message whose content is entirely `tool_result` blocks is
attached to the assistant turn above it and not counted.

**Why it matters more than a formatting bug.** The prompt count is the one
number a reader of a shared session will draw a conclusion from, and the wrong
number overstated hand direction by roughly ten times. The corrected figure is
also the better one: 17 prompts produced the domain analysis, the design, the
type contract, the scaffold, and a live sandbox payment.

---

## D-011: the design session's transcript is exported with --project and --from

Date: 2026-09-02

**Problem.** Claude Code files a transcript under the working directory the
session ran in, not the repo it produced. The session that wrote `DOMAIN.md`,
`DESIGN.md`, `types.ts`, the scaffold, and D-001 through D-009 ran from
`~/dev/job-hunt-lockin-2026`, so its transcript is filed there. Running
`npm run export-sessions` in this repo found only the session that noticed the
problem. The deliverable had no source material where the tool looked.

**Decision.** The exporter takes `--project` to name another transcript
directory and `--from` to begin at a given operator prompt. It prints a warning
when reading outside this repo's directory, because the working-directory
default is a safety property rather than a convenience.

**Why `--from` rather than editing the file.** That session's first prompt
carries job-hunt context that does not belong in a public repo, including
compensation history and preparation notes for a different employer. Cutting it
with a flag keeps the export reproducible and puts the cut in the header where a
reader can see that something was withheld. Hand-trimming an exported transcript
produces a file nobody can regenerate, which is the opposite of what sharing a
session is supposed to demonstrate.

**What the review found.** No live credentials. Every key-shaped string came
through as `[REDACTED]`. The unrelated material was one contiguous block inside
the first prompt rather than scattered through the session, which is why a
prompt boundary was a clean enough cut.

**Rejected alternative.** Exporting only sessions that ran in this repo. Safe and
free, but it discards the reasoning behind every decision in this log, which is
the part worth reading.

---

## D-012: statement lookup is a POST, not a GET

Date: 2026-09-03

**Decision.** `POST /api/statements/lookup` with the reference and date of birth
in the body, replacing the `GET /api/statements/:ref` in `DESIGN.md` section 13.

**Why.** The credential includes a date of birth. A GET puts it in the URL, and
a URL is written to browser history, sent in the Referer header of every
subsequent request, and recorded in the access log of every proxy between the
patient and the application. None of those are places a date of birth attached
to a medical bill belongs. The design specified a GET because section 13 was
written as a list of resources before the credential was decided.

A successful lookup returns a signed httpOnly cookie scoped to one statement, so
the date of birth travels once. The statement page reads the cookie. Nothing
identifying appears in a URL at any point in the flow.

**Also decided here, and it is a real cost.** A missing statement and a wrong
date of birth return the identical error. Distinguishing them turns the endpoint
into an oracle for which statement references exist, and a valid reference is
most of what an attacker needs. The patient-facing message is correspondingly
vague, which will confuse somebody who mistyped their own date of birth.

**Not built, and it should be before this is public.** Rate limiting per address
and per reference. Both halves of this credential are guessable given enough
attempts and nothing currently slows an attacker down. Added to `SCOPE.md`.

---

## D-013: in-memory state does not survive a Next module boundary

Date: 2026-09-03

**Measured, not assumed.** `DESIGN.md` section 12 chose in-memory fixtures with
no database, on the grounds that the interesting complexity is in the payment
state machine and a database adds operational surface without adding an insight
about payments. That argument still holds for the fixtures. It does not hold for
anything mutable.

Guest access grants were held in a `Map` in module scope. The lookup route
handler wrote a grant, the statement page read it, and the page never found it.
Instrumenting the module with a random per-instance id showed why:

```
[diag] store module instantiated 19n386
[diag] grantAccess in 19n386 token 88c108cf
[diag] store module instantiated fs3ykd
[diag] resolveAccess in fs3ykd known 0 token 88c108cf
```

Next instantiates a module separately per layer. A route handler and a page
importing the same file get different copies of its module state, in the same
process, on one machine. Next names the two layers in its own error output,
which is the clearest confirmation available:

```
The export allRefunds was not found in module .../store.ts [app-route]
The export allRefunds was not found in module .../store.ts [app-rsc]
```

One file, two compiled modules, two sets of module state. Vercel does not cause this and does make it worse,
because separate serverless instances share nothing at all.

**Resolved for access grants.** They are now stateless signed tokens in
`src/lib/access.ts`, HMAC-SHA256 over the statement id and an expiry, keyed on a
new `AFTERCARE_SESSION_SECRET`. A token carries its own claim, so it is correct
across module instances, serverless instances, and redeploys. The cost is that a
token cannot be revoked before it expires, which is why the window is thirty
minutes and it grants exactly one thing: viewing one statement.

**Unresolved for the payment log, and it blocks build step 5.** Nothing writes
to the payment log yet, so the defect is latent rather than active. It stops
being latent the moment a webhook has to write a payment status that a statement
page then reads. "Webhooks are the source of truth" does not survive a source of
truth that is per module instance.

**Worth stating plainly.** This is a design assumption that building the thing
falsified. The reasoning in section 12 was sound for the case it considered and
wrong about the case it did not, and it is recorded that way rather than quietly
corrected.

---

## D-014: no fallback for the application's own public URL

Date: 2026-09-03

**Defect, found by paying on the deployed site.** `/pay` built the 3DS return
URL as:

```ts
const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
```

A real sandbox payment on the Vercel deployment succeeded and returned the
patient to `http://localhost:3000/pay/return`, which does not resolve on their
machine. Payment id `pay_mm7pB87qWfz9tSA8BMN4`, status `succeeded`. The money
moved and the patient saw a browser error page.

**Decision.** The page reads `serverEnv().appUrl`, which is validated and has no
default. A missing variable now produces a readable error on the page that needs
it, before a payment is attempted.

**Why this is worth an entry rather than a quiet fix.** The fallback was written
for local development convenience and it worked perfectly there, which is
exactly why it survived to production. A default for the application's own
public URL cannot be correct anywhere except the one machine it names, so it can
only ever convert a loud configuration error into a silent one. The failure it
produced is the worst shape available in payments: the charge succeeds and the
confirmation is lost, so the patient does not know whether they paid and the
provider gets a support call about a payment that actually worked.

**Related.** The same reasoning applies to the redirect generally, which is why
`/pay/return` refuses to assert success. See D-006. The redirect being broken
here changed nothing about the money, and under the design it should not: build
step 5 makes the webhook the thing that records the payment.

---

## D-015: the client names a portion, never an amount

Date: 2026-09-04

**Defect, found by testing the step 4 route against the sandbox.** The intent
route accepted a client-supplied amount and validated it against the
server-derived balance, which is what `DESIGN.md` section 8 calls for and is not
sufficient.

Posting `{"amount": 927.00}` to a statement with a $927.00 balance created a
real payment for **927 cents**. It passed every check. JSON parses `927.00` to
the integer `927`, so after parsing there is no difference between a caller
meaning nine hundred and twenty seven dollars and one meaning nine hundred and
twenty seven cents. `Number.isInteger` is true. The branded `Cents` type cannot
help, because the value genuinely is an integer.

A patient-side unit mixup therefore becomes a silent hundred-fold underpayment,
and the statement stays open for a balance the patient believes they cleared.

**Decision.** The request body carries a portion, not a number:

```
{ "portion": "full" }              full remaining balance
{ "portion": "health_account" }    the health-account-eligible part of it
```

Both amounts are computed on the server from data it already holds. There is no
number in the request for a unit error to hide in, and the split tender case
that motivated a client amount in the first place is one of the two portions.

**Why not fix the validation.** There is nothing to fix. The check was correct
and the value was wrong before it arrived. Any rule tight enough to reject
`927.00` also rejects `927`, which is a legitimate $9.27 payment. The only
defence is not to accept the number.

**Consequence for the contract.** `CreateIntentRequest` in
`src/lib/domain/types.ts` still declares `amount: Cents`. It is now unused by
the route and no longer describes the boundary. `types.ts` is the interface
contract and is changed deliberately rather than incidentally, so it is left
alone and flagged here instead.

**Worth stating.** Hard rule 6 in `HANDOFF.md` says amounts are server-derived
and a client-supplied amount is validated, never trusted. The implementation
followed that rule exactly and was still wrong. The rule was not tight enough.

---

## D-016: the design method is borrowed, the brand is not

Date: 2026-09-04

**Decision.** The visual system is adapted from the YUNVO tools design system,
which is a separate project of the author's. Its method is used: two grounds
that mean something, contrast measured and recorded rather than estimated,
colour that is only ever semantic, a stated type scale, zero radius, a fixed
spacing rhythm. Its brand is not used: no mark, no gold, no condensed display
face, no voice.

**Why the method.** The earlier version of this application was one flat grey
ground with rounded cards. That is what an unopinionated build looks like, and
the problem is not that it is ugly. It is that no surface claimed to be anything
in particular, so the bill explanation and the payment control read as the same
kind of object when they are not.

The rule that fixed it is the parent system's: dark is an instrument, light is a
document. A medical statement is both. The patient operates the balance and
reads the adjudication. Splitting those onto two grounds, with the typeface
changing along with them, makes the distinction legible before anything is read.
See `DESIGN-SYSTEM.md`.

**Why not the brand.** The brand is built for a supplements and coaching
company. Applying it to a patient billing page would put a fitness identity on a
medical bill from a fictional health system, which is incoherent on its own
terms, and the reviewer would reasonably read it as confusion about the
exercise rather than as confidence. There is also a functional argument: a
patient looking at an unexpected medical charge needs low arousal and clarity,
which is close to the opposite of what a strong consumer brand voice is built to
do.

**Rejected alternative.** Keeping the parent palette as a personal signature
across portfolio work. Defensible, and it would have cost one specific thing:
the accent that carries the brand measures 2.58:1 on the dark ground, so it
would have needed replacing on the instrument anyway. At that point the
signature is a colour that only survives on half the pages.

---

## D-017: the balance folds the log by processor id, newest row wins

Date: 2026-09-04

**Latent defect, found while reviewing the architecture before build step 5.**
`deriveBalance` summed every succeeded payment row. The log holds one row per
observation, not one per payment: the intent route writes a row when the payment
is created, and step 5 appends another when the webhook reports the outcome.

Two rows describing one $32.70 payment therefore read as $65.40. A statement
would pay itself off at half the money, and the patient would be told they were
square when they were not. Demonstrated by test before the fix:

```
AssertionError: expected 6540 to be 3270
```

Nothing appends twice yet, so this had not fired. It would have fired on the
first webhook ever delivered.

**Decision.** The log is folded to one record per processor object before
anything is summed. Identity is the processor's own id, `hyperswitchPaymentId`
for payments and `hyperswitchRefundId` for refunds, and the newest `updatedAt`
wins.

**Why the same rule as ordering.** The webhook handler in step 5 already has to
compare `updated` to reject out-of-order deliveries. Applying that comparison at
read time as well means a late-arriving stale webhook cannot walk a balance
backwards even if it is appended, because the fold ignores it. The ordering rule
is enforced twice, and the second place is the one that decides what a patient
is shown.

**What it must not break, and is tested.** Split tender is two genuinely
different processor payments against one statement and is still counted twice.
The fold collapses observations of one payment, never two payments.

**Worth stating.** The append-only model in `DESIGN.md` section 12 is the right
one and it is not self-executing. Append-only means the read side carries the
interpretation, and this is the interpretation. A log without a fold rule is not
a ledger, it is a list.

---

## D-018: the intent record carries the processor's clock, not ours

Date: 2026-09-04

**Defect, found by the step 5 gate on its first run.** A correctly signed
`payment_succeeded` webhook was rejected as stale and the statement stayed
unpaid:

```
4. verified payment_succeeded
  outcome   {"outcome":"stale","received":"...T13:00:00Z","recorded":"...T19:39:46Z"}
  balance   {"remaining":3270,"status":"payment_pending"}
```

The intent route wrote `updatedAt: new Date().toISOString()` on the record it
creates at intent time. The webhook handler then compared that against the
`updated` field from the payload, which is Hyperswitch's clock. Two different
clocks, compared as if they were one.

`types.ts` is explicit that this field is the "processor timestamp from the
webhook payload, not our clock". The contract said the right thing and the
implementation ignored it.

**Decision.** The create response carries the processor's own timestamps, which
was confirmed against a live sandbox payment rather than assumed:

```
created=2026-09-04T19:39:48.150Z  modified_at=...187Z
updated=2026-09-04T19:39:48.187Z  expires_on=...
```

`updated` is the same field a webhook later carries for that payment, so the
intent record now stores it and ordering compares two readings of one clock.
The fallback when neither `updated` nor `created` is present is the epoch, which
reads as "no processor observation yet" and is superseded by any real webhook. A
wall clock fallback would not be, because our clock can run ahead of theirs.

**Why this was not caught by a unit test.** Every ordering test constructs both
records itself and is internally consistent by definition. The mismatch only
exists where our clock meets theirs, which is the boundary a unit test replaces
with a fixture. It took a real intent, a real signature, and a real comparison.

**Second, smaller finding from the same run.** The gate initially reported every
event as a duplicate because the script reused fixed event ids across runs and
the idempotency claim holds for 24 hours. That was the deduplication working
correctly on a test that was wrong, which is worth noting because it is the
failure mode that looks most like a bug and is not.
