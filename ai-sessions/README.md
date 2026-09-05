# AI sessions

Transcripts of the Claude Code sessions that produced this repo, exported with
`npm run export-sessions`. Tool output is truncated, credential-shaped strings
are redacted, and a local list of personal strings is stripped as well.

Two files, 47 operator prompts between them.

| File | Prompts | What happened in it |
|---|---|---|
| `session-b387cc9b.md` | 16 | Domain analysis, architecture, the type contract, scaffold, first live sandbox payment |
| `session-56908782.md` | 31 | Build steps 3 through 6, deployment, the design system, and every bug below |

## How this prototype was built with AI

The short version: the model was fast at building and unreliable at knowing when
it was wrong. Almost everything below was caught by running the thing against a
real processor rather than by reading the code.

**1. A rule was followed exactly and was still wrong.**
`session-56908782.md`, prompt 15.

`HANDOFF.md` invariant 6 says amounts are server-derived and a client-supplied
amount is validated, never trusted. The implementation did exactly that. Then a
test posted `{"amount": 927.00}` against a $927.00 balance and it created a real
payment for **927 cents**.

JSON parses `927.00` to the integer `927`. After parsing there is no difference
between a caller meaning nine hundred and twenty seven dollars and one meaning
nine hundred and twenty seven cents, `Number.isInteger` is true, and the branded
`Cents` type cannot help because the value genuinely is an integer. No validation
rejects `927.00` and accepts `927`.

The fix was to stop accepting a number. The request now names a portion, `full`
or `health_account`, and the server computes what it is worth. Worth reading
because the rule was not loose, it was tight and insufficient, and only running
it found that out. See `docs/DECISIONS.md` D-015.

**2. A real refund arrived, was verified, and was silently ignored.**
`session-56908782.md`, prompt 30.

Issuing an actual $12.70 refund against an actual sandbox payment produced a
verified `refund_succeeded` webhook. The statement kept saying `paid` while the
money had genuinely gone back.

The append-only log holds several rows per processor payment, and a refund binds
to whichever row its writer was holding. Two different writers held two
different rows. Both `deriveBalance` and the receipt built their payment id sets
from the *folded* result, so a refund attached to a discarded row matched
nothing.

Every unit test passed, and always would have, because a fixture author binds a
refund to the payment they just wrote. The disagreement only exists when two
pieces of code write rows for the same payment at different times, which is what
an append-only log does and what a fixture does not. This was the second bug of
that exact shape. See D-017 and D-026.

**3. A design assumption was falsified by instrumenting it, not by arguing.**
`session-56908782.md`, prompt 1.

`docs/DESIGN.md` section 12 chose in-memory fixtures and no database. Guest
access grants were held in a `Map`, the lookup route wrote one, and the statement
page never found it. Rather than guess, the module was given a random per-instance
id:

```
[diag] grantAccess in 19n386 token 88c108cf
[diag] store module instantiated fs3ykd
[diag] resolveAccess in fs3ykd known 0 token 88c108cf
```

Next instantiates a module separately per layer. A route handler and a page get
different copies of its state, in one process, on one machine. That killed the
no-database decision for anything mutable and is why the payment ledger is in
Redis. See D-013.

**4. A payment succeeded and the patient was sent to a dead address.**
`session-56908782.md`, prompt 9.

A real payment on the deployed site returned to `http://localhost:3000/pay/return`.
The cause was one line written for local convenience:

```ts
process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"
```

A default for the application's own public URL cannot be correct anywhere except
the one machine it names, so it can only convert a loud misconfiguration into a
silent one. The failure shape is the worst available in payments: the charge
succeeded and the confirmation was lost.

It is also where the architecture paid for itself. No money was affected,
because the design already refused to treat the redirect as truth. See D-014 and
D-006.

**5. Where the model was told no.**
`session-56908782.md`, prompt 27.

Asked to rebuild the interface in an existing personal brand, the answer was to
take the method and refuse the brand: a fitness identity on a medical bill is
incoherent, and a patient reading an unexpected charge needs low arousal rather
than a strong voice. What transferred was the discipline, including measuring
contrast rather than estimating it, which immediately showed the accent already
in use failed at 2.58:1 on its own dark ground. See D-016 and
`docs/DESIGN-SYSTEM.md`.

## One note on the transcripts themselves

The exporter originally reported **151 operator prompts** for the first session.
The real number is 16. Claude Code returns tool results as user-role messages,
and counting them as prompts overstated hand direction by roughly ten times.

That number was fixed before these files were generated, because it is the one
figure a reader of a shared session is most likely to draw a conclusion from.
See D-010.

## What is not here

The three page architecture and decisions document was written by hand, not
generated. It is not in these transcripts by design.

`docs/DECISIONS.md` is the fuller record. It runs to 27 entries and includes the
reversals, the measurements, and the things that turned out to be wrong.
