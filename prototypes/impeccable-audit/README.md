# Impeccable-style design audit — PROTOTYPE

A working spike of the [pbakaus/impeccable](https://github.com/pbakaus/impeccable) idea —
**deterministic, DESIGN.md-aware design-quality checks** — adapted to NodeVelo's Tailwind classes and
our own locked design system. Built to evaluate whether the *approach* is worth adopting (see the
research note in [`../../research.md`](../../research.md)).

**This is a prototype, not part of the app.** It lives under `prototypes/`, ships no dependency, is not
imported anywhere, and is not in the TS build. Nothing in the app was changed.

## Files
- [`DESIGN.md`](./DESIGN.md) — NodeVelo's locked design system (fonts, color tokens, radii, dual-theme
  rule, the allowed-hex set, and the documented intentional waivers). The audit's ground truth.
- [`detect.mjs`](./detect.mjs) — a zero-dependency Node detector (~8 rules) doing source-text checks on
  `.tsx`, tuned to our system so the output is signal not noise (tiny-text exempts uppercase eyebrow
  labels; em-dash uses impeccable's >2 threshold; the palette check reads DESIGN.md's allowed hexes).
- [`AUDIT.md`](./AUDIT.md) — the findings from running it against the current components, with a verdict
  per rule and a sample qualitative critique pass.

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
