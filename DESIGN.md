# NodeVelo — DESIGN.md

The design source of truth. Precise tokens + conventions so the UI can be refined without drift, and
so a design audit (see [`prototypes/impeccable-audit/`](./prototypes/impeccable-audit/)) has ground
truth to check against. **Refinement reference, not a redesign brief** — this documents the system we
have.

> **Dark mode is the canonical theme.** The athlete uses dark exclusively; light mode is supported but
> secondary. **Design, decide, and verify in dark first.** A dark-mode regression is a real bug; a
> light-mode imperfection is low priority. Every surface still ships a light fallback, but dark is the
> one that must be right.

---

## 1 · Themes (exact)

From `app/globals.css`:

| Role | Dark (primary) | Light (secondary) |
|---|---|---|
| `--background` | `#09090b` (zinc-950) | `#fafafa` (zinc-50) |
| `--foreground` | `#f4f4f5` (zinc-100) | `#18181b` (zinc-900) |
| Surface (card) | `zinc-800` `#27272a` | `white` |
| Surface border | `zinc-700` | `zinc-200` |
| Inset tile | `zinc-900` | `zinc-50` |
| Muted text | `zinc-400` | `zinc-500` |

Dark mode is activated by the `.dark` class on `<html>` (custom variant `dark (&:where(.dark, .dark *))`).

---

## 2 · Color tokens (the only literals allowed)

**Accents** (defined as theme vars `--color-accent` / `--color-synced`, but in practice written as
Tailwind **arbitrary literals with opacity** — that is the established convention, e.g.
`dark:bg-[#00d4ff]/10`, `dark:text-[#ff49c8]`):
- **accent / primary action:** `#ff49c8` (neon pink) — active nav, primary buttons (dark = outline),
  the wordmark gradient, `CyberFrame` pink accent.
- **synced / live / secondary:** `#00d4ff` (cyan) — synced data, secondary highlights, glows.
- **bright-cyan (text on cyan-tint):** `#7fe7ff` — *sanctioned variant.* Cyan body text on a
  cyan-tinted surface (`dark:text-[#7fe7ff]` on `dark:bg-[#00d4ff]/10`) where plain `#00d4ff` would be
  low-contrast against its own hue. Use **only** for text sitting on a `[#00d4ff]/10` surface.

**Neutrals:** the Tailwind **zinc** ramp only (50…950). No other gray.

**Status:** emerald/green = good · amber = warning/caution · red & rose = error/danger.

**Workout-type accents** (`lib/workout-types.ts` — the only other allowed hard hexes):
`#10b981` Z2 · `#06b6d4` Recovery · `#f59e0b` Threshold · `#f97316` VO2max · `#f43f5e` SIT ·
`#d946ef` RaceSim · `#8b5cf6` Strength.

**Allowed literal hexes** (anything else in a className is drift → token or zinc/status class):
`#ff49c8`, `#00d4ff`, `#7fe7ff`, and the seven workout-type hexes above.

---

## 3 · Typography (exact)

- **UI / headings / body:** Chakra Petch (`--font-chakra`, `font-sans`). Weights **400 · 500 · 600 · 700**.
- **All numeric & data values** (watts, %, TSB, scores, dates, durations): JetBrains Mono
  (`--font-jetbrains`, `font-mono`). If it's a number the athlete reads as data, it's mono.
- **Wordmark only:** Warriot Tech Italic (`--font-warriot`) — used solely for "NodeVelo".
**The type ladder (one tier per role — don't invent in-between sizes):**

| Role | Treatment | Where |
|---|---|---|
| **Page title** (`h1`) | `text-lg font-semibold` foreground (`text-zinc-900` / dark `text-zinc-100`) | one per page |
| **Card / section title** | `text-xs font-semibold` muted (`text-zinc-500` / dark `text-zinc-400`), **sentence case** | the `Card` primitive — the single card-title treatment on Settings/Profile/utility pages |
| **Zone eyebrow** | `text-[11px] font-semibold uppercase tracking-wide` muted | the `Zone` primitive — dashboard command-center priority path **only** |
| **Micro-label** | `text-[10px] uppercase tracking-wide` muted (`text-zinc-400`) | tile/datum labels (`StatTile`/`TrendTile`/`SectionDivider`) |
| **Body** | `text-sm`/`text-xs` (`text-zinc-600` / dark `text-zinc-300`) | prose, hints |
| **Mono value** | `font-mono` (size per context, default `text-sm`) | every number the athlete reads as data |

- **Uppercase is reserved** for the Zone eyebrow + micro-labels (the only sub-12px forms allowed).
  General card titles are sentence case. Section cards must come from the `Card` primitive — no
  hand-rolled card chrome, so the title tier can't drift.

---

## 4 · Surfaces, radii, elevation

- **Standard card:** `rounded-lg` + 1px border (`zinc-200` / dark `zinc-700`) + `bg-white` / dark
  `bg-zinc-800`, padding `px-4 py-3`. This is the **only** card padding — get it from the `Card`
  primitive. (Legacy `px-5 py-4` / `px-4 py-4` on Settings/Profile was drift, now converged.)
- **Hero surface (the one emphasized card — active block):** the deliberate exception —
  `rounded-none border-2`, neon border + glow in dark
  (`dark:border-[#00d4ff]/55 dark:shadow-[0_0_28px_-8px_rgba(0,212,255,0.45)]`), wraps a `CyberFrame`.
- **Inset tile:** `rounded-md` + `bg-zinc-50` / dark `bg-zinc-900`.
- **Pill / badge:** `rounded-full`, type- or status-colored, small.
- **Glow** is dark-mode-only and reserved for emphasis (hero card, notices). Form:
  `dark:shadow-[0_0_<blur>px_-<spread>px_rgba(<accent>,<alpha>)]`. Don't scatter it on ordinary cards.

---

## 5 · Dark-mode texture & decoration (the cyberpunk layer)

- **Duotone grid** on `body` (dark only): two 1px gradients,
  `rgba(255,73,200,0.025)` (pink) + `rgba(0,212,255,0.022)` (cyan), `44px` tile, fixed attachment.
- **`CyberFrame`** (`components/ui.tsx`): corner brackets + scanlines + a top data-stream line, dark
  only, accent `pink` | `cyan`. Place inside a `relative` card, content in `relative z-10`. Reserve for
  hero/emphasis surfaces, not every card.
- **Wordmark:** pink→cyan `bg-clip-text` gradient + soft `drop-shadow` glow, dark only.

---

## 6 · Component vocabulary (`components/ui.tsx` + dashboard)
- **`Card`** — eyebrow title (+ optional `ⓘ` tip via `InfoDot`) + optional right hint.
- **`StatTile` / `TrendTile`** — uppercase micro-label, big mono value, optional cyan trend arrow.
- **`InfoDot` + `MetricTip`** — the ⓘ hover popover (`w-64 max-w-[80vw]`, `align` left/right) for
  **metric explanations**. This is the standard "what is this number?" affordance.
- **`CyberFrame`** — see §5.
- **Pills** — `rounded-full` status/type chips; long content must `min-w-0 break-words` (never `shrink-0`).

---

## 7 · Conventions & rules

- **Dual-theme (hard):** every `bg-*`/`text-*`/`border-*` on a surface has a `dark:` counterpart or is a
  theme-agnostic token. Dark is verified first.
- **Affordances:**
  - **Metric explanations** (what a labelled number means) → `InfoDot`/`MetricTip`. Not a native `title`.
  - **Dense per-datum detail** (e.g. a per-rep "held 95% of duration", a sparkline point's prior best)
    → a native `title=` is acceptable; an ⓘ per datum would clutter. Buttons keep `title` freely.
- **No-data glyph:** an em-dash `"—"` is the canonical "no value" placeholder for a mono slot.
- **Copy:** coach voice, question headers ("Readiness — can I go hard?"). At most two em-dashes per
  sentence of body copy (more is an AI cadence tell).
- **Mobile:** zero horizontal overflow (`<main>` carries `max-sm:overflow-x-clip` as the backstop;
  long pills wrap). Hover affordances aren't relied on for touch.

---

## 8 · Layout
- **Desktop:** fixed left nav rail `w-44`; content centered `max-w-5xl`, offset `sm:pl-44`. The Today
  page is viewport-locked (`lg:h-[calc(100dvh-4rem)] lg:overflow-hidden`) with cards scrolling internally.
- **Mobile:** sticky top bar (wordmark + Model brain icon + sync + theme) + bottom tab bar (icon +
  tiny label). Model is reached via the top-bar brain icon, not a 7th bottom tab; on desktop it's the
  7th rail tab.
- **Decision-critical content above the fold** on open (esp. Today/Profile/Plan).

### Per-page hierarchy (which data · why · where)

Each page has **one job**. Fold-1 = the decision-critical glance that answers it; supporting data sits
below; deep/per-datum detail is **collapsed or on-hover**, never deleted (the anti-black-box rule — the
athlete can always reach what the brain knows, it just isn't shouting). Progressive disclosure is the
default: summary first, detail on demand (`<details>` for blocks, `MetricTip`/`InfoDot` for per-datum).

| Page | The one job | Leads (fold-1) | Supporting | Collapsed / drill-down |
|---|---|---|---|---|
| **Today** | "Can I go hard — and what's my session?" | Readiness (state · form · alerts), then the session summary (plan vs actual · execution score · key metrics · fuel) | Trend pulse · coach note · ask-coach | **Power execution** (per-rep · trace · zone bars) → `<details>`, adherence headline kept in the summary |
| **Plan** | "What's my block, and what's next?" | Active block hero (calendar + progress) | Goals · this-week debrief | Block history → `<details>`; generation form collapses while a block is active |
| **Trends** | "Am I improving over time?" | Last-7-days glance + coach insights | the trend charts (Pw:HR · CTL · execution · volume · fueling) — **review depth is intentional here** | Block-history long-view (hero) |
| **Profile** | "Who am I — what does the coach plan around?" | Rider-profile read (power-curve shape) | PRs · goals · weakpoints · nutrition | "Edit →" routes to Knowledge |
| **Model** | "What does the brain know about me — and why?" | What drives your state (ranked drivers) | coaching directives + track record · per-athlete calibration | contest/correct (manual override) — next |
| **Settings** | "Tune generation + platform behaviour" | Block-generation knobs | AI usage · backup | — |

**Bespoke-per-use-case elements** (don't force these into a generic `StatTile`): the readiness gauge
(`AthleteStateCard`), the coach's-read glance (`CoachSnapshotCard`), the prescription-vs-execution rep
breakdown, the calibration learning-state. Each stays inside the token system above.

---

## 9 · Motion
Subtle and functional: `transition-colors` on interactive elements, `animate-spin` on the sync glyph
while syncing, `opacity` fade on tooltips/notices. No bounce/elastic easing, no decorative motion.

---

## 10 · Documented waivers (intentional; an audit may flag, we keep)
- **Wordmark `gradient-text`** — brand, dark only.
- **`dark-glow` shadows** on hero/notice surfaces — the cyberpunk language.
- **micro-label tiny-text** (`text-[10px]`/`[11px]` UPPERCASE) — labels, not body.
- **numbered section markers** (Today zones 1·2·3) — intentional information scent.
- **toggle-knob `bg-white`** with no `dark:` — a switch knob is white on its track in both themes.
- **no-data `"—"`** em-dash glyph in mono value slots.
- **`#7fe7ff`** bright-cyan for text on a `[#00d4ff]/10` surface (see §2).
