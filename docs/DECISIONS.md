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

