# Development

## Requirements

Node 24 or later, or Docker. Both paths are supported and produce the same
result.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with values from the Hyperswitch dashboard:

| Variable | Where it comes from |
|---|---|
| `HYPERSWITCH_API_KEY` | Developers → API Keys. Shown once at creation |
| `NEXT_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY` | Developers. Safe to expose |
| `HYPERSWITCH_PROFILE_ID` | Settings → Business Profiles, or from `npm run smoke` |
| `HYPERSWITCH_WEBHOOK_SECRET` | Developers → Payment Settings. The payment response hash key |
| `HYPERSWITCH_BASE_URL` | `https://sandbox.hyperswitch.io` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally, the Vercel URL in production |

`.env.local` is gitignored. Never commit it, never paste a key into a chat
session, and never put one in a code sample. This repo's AI sessions are shared
as part of a submission.

## Verify the integration before building on it

```bash
npm run smoke
```

Creates a real $1.00 payment in the sandbox and reports whether the API key
authenticates, which payments path the account answers on, the profile id, and
whether a connector is attached. Prints no secrets. Run this first: it fails
fast and legibly, where a broken app fails slowly and confusingly.

## Run

```bash
npm run dev
```

Or in Docker, which is the recommended path on Windows for the reason in
`DECISIONS.md` D-001:

```bash
docker compose up --build
```

Both serve on http://localhost:3000. Visit `/pay` for the integration smoke
test: a real $1.00 sandbox payment through Unified Checkout. Test card
`4242 4242 4242 4242`, any future expiry, any CVC.

## Checks

```bash
npm run verify
```

Runs typecheck, lint, and tests. CI runs the same three plus a production build
on every push and pull request. The build runs without secrets on purpose: every
route that reads configuration is `force-dynamic` and resolves it per request, so
a build that needed secrets would mean a route was leaking them into a static
artifact.

Individually:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Webhooks in local development

Hyperswitch delivers webhooks to a public HTTPS URL, so `localhost` does not
receive them. Deploy to Vercel and point the dashboard webhook at
`https://<your-vercel-url>/api/webhooks/hyperswitch`. Deploying to test the
webhook path is faster than maintaining a tunnel and matches how the endpoint
will actually run.

## Toolchain notes

Three version constraints are load-bearing and documented in `DECISIONS.md`:

- **`ignore-scripts=true` in `.npmrc`** (D-001). The SDK's `rescript` dependency
  has a postinstall that fails on Windows. Do not remove this without reading
  the entry.
- **TypeScript pinned to 6.x** (D-004). typescript-eslint does not support TS 7.
- **`src/types/react-hyper-js.d.ts`** (D-002). The React SDK ships no types.
  Extend this shim rather than widening it to `any`.

## Conventions

Read `CLAUDE.md` before contributing. The seven invariants in `HANDOFF.md` are
not style preferences: violating one is a defect.
