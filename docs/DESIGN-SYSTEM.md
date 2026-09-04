# Design system

Why this application looks the way it does, and the numbers behind it.

The method here is adapted from the YUNVO tools design system, which is a
separate project of the author's. The method transferred. The brand did not, and
the reason is stated in `DECISIONS.md` D-016: a fitness brand on a medical bill
is incoherent, and a patient reading an unexpected charge needs low arousal
rather than a strong voice.

## 1. Two grounds

The load-bearing rule, and the one everything else follows from.

```
┌──────────────────────────────────────┐
│  INSTRUMENT        #0e0e0e           │  what you act on
│  grotesque                           │  the balance, and paying it
│  the amount, once, large             │
├──────────────────────────────────────┤
│  DOCUMENT          #f5f2ec           │  what you read
│  serif                               │  the adjudication, line by line
│  billed / allowed / paid / owed      │
└──────────────────────────────────────┘
```

**The rule.** Anything the patient operates or reads a figure off belongs on the
instrument. Anything they read belongs on the document. If a section is mostly
prose, it is document.

**Why it fits this application.** A medical statement is genuinely both things.
The patient came to find out what they owe and to pay it, which is an
instrument. They stay to understand why, which is a document. One flat ground
made every page read as a form, which is what "looks like every other prototype"
actually means: no surface was claiming to be anything in particular.

The ordering is deliberate. The number comes first because that is what the
patient came for, and the explanation is immediately beneath it because a
patient who does not understand the residual calls the billing office or
disputes the charge. See `DOMAIN.md` section 8.

## 2. The typeface changes with the ground

This is the part not inherited from the parent system, and it is the reason the
split is legible before a word is read.

| Ground | Family | Why |
|---|---|---|
| Instrument | IBM Plex Sans | A control surface and a figure read off a panel. Real tabular numerals, so a balance changing does not reflow the layout |
| Document | Source Serif 4 | An explanation of benefits is a printed artifact and a patient has seen a hundred of them on paper. Drawn for reading on screen rather than for display, so it holds at body size across a table |

Numerals are always set in the grotesque, on both grounds, with
`font-variant-numeric: tabular-nums`. A column of money that shifts width as
digits change looks like a bug in the arithmetic.

## 3. Colour, measured

Every ratio below was computed, not estimated. The parent system's discipline
here is the part most worth stealing: it records that `rgba(cream,.35)` measured
2.98 and failed its own floor, rather than quietly using it anyway.

### The accent needs one hex per ground

The single accent this application started with is `#1f5f4f`.

| Pair | Ratio | Verdict |
|---|---|---|
| `#1f5f4f` on `#f5f2ec` | **6.69:1** | passes |
| `#1f5f4f` on `#0e0e0e` | **2.58:1** | fails |

That is why the dark areas of the earlier version looked muddy: the accent was
close to invisible against them. So there are two.

| Token | Hex | On | Ratio |
|---|---|---|---|
| `--accent-light` | `#1f5f4f` | `--l-ground` | 6.69:1 |
| `--accent-dark` | `#6fb39a` | `--d-ground` | 7.90:1 |

### Text

| Token | Effective | Ratio |
|---|---|---|
| `--d-text` | `#f5f2ec` | 17.28:1 |
| `--d-text-2` | cream @ .68 | 8.23:1 |
| `--d-text-3` | cream @ .52 | 5.23:1 |
| `--l-text` | `#1a1a1a` | 15.58:1 |
| `--l-text-2` | charcoal @ .62 | 4.69:1 |

`--d-text-3` at .52 is the floor for small text. Cream at .42 measures 3.79 and
at .38 measures 3.31, both of which are large-text-only. Nothing in this
application uses them.

### Semantic colours

These carry meaning and are never used for emphasis, decoration, a border, or a
hover state. A colour from this table appearing without its meaning is a defect.

| Token | Hex | Ratio | Means |
|---|---|---|---|
| `--warn-light` | `#9a4a2c` | 5.54:1 on cream | Your plan did not cover this |
| `--warn-dark` | `#d99a78` | 8.13:1 on dark | Same, on the instrument |
| `--paid-light` | `#2f6b52` | 5.62:1 on cream | Money already collected |
| `--paid-dark` | `#7dbb9c` | 8.70:1 on dark | Same, on the instrument |

Terracotta itself, `#c97b5a`, measures **2.91:1 on cream** and is never used
there. The warning colour on the document ground is the darker `#9a4a2c`.

### Surfaces are not text

`--d-panel` against `--d-ground` measures 1.04:1, and `--l-recessed` against
`--l-ground` measures 1.11:1. Both are correct. They separate surfaces, not
glyphs, and nothing should "fix" them to meet a text contrast floor.

## 4. Rhythm

- **Radius: 0.** Everywhere. A statement is a printed document and a payment is
  an instrument. Neither is a consumer app card, and rounded corners were most
  of what made the earlier version read as generic.
- **Container:** `max-width: 1080px`, `wrap-narrow` at `34rem` for single-column
  pages. Padding `1.5rem` under 760px, `clamp(2rem, 5vw, 4rem)` above.
- **Spacing:** section gap 52px, panel padding 24px, field gap 22px,
  label-to-control 7px. Inherited directly from the parent system.
- **Measure:** `62ch` on running prose. A line of a bill explanation that runs
  the full 1080px is not read.

## 5. Type scale

| Token | Size | Use |
|---|---|---|
| `--fs-answer` | `clamp(3rem, 10vw, 4.75rem)` | The amount. One per page |
| `--fs-hero` | `clamp(1.75rem, 5vw, 2.4rem)` | Page `h1` |
| `--fs-section` | `1.15rem` | Section `h2` |
| `--fs-figure` | `1.35rem` | Ledger totals |
| `--fs-body` | `0.95rem` | Prose |
| `--fs-small` | `0.84rem` | Table cells, hints |
| `--fs-micro` | `0.72rem` | Eyebrows, flags |

**One answer per page.** On a statement it is always the same thing: what the
patient owes. If a page has two competing large figures, one of them is wrong.

## 6. The mixed headline

The parent system's signature move is a condensed display face with an italic
serif second line. Carried here by the two families already in play, so the
headline states the instrument-and-document thesis before any content does.

```
Pay your bill
without making an account.     ← serif italic, accent
```

The second line is set in the document serif even on the instrument ground.
That is the one deliberate crossing of the boundary, and it is what ties the two
halves together rather than leaving them as two unrelated pages.

## 7. What is not here

No logo, no mark, no illustration. The provider is a fixture and inventing
branding for a fictional health system would be decoration standing in for
design. The eyebrow carries the provider name and that is enough.

No dark mode toggle. Both grounds are already on every page by construction, so
a theme switch would invert a semantic system rather than accommodate a
preference.
