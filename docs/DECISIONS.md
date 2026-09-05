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
`DESIGN.md`, `types.ts`, the scaffold, and D-001 through D-009 ran from a
different directory, so its transcript was filed there rather than here. Running
`npm run export-sessions` in this repo found only the session that noticed the
problem.

**Decision.** The exporter takes `--project` to name another transcript
directory and `--from` to begin at a given operator prompt. It prints a warning
when reading outside this repo's directory, because the working-directory
default is a safety property rather than a convenience.

**Why `--from` rather than editing the file.** That session opened with
unrelated personal context that does not belong in a public repo. Cutting it with
a flag keeps the export reproducible and puts the cut in the header where a
reader can see that something was withheld. Hand-trimming an exported transcript
produces a file nobody can regenerate, which is the opposite of what sharing a
session is supposed to demonstrate.

**Reversed on 2026-09-05.** The earlier session is no longer exported at all. Its
reasoning already exists in this repository in a better form: `DOMAIN.md`,
`DESIGN.md`, `SCOPE.md`, the type contract, and D-001 through D-009 are what that
session produced, written down deliberately rather than recovered from a
transcript. Shipping a transcript from another working directory to explain a
repository, when the repository already contains the conclusions, adds noise and
a dependency on context the reader does not have. The `--project` and `--from`
flags stay: the problem they solve is real, and the second half of D-011 is the
record of deciding not to need them.

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

---

## D-019: date of birth is three text fields, not a picker

Date: 2026-09-04

**Decision.** The lookup form takes month, day and year as three short numeric
text inputs. Not a native date input, not dropdowns, not a calendar.

**Why not a calendar.** A date picker is built for choosing a date near today.
A date of birth is decades away, so the patient pages backwards through a grid
forty or sixty times. The control is optimised for the opposite of this task.

**Why not the native date input.** `<input type="date">` renders as a segmented
`mm/dd/yyyy` field that has to be driven segment by segment, and its behaviour
differs across browsers and platforms. It was what this form used, and it was
the first thing anyone complained about.

**Why not dropdowns.** A year select for a date of birth is a hundred item list,
and it trades typing four digits for scrolling.

**Why three text fields.** It is the pattern for a date somebody knows from
memory, and it is what the GOV.UK design system uses for exactly this case. The
patient types what they would say out loud.

**Details that matter more than they look.** `inputMode="numeric"` rather than
`type="number"`, because a number input strips leading zeros, so a January
birthday typed as `01` becomes `1`, and it adds spinners to a field where
incrementing a month is meaningless. Autofill hints are `bday-month`,
`bday-day`, `bday-year`. Focus advances only when a field is unambiguously
full, so a patient typing `1` for January is not thrown into the next box
before they can type the `2` of `12`.

**Validated in the browser, on purpose.** The server returns the same
deliberately vague error for a wrong date and a missing statement, per D-012, so
without client-side validation a patient who typed month 13 is told "no
statement matches that reference and date of birth" and has no way to tell a
typo from a wrong record. `31 April` is rejected rather than silently rolled
forward into `1 May`, which is what `Date` does with it.

---

## D-020: the receipt is derived from the ledger, and the return page waits for it

Date: 2026-09-04

**Decision.** `/statement/:ref/receipt` renders the settled payments and refunds
on a statement, folded exactly the way the balance folds them. `/pay/return`
polls the derived status on a bounded schedule and sends the patient to the
receipt once the ledger has actually moved.

**Why the same fold.** A receipt built from a different view of the log than the
balance is how a patient ends up holding a receipt that does not reconcile with
what they were charged. `settledActivity` and `deriveBalance` read the same
records through the same rule, so the two cannot disagree.

**Why the return page polls rather than asserting.** `DESIGN.md` section 14
specified this and it had not been built: the page reported the redirect status
and stopped. The redirect says the browser came back. The webhook says money
moved, and the gap between them was fifteen seconds on the first real payment
through production.

The bound matters as much as the polling. After roughly thirty seconds the page
says the payment is still confirming, that this is normal, that it is safe to
close the page, and that they should not pay again. It does not claim success
and it does not claim failure, because at that moment it knows neither.

**What the receipt deliberately does not do.** It is not emailed, because there
is no mail infrastructure here and pretending otherwise would be a screenshot of
a feature. It says the descriptor that will appear on the card statement, which
is the cheapest way to prevent the chargeback described in `SCOPE.md` item 6:
the patient who does not recognise a line on their statement.

---

## D-021: health account recognition is a BIN lookup, and the table is not invented

Date: 2026-09-04

**Decision.** `src/lib/domain/tender.ts` classifies a card as `health_account`
or `standard_card` by its issuer identification number, using the `card_isin`
the webhook already carries. `bank_debit` is settled by `payment_method` before
the BIN is consulted at all, because a bank account has no IIN and asking a
range table about one is a category error.

This is the claim `DOMAIN.md` section 5 makes, implemented: no processor exposes
HSA or FSA as a payment method because it is not one, so recognition belongs in
this application rather than at the connector.

**Where the table comes from, and where it does not.** The authoritative health
benefit IIN ranges are published by the card networks to SIGIS-registered
merchants under licence. That data is not public and is not reproduced here.

So the range table has two parts and the separation is the point. The licensed
set is **empty**, deliberately, rather than filled with plausible looking
numbers: an invented range that looks real is worse than no range, because it
invites someone to trust it. The demonstration set contains sandbox test BINs,
labelled as such, chosen so the flow is exercisable with cards anyone has:
`5555 5555 5555 4444` classifies as a health account and
`4242 4242 4242 4242` does not.

**Which direction it fails.** An absent, short, or unrecognised BIN returns
`standard_card`. Treating a health account card as standard means the patient is
offered no health-account-specific handling, which is a degraded experience.
Treating a standard card as a health account would tell them funds are eligible
when they are not, and would later route a refund on a false premise. Only one
of those has a tax consequence.

**Verified end to end** against the running application with signed webhooks, on
the mixed-eligibility statement:

```
health_account portion  $702.00 paid, remaining $225.00, status open
full portion            $225.00 paid, remaining   $0.00, status paid
receipt                 Health account card ending 4444   $702.00
                        Visa ending 4242                  $225.00
```

That is the split tender scenario from `DESIGN.md` section 8, running.

---

## D-022: a refund gets its own colour, because direction is the point

Date: 2026-09-04

**Decision.** `--refund-light` `#35617f` at 5.93:1 on cream and `--refund-dark`
`#8ec0dc` at 9.86:1 on the instrument. Deliberately off the paid ladder and not
a severity colour.

**Why not reuse the paid green.** A refund rendered in the same green as a
payment differs from it only by a plus sign, and direction of money is the one
thing a receipt exists to make unambiguous. A patient scanning a receipt and
reading a refund as a second payment concludes they were charged twice.

**Why not terracotta.** That colour already means "your plan did not cover
this". Overloading it with "money came back" makes both meanings weaker, and a
refund is not a warning.

**Why the health account tender is marked with the accent instead.** It
identifies a kind of instrument rather than reporting anything about the money,
so it does not belong on the semantic scale at all.

**Rejected alternative.** Colouring the outstanding balance. It is already the
largest figure on the page and carries emphasis through size and weight; adding
a fourth colour would dilute the three that mean something.

---

## D-023: split tender is chosen before the payment exists

Date: 2026-09-04

**Decision.** `/statement/:ref/pay` asks which portion to pay before mounting
checkout, and only when there is a real choice to make. A statement whose lines
are all eligible, or none of them, goes straight to checkout, because offering a
choice with one sensible answer is a question rather than an option.

**Why the choice comes first.** The portion determines the amount and the amount
is fixed when the intent is created. There is no way to mount a checkout and
then change what it charges.

**What the patient is protected from.** Without this, someone with an FSA card
and a mixed statement enters that card against the full balance and is declined
for ineligible spend or insufficient funds, with a processor decline code that
explains nothing. The eligible figure is known before the card is entered, so it
is shown before the card is entered.

**The amount is still never sent by the browser.** The panel posts `"full"` or
`"health_account"`. The server computes what each is worth. See D-015.

**A duplication worth naming.** The panel computes the eligible figure for
display and the server computes it again to charge. They are derived from the
same statement by the same rule but they are two computations, and if they ever
disagree the patient would see one number and be charged another. So the
checkout now renders the amount from the intent response, which is the figure
the server actually created the payment for. The patient sees the real number
before confirming rather than on the receipt afterwards.

**Known cost, not hidden.** Changing the choice after checkout has mounted
creates a second intent and abandons the first. That is the idempotency gap
already recorded in the architecture review: an abandoned intent sits in the log
as `requires_payment_method` until a webhook resolves it, and nothing resolves
one the patient never confirmed.

---

## D-024: a decline is classified once, stored as a category, and worded at render

Date: 2026-09-04

**Decision.** `src/lib/domain/decline.ts` maps a processor decline to a category
and a piece of patient-facing guidance. The webhook classifies on arrival and
stores only the category in `Payment.failureReason`. The wording is derived
wherever it is shown.

**Why this is the error path that matters here.** A retail customer who is
declined abandons a basket. A patient who is declined still owes the money, and
what happens in the next thirty seconds decides whether the provider collects it
or writes it off. `DOMAIN.md` section 6 calls this the highest-value error path
in the vertical and it was the last core flow with no implementation.

**The domain-specific part.** The same decline code means different things on
different tenders, and demands different advice:

```
insufficient_funds on a personal card    -> insufficient_funds
insufficient_funds on a health account   -> health_account_limit
```

A personal card declining for funds might work tomorrow. A health account
declining for funds means the account balance is smaller than the bill, which is
the normal case rather than an error, and the answer is to pay the eligible
portion and settle the rest another way. Telling that patient to "try again
later" is advice that cannot work. Verified against the running application:
identical `error_code`, two categories.

**Two rules on the wording, and both are tested.** It never implies the patient
did something wrong, because a bill arriving weeks after the care is already an
unpleasant surprise and a decline reads as an accusation if you let it. And it
always says what to do next, including in the `unknown` case, because "your card
was declined" with no suggestion is exactly where collection stops.

**Why the category is stored and not the sentence.** The connector's own code
and message are connector-specific, they change, and showing one to a patient is
what this normalization exists to prevent. Storing the category means the wording
can be improved without rewriting the log, and a record written months ago
renders in today's language.

**On Hyperswitch's unified codes.** The API carries `unified_code` and
`unified_message`, normalized across connectors, which is exactly what this
module would rather consume and is a real argument for the orchestration layer.
The source marks both "not live yet". They are read when present and are
expected to be null, and the local mapping does the work until they ship. Most
of this module is deletable when they do, which is the intended direction rather
than a regret.

**Where it surfaces.** The pay page states the decline above everything else,
read from the ledger rather than from a query parameter, because a redirect can
be lost and the ledger cannot. The return page stops polling the moment the
ledger records a failure, rather than making a patient watch a spinner for
thirty seconds after their card was already refused, and offers another method
immediately.

---

## D-025: a payer correction is recorded beside the statement, not into it

Date: 2026-09-04

**Decision.** A re-adjudication is stored as its own record carrying a revised
patient responsibility. `deriveBalance` applies it. The statement's line items
are never edited.

**Why not correct the statement.** The patient received a document saying they
owed a particular amount. A record that quietly becomes the new number cannot
explain why they were charged the old one, and the question a patient asks after
a correction is exactly "then why did I pay $927?". Keeping both facts means the
answer exists. It is also what an 835 remittance actually does: it does not
amend the earlier claim, it adds a later adjudication of it.

**Where the refund goes, and why that is not arbitrary.** A Hyperswitch refund
references a `payment_id`, so money physically cannot land anywhere except the
instrument it came from. The IRS constraint on health account funds is satisfied
by construction rather than by a rule someone has to remember.

On a split tender balance that still leaves a choice, and the choice is made
explicitly: **health account payments are drawn from last.** Returning money to
a personal card is unambiguously fine. Returning it to a health account is a
reversal against a tax-advantaged account: it can interact with the year's
contribution limit and it reopens a substantiation the patient may already have
settled with their plan administrator. Given a choice of where to send the same
dollar, the one with no tax consequence wins. Tested: a $225.00 correction on a
$702.00 health account plus $225.00 card statement comes entirely off the card.

**Pending refunds count against capacity.** Two corrections in quick succession
must not both allocate against the same dollars because the first has not
settled. A failed refund does not, because it claimed nothing.

**Ordering inside the endpoint.** The correction is recorded before any money
moves. If a refund call fails partway, the statement still shows the corrected
balance, which is the true one. The other ordering leaves a patient owing a
figure the payer has already withdrawn.

**An upward revision produces no refund.** A payer revising a balance up does
not create a debt collectible through this path. It produces a new balance the
patient is billed for, which is the ordinary flow, and conflating the two would
let a correction silently charge someone.

**Stated boundary.** `/api/provider/readjudicate` is not authenticated. It moves
money out of the provider, so a real console sits behind staff authentication
with an audit trail. Left open deliberately and recorded here rather than built
halfway, because a fake login is not authentication.

---

## D-026: a refund belongs to a processor payment, not to a row describing it

Date: 2026-09-05

**Defect, found by issuing a real refund.** A genuine `refund_succeeded` webhook
arrived, was verified, was recorded, and the balance ignored it. The statement
kept saying `paid` while $12.70 had actually gone back to the patient's card.

The log holds several rows for one processor payment: the intent route writes
one, each webhook writes another. A refund is bound to whichever row the writer
was holding at the time, and the two writers were holding different ones:

```
internal=4adb2938  pay_hz3m…  requires_payment_method   <- webhook bound the refund here
internal=6760b715  pay_hz3m…  succeeded                 <- readjudicate bound its pending row here
```

`deriveBalance` folds payments to one row per processor payment, then built its
set of payment ids from the *folded* result. The succeeded refund pointed at a
row the fold had discarded, so it matched nothing and was dropped.

**Two fixes, and the second is the real one.**

The webhook now binds a refund to the settled row rather than to whichever is
first in the log, because the first is usually the intent, written before the
patient had entered a card.

More importantly, the balance now takes payment ids from *every* row of the
statement rather than from the folded set. A refund attached to any row of a
payment is a refund of that payment. Double counting is still prevented, but by
folding refunds on their own processor id, which is where that job belongs.

**Why this was invisible until real money moved.** Every test constructed
payments and refunds that agreed with each other, because a fixture author
naturally binds a refund to the payment they just wrote. The disagreement only
exists when two different pieces of code write rows for the same payment at
different times, which is precisely what an append-only log does and precisely
what a fixture does not. The regression test now builds the disagreement on
purpose.

**The general lesson, worth stating once.** An append-only log means the read
side carries the interpretation, and every read of it has to fold the same way.
This is the second bug of exactly this shape, after D-017. Both were silent,
both involved money, and both came from one part of the code holding a different
view of the log than another.

---

## D-027: an intent is reused rather than recreated

Date: 2026-09-05

**Defect, and one this session created a dozen instances of.** Every POST to
`/api/payments/intent` created a new payment at the processor. A patient
double-clicking, a component remount, or changing the split tender choice each
produced a real Hyperswitch payment that nobody would ever confirm.

Those orphans sit in `requires_payment_method` permanently, because nothing
resolves a payment the patient never touched: no webhook arrives for a payment
that never moved. They are reconciliation noise, they are not free, and on a
statement with several of them the ledger stops being a readable account of what
the patient did.

**Decision.** Before creating, look for an existing payment on this statement
with the same amount in a still-confirmable status, and ask the processor
whether it is still usable. If it is, hand back its client secret.

**Why ask the processor rather than trust the ledger.** Our log records what we
last heard. The processor knows what is true now, and an intent expires without
anyone telling us: the create response carries `expires_on`, roughly fifteen
minutes out. Reusing a stale intent hands the browser a client secret that will
be refused at confirmation, which is a worse failure than creating a second
payment.

**`requires_customer_action` is deliberately not reusable.** A payment in that
state is mid-3DS with the patient on their bank's page. Handing a second browser
the same secret is not reuse, it is a race.

**A failed lookup falls through to creating a new intent.** Reuse is an
optimisation. Refusing to take a payment because the optimisation could not be
checked would trade a small cost for a total one.

**What this is not.** It is not idempotency keyed on a client-supplied token,
which is the general answer and what a production system should carry through
the whole write path. This is narrower: it recognises the specific duplicate
this application generates. The general version is worth having and is not
pretended to be here.

---

## D-028: the blocklist names one concept two ways

Date: 2026-09-05

**Found by calling it.** The blocklist create and delete endpoints take a `type`
of `fingerprint`, `card_bin` or `extended_card_bin`. The list endpoint takes a
`data_kind`, and querying it with `fingerprint` returns 400:

```
unknown variant `fingerprint`, expected one of `payment_method`,
`card_bin`, `extended_card_bin`, `generic_card_bin`
```

A stored instrument is `fingerprint` when you block it and `payment_method` when
you list it. The client therefore carries two unions rather than one, which
looks like duplication and is not.

`generic_card_bin` appears in that error message and in no documentation page
found for this feature. It is declared in the type and deliberately not used:
an endpoint accepting a value is not the same as knowing what it means.

**Documentation correction, second one for this feature.** `HANDOFF.md` step 7
originally said the blocklist is configured in the dashboard. It is API only,
and there is no separate card-testing guard: the blocklist toggle is the guard.
That was corrected on 2026-09-04 from the docs. This entry is the correction the
docs themselves needed.

**State left on the account.** The guard is enabled
(`blocklist_guard_status: enabled`) and card BIN `411111` is blocked as a
demonstration entry. It is not a BIN any demo card uses, so the flow stays
payable with `4242 4242 4242 4242` and `5555 5555 5555 4444`. A blocked payment
fails with `HE_03`.

**What the screen does with a failed blocklist read.** It reports the state as
unknown rather than as empty. The two are not the same, and an operator reading
"nothing is blocked" when the truth is "we could not ask" has been told the
opposite of what is useful.

---

## D-029: three money bugs found by review, not by tests

Date: 2026-09-05

Three subagents were asked to audit the repository before submission. Two
independently found the same defect, which is the one worth leading with.

**The intent route was the only reader that ignored a payer correction.**
`deriveBalance` takes the re-adjudication as its fourth argument. Five callers
pass it. The intent route did not, and it is the one that decides what to
charge. A statement corrected downwards displayed the corrected balance on every
patient screen while the intent was created from the original line items, so a
patient returning to a settled statement would have been charged the difference
again. That is precisely the failure D-023 claims was closed.

**`alreadyRefunded` summed refund rows without folding them.** The third
instance of D-017 and D-026, in the last money computation that had not been
audited for it. The provider route writes a pending row and the webhook writes a
succeeded row for the same processor refund, so one refund counted twice and
halved the capacity of the payment it came from. A later correction would then
be refused for exceeding a capacity that was never really consumed, after the
revised balance had already been recorded.

**Re-adjudication decided from settled refunds and allocated against claimed
ones.** `overpaymentFrom` was given `balance.amountRefunded`, which counts only
succeeded refunds, while `allocateRefund` counted anything not failed. Between
issuing a refund and its webhook arriving, the first figure is zero. Submitting
the same correction twice in that window sent the money twice. Seconds for a
card, days for ACH.

**And an invariant that existed only as a comment.** `balance.ts` defines an
`IN_FLIGHT` set with a comment saying a patient who refreshes during a 3DS
challenge must not pay twice. It was used to derive a status string and nothing
else. `resolvePayableAmount` refused only `transferred` and a zero balance, and
`requires_customer_action` is deliberately excluded from D-027's reuse path, so
a patient who lost a 3DS window and reopened the page got a second full-balance
intent. Both charges succeed, the balance clamps at zero, and the
over-collection is silent. Now enforced in `inFlightPayment`.

**What this says about the tests.** All 128 passed throughout. Every one of
these lives in a seam between two pieces of code that each looked correct: a
caller omitting an argument, two functions filtering the same log differently, a
comment describing an invariant nobody implemented. Fixtures do not produce
seams, because the author of a fixture builds both sides to agree. That is the
same lesson as D-026 and it has now cost four bugs, so it is worth stating as a
rule: **anything derived twice must be derived by one function, and every reader
of the log must fold it the same way.**

---

## D-030: the provider console was exposed, and a deferral was the wrong shape

Date: 2026-09-05

**Found by review, and it was live.** `SCOPE.md` item 10 deferred provider
console authentication, arguing that a fake login is not authentication and that
saying so is more honest than a password field proving nothing. That argument is
sound and it was applied to the wrong thing.

`POST /api/provider/readjudicate` issues refunds. `POST /api/provider/risk`
toggles the merchant account's fraud guard and edits the blocklist. Both were
deployed on a public URL with no credential of any kind. Verified against
production: an unauthenticated POST reached input validation rather than an
authentication check.

**A deferral describes something not built. This was something exposed.** The
distinction is the whole finding. Everything else in `SCOPE.md` is a flow that
does not exist; this was a flow that existed, worked, and was reachable by
anyone who guessed the path.

**Decision.** A shared staff password, compared in constant time, exchanged for
an HMAC-signed httpOnly session. Both pages redirect to a sign-in and both write
endpoints answer 401 without it.

**Why this is not the fake login the original deferral warned about.** A fake
login is one that gates nothing or accepts anything. This checks a real secret
that is not in the repository and issues a signed token that cannot be forged
without the signing key. It is weaker than what a real deployment needs and it
is not nothing.

**Still deferred, and now honestly.** Per-user identity, SSO against the
practice's identity provider, and an audit trail recording who applied a
correction and against which remittance. Those are the things `SCOPE.md` item 10
should have described, and the door being shut is what makes deferring them a
choice rather than a hole.

**The risk screen's own table said `Authentication on this console: Missing`.**
It was right, and nobody read it as a live finding until a review pointed at the
endpoints behind it. That is an argument for the table, and an argument against
trusting anyone to act on a row that says missing.

---

## D-031: the routing shape was resolved by asking the API, and the descriptor now reaches the field that produces it

Date: 2026-09-05

Two gaps a review found, both places where a document claimed something the
code did not do.

**The statement descriptor was argued for and never sent.** `DESIGN.md` section
10 lists `statement_descriptor` under what this application sends. It did not.
The provider name was prefixed into `description`, which is an internal
annotation and is not the field that reaches a bank statement. Meanwhile the
receipt told the patient "charges appear on your statement as NORTHGATE HEALTH",
which was false.

That matters more here than it would in retail. The descriptor is a
HIPAA-adjacent argument in `DOMAIN.md` section 5, and `SCOPE.md` item 6 leans on
it as the cheapest chargeback prevention available: the dispute a patient never
files because they recognised the line. The one field the documents argue
hardest about was the one field not populated.

Now sends `statement_descriptor_name`, confirmed against the Hyperswitch source:
maximum 22 characters for the concatenated descriptor, and `NORTHGATE HEALTH` is
16. The source marks the field for deprecation in favour of
`billing_descriptor`, whose struct is defined in another crate and was not
confirmed, so the documented field that works today is used rather than a guess
at its successor.

**The orchestration argument had nothing running behind it.** `DOMAIN.md`
section 7 makes a five-point case for an orchestration layer: processor
plurality, vault portability, least-cost routing, failover, centralised retry.
`DESIGN.md` section 11 promised an amount-based routing rule. None of it
existed, and it was not in `SCOPE.md` either, so it was a promise with neither
delivery nor deferral.

**The API documentation for routing could not be found, so the shape was
resolved by asking the API.** The same technique as D-007 and D-028, and it
worked better than reading would have. Each malformed request named the next
missing field:

```
{}                             -> Missing required param: name
{name}                         -> Missing required param: description
algorithm: {}                  -> missing field `type`
algorithm: {type: "nonsense"}  -> unknown variant, expected one of `single`,
                                  `priority`, `volume_split`, `advanced`,
                                  `three_ds_decision_rule`
algorithm: {type: "advanced"}  -> missing field `data`
data: {}                       -> missing field `defaultSelection`
rules: [{}]                    -> missing field `name`
...then `metadata` at the rule, the statement, and the condition
```

The full shape, which is written down here because it is not written down
anywhere else that could be found:

```json
{ "name": "...", "description": "...", "profile_id": "...",
  "algorithm": { "type": "advanced", "data": {
    "defaultSelection": { "type": "priority", "data": [{ "connector": "stripe" }] },
    "rules": [{ "name": "...", "connectorSelection": { ... }, "metadata": {},
      "statements": [{ "condition": [{ "lhs": "amount",
        "comparison": "greater_than",
        "value": { "type": "number", "value": 50000 },
        "metadata": {} }], "metadata": {} }] }],
    "metadata": {} } } }
```

`routing_ejjXIFOEagrouU0O7K0s` is created and activated on the profile:
balances over $500.00 evaluate on their own branch, which is the threshold
`SCOPE.md` item 1 uses for payment plan candidacy.

**What one connector can and cannot prove, said plainly.** It cannot demonstrate
choosing between processors, because there is only one to choose. It does prove
the rule is real: an amount condition Hyperswitch evaluates on every payment,
readable at `GET /routing/active`, surfaced on the risk console next to the
blocklist. The claim moves from "an orchestration layer would let us route" to
"here is the routing algorithm, and here is what a second connector would add".

**A side effect worth recording.** `{"connector": "stripe"}` was accepted, which
independently confirms the connector is Stripe rather than the dummy one. That
is the second time that question has been answered by something working rather
than by looking: the first was a real refund settling, which the dummy connector
cannot do.

---

## D-032: a review found the worst bug in this repository

Date: 2026-09-05

A second review pass, after the fixes in D-029 and D-030, found that one of
those fixes had opened something worse than what it closed.

**A patient's access cookie was a valid staff session.**

`access.ts` signs `${statementId}.${expiry}`. `staff.ts` signs
`${expiry}` behind a `staff.` prefix. Both used the same key and neither used a
domain separator, and `isStaff` verified the signature without checking that the
payload was a staff payload. The grammars were compatible, so the signature
matched.

Verified by test before fixing: `isStaff(grantAccess("stmt_4021"))` returned
**true**.

The consequence: any patient who looked up any statement received a cookie
which, renamed from `aftercare_access` to `aftercare_staff`, granted the full
provider console. Refunds. The merchant account's fraud guard. Reachable with a
statement reference printed on a piece of paper and a date of birth, renewable
indefinitely.

That is the exposure D-030 was written to close, reintroduced through the
patient front door by the fix itself, because the fix reused a key and a token
grammar that were already occupied.

**Fixed** with a domain separator in each HMAC, `aftercare.access.v1` and
`aftercare.staff.v1`, plus a payload prefix check as a second lock. Both are now
regression tested.

**The lesson is narrower than "separate your keys".** Two token families signed
with one key are only safe if no payload from one family can parse as a payload
from the other, and nobody checks that property when adding the second family.
A separator removes the need to check it.

---

**Three more from the same pass.**

**The event claim was taken before the effect landed.** `claimEvent` marks an
`event_id` used, then the ledger is written. If that write fails, the route
throws, Hyperswitch retries, `claimEvent` reports a duplicate, and a succeeded
payment is discarded permanently while the money has moved. The claim is now
released when applying throws, so the retry finds the id free. A double apply is
harmless because the balance folds by processor id; losing the event is not.

**The staff password was validated in the shared `serverEnv` bundle**, which
made the provider console's secret a precondition for statement lookup,
checkout, and webhook ingestion. It took production down when the variable was
added to the code before the deployment. `env.ts` already argues this exact case
for keeping the Redis configuration separate, and the argument was not followed
one function later. Now `staffEnv`.

**The in-flight guard from D-029 was worse than the bug it fixed.** Refusing any
new intent while one was in flight stopped the 3DS double charge and broke split
tender: an ACH leg sits in `processing` for days, and the second leg is the flow
this application exists to demonstrate. It also had no liveness bound, so an
abandoned 3DS locked a patient out of their own bill forever.

The question was wrong. It is not whether something is in flight, it is whether
this request plus what is in flight exceeds what is owed. `wouldOverCollect`
asks that instead. The route also now trusts the live processor status it
already fetches for intent reuse: if the processor says the payment succeeded, a
second intent is refused rather than created.

**What this pass says about the last one.** D-029 closed four bugs and opened
two, one of them critical. Every fix in this log has been verified against the
running application; none of these were, because they looked obviously correct.
The rule that keeps holding is the one from D-026: the defects live in the seams
between two pieces of code that each look right on their own.
