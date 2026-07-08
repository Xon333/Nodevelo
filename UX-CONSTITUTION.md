# NodeVelo — UX Constitution

How to think when designing or changing any NodeVelo surface. [`DESIGN.md`](DESIGN.md) says what the
UI *looks like* (tokens, type, surfaces); this document says how to *decide*. Precedence:
Constitution → DESIGN.md → component convention. [`UX-MASTERPLAN.md`](UX-MASTERPLAN.md) ranks the
open work against these rules.

Amendment: change this document in the same commit that proves a rule wrong. An intentional
exception is a *waiver* — documented with its reason (the DESIGN.md §10 pattern), not silently shipped.

---

## 1 · Prime directive

**Effortless beats beautiful.** NodeVelo is a coach, not a dashboard: every screen exists to move
the athlete to a better training decision with less thinking. Success is measured by decision speed,
decision quality, and trust — never by visual novelty. If a change makes the page prettier and the
decision slower, it's a regression.

## 2 · The athlete we design for

Design for the *worst realistic reader*, who is simultaneously:

- **fatigued** (post-ride or under-recovered — degraded working memory),
- **on a phone, one-handed, possibly outdoors in sunlight**,
- **opening the app for under 30 seconds** to answer one question,
- possibly **ADHD** (attention is expensive; competing signals are hostile),
- possibly **returning after weeks away** (no memory of app vocabulary).

Consequences (non-negotiable):
- Verdict first: the answer to the page's question sits at the top, before its evidence.
- Touch-first: nothing decision-critical may be hover-only.
- Interactive targets the athlete uses routinely: comfortably tappable (~40px effective). Sub-24px
  targets are allowed only for desktop-side power affordances that have a mobile-usable equivalent.
- One primary action per page; everything else is visibly subordinate.

## 3 · One question per screen

The per-page one-job table in DESIGN.md §8 is constitutional. A new element must name which part of
its page's question it serves — "which question does this answer, and is that this page's question?"
If it answers another page's question, it belongs there (or is a link). If it answers a question
already answered on this page, it must merge with or subordinate to the existing answer (see §4).

A page may serve two moments **if it presents exactly one at a time** (a moment-aware layout —
Today's pre-ride/post-ride auto-switch). The mode must be data-derived, never a question the
athlete answers; a quiet manual flip may exist for the edge case, but it never persists.

## 4 · The verdict hierarchy

When several instruments speak to the same question, they are arranged as **one verdict → supporting
signals → per-datum evidence**. Never present two same-altitude verdicts on the same question without
stating which one the coach acts on and how the other feeds it. Redundancy without reconciliation is
how trust dies: the day two instruments visibly disagree with no explanation, every instrument
becomes suspect.

## 5 · Trust: provenance, confidence, contestability

Every number the athlete reads must be able to answer:

| Question | Canonical pattern |
|---|---|
| Where did this come from? | `synced` badge (measured) · tip naming the derivation (inferred) · calibration provenance (learned) |
| How sure is the system? | confidence tier — visible when not high, quiet when high (AthleteStateCard pattern) |
| Why does this recommendation exist? | ranked drivers / stated evidence (StateDriversCard pattern) |
| Has this kind of advice been right before? | track record beside the advice (coach-accuracy pattern) |
| Can I correct it? | contest/correct override with an escape back to the learned value (CalibrationPanel pattern) |

Uncertainty is stated, not hidden. And the inverse rule: **silent failure is a trust violation.** A
best-effort feature that fails must degrade visibly (a quiet "couldn't load — retry" in its slot),
never simply vanish — the athlete cannot tell absence-of-data from breakage.

## 6 · Progressive disclosure

Summary first, detail on demand — `<details>` for blocks, tip affordances for per-datum. Two limits:

- **A tip is one breath long** — ≤ 2 sentences. Anything longer is content, not a tip: it lives on
  /model, in a drill-down, or nowhere.
- **Disclosure must work by tap and keyboard, not hover alone.** Hover is a desktop accelerator, never
  the only door. (This is the constitution's largest open violation — see masterplan S1-2.)

Hidden ≠ deleted: the athlete can always reach what the brain knows (the anti-black-box rule).

## 7 · Language

- Coach voice, question headers ("Readiness — can I go hard?"), sentence case.
- **One vocabulary per concept.** The athlete-state register is `primed / ready / steady / strained /
  depleted`; a new instrument reuses an existing register or explicitly replaces it — it never
  introduces a synonym register for the same concept.
- Jargon policy: acronyms (TSB, IF, NP, ACWR) are fine *paired* — value + plain-language band +
  direction ("Form +3 · fresh"). Naked acronyms with no meaning attached don't ship.
- **No developer language in athlete-facing copy**: no env-var names, HTTP codes, file paths, or
  stack terms. ("ANTHROPIC_API_KEY is not set" is a bug, not a message.)
- Same thing, same name, everywhere — a destination is not "Knowledge Base" on desktop and "Docs" on
  mobile.

## 8 · Interaction rules

- **Destructive actions** confirm in-product (never `window.confirm`), state their consequence
  ("deletes the plan; ridden history is kept"), and prefer undo over confirmation where cheap.
- **Every async action reports its outcome.** Success, failure, or progress — a button that quietly
  returns to rest on failure is a lie.
- **Empty states are onboarding.** State what's missing, why it matters, and the *one* action that
  fixes it — with the link. A dead-end empty state ("No session planned.") is a bug.
- **Loading holds layout**: skeleton or reserved space; content must not jump on resolve. The
  canonical theme (dark) must render dark from the first paint — a light flash is a dark-mode
  regression (DESIGN.md's "real bug" clause).

## 9 · Accessibility floor

- Everything interactive is keyboard-reachable with a visible focus state.
- Explanations (tips, drivers, calendar detail) are exposed to assistive tech — a hover-revealed
  `<span>` with no focus/aria semantics doesn't count as disclosure.
- AA contrast for anything decision-critical. The waivered micro-labels (DESIGN.md §10) stay
  *labels*; the moment one carries a decision, it graduates to a compliant tier.

## 10 · Ban list

Anti-patterns that do not ship (each has bitten already or violates a rule above):

1. Hover-only critical information (§6).
2. Silent `catch {}` feature disappearance (§5).
3. Native browser dialogs for product decisions (§8).
4. Developer jargon in athlete copy (§7).
5. Two same-altitude verdicts on one question (§4).
6. Tooltip essays (§6).
7. Same-looking metrics with different windows and near-identical labels on one screen (§7 —
   e.g. two `e/m/h` splits, 7d vs 28d, with nothing flagging the difference).
8. Unlabeled icon-only navigation for a primary destination (the mobile Model brain icon is a
   grandfathered waiver, under review in the masterplan).

## 11 · Before shipping any surface change

1. What question does this page answer — did the change sharpen or blur it?
2. What decision does the athlete make here — faster or slower now?
3. What supports the decision, what's evidence, what's hidden until requested?
4. Dark mode first, then light; mobile pass (touch, one hand, no horizontal overflow).
5. Sweep the ban list (§10).
6. If it added a rule or broke one: amend this document in the same commit.
