# NodeVelo — DESIGN.md (locked design system)

> **Prototype.** This file is the ground truth a design-audit detector reads (the idea borrowed from
> [pbakaus/impeccable](https://github.com/pbakaus/impeccable)). It is NOT wired into the app — it lives
> under `prototypes/` so an audit can check components against our *actual* system without us adopting
> a third-party dependency. See [`README.md`](./README.md).

## Typography
- **UI / headings / body:** Chakra Petch (`--font-chakra` / `font-sans`). Weights 400·500·600·700.
- **Numeric & data values:** JetBrains Mono (`--font-jetbrains` / `font-mono`).
- **Wordmark only:** Warriot Tech Italic (`--font-warriot`). Used solely for "NodeVelo".
- Micro-labels (eyebrows) are intentionally `text-[10px]`/`text-[11px]`, UPPERCASE, `tracking-wide`,
  muted. These are *labels*, not body copy — the tiny-text rule treats them as an allowed exception.

## Color tokens (the only literals allowed)
Roles (from `globals.css`):
- `--background` `#fafafa` light / `#09090b` dark · `--foreground` `#18181b` light / `#f4f4f5` dark
- **accent (primary action):** `#ff49c8` (neon pink) — `--color-accent`
- **synced (live/secondary):** `#00d4ff` (cyan) — `--color-synced`

Neutrals: the Tailwind **zinc** ramp only (50/100/200/300/400/500/600/700/800/900/950).
Status: emerald/green = good, amber = warning, red/rose = error.
Workout-type accents (from `lib/workout-types.ts`, the only other allowed hard hexes):
`#10b981` Z2 · `#06b6d4` Recovery · `#f59e0b` Threshold · `#f97316` VO2max · `#f43f5e` SIT ·
`#d946ef` RaceSim · `#8b5cf6` Strength.

**Allowed arbitrary hexes in classNames:** `#ff49c8`, `#00d4ff` (+ the workout-type hexes above).
Any other `[#…]` literal is drift → should become a token or a zinc/status class.

## Radii & surfaces
- Standard card: `rounded-lg` + 1px border (`zinc-200` / dark `zinc-700`) + `bg-white` / dark `zinc-800`.
- The one hero surface (active block) is the deliberate exception: `rounded-none border-2` + neon glow.
- Inset tiles: `rounded-md` + `bg-zinc-50` / dark `bg-zinc-900`.
- Pills/badges: `rounded-full`.

## Dual-theme rule (hard)
Every color utility (`bg-*`, `text-*`, `border-*`) on a surface must have a `dark:` counterpart, or be a
theme-agnostic token. A light-only color is a dark-mode regression.

## Intentional exceptions (documented waivers — the audit may flag, we keep)
- **`gradient-text`** on the wordmark (`bg-clip-text` + pink→cyan gradient) — brand, dark mode only.
- **`dark-glow`** shadows on hero/active cards — part of the cyberpunk language.
- **micro-label tiny-text** (`text-[10px]`/`[11px]` UPPERCASE labels) — labels, not body.
- **numbered section markers** (Today zones 1·2·3) — intentional information scent, not an AI tell.

## Affordance conventions
- Metric explanations use the **`InfoDot` (ⓘ) + `MetricTip`** popover — *not* a native `title=`.
  A native `title` on an informational element is an inconsistency to flag (buttons may keep `title`).
