# Impeccable-style design audit — PROTOTYPE

A working spike of the [pbakaus/impeccable](https://github.com/pbakaus/impeccable) idea —
**deterministic, DESIGN.md-aware design-quality checks** — adapted to NodeVelo's Tailwind classes and
our own locked design system. Built to evaluate whether the *approach* is worth adopting (see the
research note in [`../../research.md`](../../research.md)).

**This is a prototype, not part of the app.** It lives under `prototypes/`, ships no dependency, is not
imported anywhere, and is not in the TS build. Nothing in the app was changed.

## Files
- **Ground truth → [`/DESIGN.md`](../../DESIGN.md)** (repo root) — NodeVelo's canonical, dark-first design
  system (fonts, color tokens, radii, dual-theme rule, allowed-hex set, intentional waivers). The
  detector reads this file's hexes directly, so a sanctioned token is never flagged as drift.
- [`detect.mjs`](./detect.mjs) — a zero-dependency Node detector (~8 rules) doing source-text checks on
  `.tsx`, tuned to our system so the output is signal not noise (tiny-text exempts uppercase eyebrow
  labels; em-dash counts within one string + exempts the no-data glyph; native-title skips component
  props/buttons; light-only exempts toggle knobs; the palette check reads `/DESIGN.md`).
- [`AUDIT.md`](./AUDIT.md) — the run output, the first-pass→reality investigation, and the trustworthy
  hardened result.

## Run it
```bash
node prototypes/impeccable-audit/detect.mjs components/*.tsx components/dashboard/*.tsx
```
Exit code `2` when there are findings (CI-friendly), `0` when clean.

## Rules implemented (adapted from impeccable's registry)
`off-palette-color` (design-system) · `tiny-text` (quality, label-aware) · `gray-on-color` (quality) ·
`light-only-color` (NodeVelo dual-theme) · `native-title-tooltip` (NodeVelo affordance consistency) ·
`gradient-text` (slop, wordmark-waived) · `em-dash-overuse` (slop) · `arbitrary-sprawl` (scale drift).

## Recommendation
Adopt the **approach**, not the npm package: keep a `DESIGN.md` as the design source of truth and grow
this detector with NodeVelo-specific rules (the `title=`→`InfoDot` and dual-theme checks are ours, not
impeccable's — proof the pattern extends). Lifting the rules in-repo avoids the supply-chain / agent-
instruction surface of a third-party skill, which fits the zero-bloat + deterministic-core mandates.
Pair with the **ux-writing-skill** ideas for the copy layer the detectors can't judge.
