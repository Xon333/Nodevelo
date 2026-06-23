# Audit run + investigation

> `node prototypes/impeccable-audit/detect.mjs components/*.tsx components/dashboard/*.tsx app/**/*.tsx`
> Detector is now **DESIGN.md-aware** (reads the repo-root [`/DESIGN.md`](../../DESIGN.md) palette) and
> hardened against the false positives the first pass turned up. Prototype — no app coupling.

## What the first pass flagged → what it actually was

Every deterministic hit was investigated against the real code. The result on a twice-refined,
dark-first codebase: **no must-fix UI bugs.** The findings were intentional or detector imprecision —
so the "fix" was to make the detector trustworthy and to *document* the one legitimate token.

| First-pass finding | Reality | Action |
|---|---|---|
| `off-palette-color` `#7fe7ff` ×2 | **Legit, not drift** — bright cyan for *text on a `[#00d4ff]/10` cyan-tinted surface*, where plain `#00d4ff` is low-contrast against its own hue. | Documented as a sanctioned token in DESIGN.md §2; detector now reads DESIGN.md → **0**. |
| `light-only-color` `bg-white` ×1 | **Toggle-switch knob** — conventionally white on its track in both themes. | Knob/dot pattern exempted → **0**. |
| `em-dash-overuse` ×1 | **False positive** — the 3rd "—" was the no-data placeholder glyph (`value … : "—"`), not prose. | Now counts em-dashes *inside one string* + exempts the glyph → **0**. |
| `native-title-tooltip` 39 | **~Half false** — `<Section title=>` / `<Card title=>` are component props, not native tooltips; some were buttons. | Component-prop + button lines skipped → **19** genuine native titles (all per-datum detail, now allowed). |
| `gradient-text` 2 | **Waived** — the wordmark (DESIGN.md). | Kept as low-severity advisory. |
| `tiny-text` 99 | **Intentional** — dense data UI; the rule already exempts uppercase eyebrow labels, so these are real sub-12px values. | Density tradeoff, not a bug — left as an explicit advisory. |

## Hardened result (trustworthy)
`— 120 line-level findings (tiny-text:99, native-title-tooltip:19, gradient-text:2)`

- **`tiny-text` 99** — a deliberate density decision (the data UI runs tight). Not a defect; the tool
  *surfaces the decision* rather than letting it drift.
- **`native-title-tooltip` 19** — genuine native `title=` on DOM elements, all **per-datum detail**
  (a rep's "held 95% of duration", a PR tile's W/kg, a calendar cell's date). DESIGN.md §7 sanctions
  this; an ⓘ per datum would clutter. Advisory only — migrate any that are *labelled metric
  explanations* to `InfoDot`, none here clearly are.
- **`gradient-text` 2** — the wordmark. Waived.

## Confirmed separately
- **Zero genuine dark-mode gaps.** A targeted scan for light-mode color utilities with no `dark:`
  sibling found only the toggle knob (intentional). The app is dark-complete — consistent with the
  dark-first mandate now written into DESIGN.md.

## Takeaway
Investigating deterministic flags is exactly the value: it converted "144 findings" into "the codebase
is clean, one undocumented-but-legit token now documented, and the detector is sharper." That's the
case for keeping a `DESIGN.md` + an in-repo detector and *not* trusting raw counts without a look.
