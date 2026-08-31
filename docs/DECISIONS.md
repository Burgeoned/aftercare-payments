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
