# NodeVelo — UX Masterplan v2 · the zero-based redesign

> **Status: designed 2026-07-08 · Wave 1 shipped 2026-07-08 (§7), Waves 2–5 open.** Produced by the moment-first zero-based
> review of all seven surfaces (live-app walkthrough with real data, desktop 1440×900, commit
> `3abbe3e`). Every card, metric, and nav slot re-earned its place or was moved/demoted/cut.
> Governed by [`UX-CONSTITUTION.md`](UX-CONSTITUTION.md); visual tokens stay in
> [`DESIGN.md`](DESIGN.md). Implementation sessions execute from §7 (waves).
>
> **v1 (the 2026-07-03 defect audit):** all four waves shipped 2026-07-04/05 — summary in
> [ARCHIVE.md](ARCHIVE.md), full text in git history of this file. Open remnants carried into v2:
> S2-4 (mobile nav) is resolved by §3's design (recorded, still deferred to mobile work);
> S3-5 (re-entry summary) remains the roadmap-tier note (`← #2`).

**Scope decisions (locked with the athlete):** zero-based justification, everything on the table
including page set and nav · desktop-first, mobile implications recorded not executed · driving
pain: cognitive load + misplaced prominence, felt on every page.

---

## 1 · The moment map (the framework)

Every element binds to a moment and ranks within it. **The moment — not the page — owns prominence.**

| # | Moment | Frequency · attention | The question | Attention budget |
|---|---|---|---|---|
| M1 | Pre-ride glance | daily · 30 s, degraded | Can I go hard — what's the session? | ≤3 elements: alert (if any) → verdict → prescription |
| M2 | Post-ride debrief | daily · 2–5 min | How did it go — what did the coach see — what do I eat? | score + ≤3-sentence takeaway + fuel; rest disclosed |
| M3 | Week check | 1–2×/wk · 1 min | Where am I in the block, what's next? | calendar hero + week strip, nothing else fold-1 |
| M4 | Block boundary | ~monthly · 10 min | Debrief the block, generate the next | generator + season context (expanded only here) |
| M5 | Progress review | ~monthly · 5–10 min | Am I improving? | verdict line + ranked insights first, charts as evidence |
| M6 | Trust check | rare · triggered | Why did it say that? Fix it. | drivers → calibration → track record, one surface |
| M7 | Identity & config | rare | Set who I am / how it behaves | read view first, editing disclosed |

Page ↔ moment: Today = M1+M2 (moment-aware, §4) · Plan = M3+M4 · Trends = M5 · Model = M6 ·
Profile/Settings/Knowledge = M7.

### Court rules (applied throughout)

1. **One owner per number.** Every metric has exactly one canonical home (§2 ledger); anywhere
   else it is a link, or it dies.
2. **One verdict per page, fold-1, before evidence** (Constitution §4) — now enforced on Trends too.
3. **Hard caps:** fold-1 ≤ 3 elements + 1 primary action; visible prose ≤ 3 sentences per card
   (coach note included); a flat rail of 7 equal tabs breaks the budget → nav is tiered.
4. **Hidden ≠ deleted stays law** — everything demoted remains one disclosure away.

## 2 · Cross-page moves ledger

The single source of truth for "where does X live now." Implementation must leave no orphan copies.

| Element | Was | Now (canonical) | Elsewhere |
|---|---|---|---|
| Trend Pulse (CTL/volume/zones mini) | Today | **Trends** (its charts already exist there) | — (rail trio makes Trends one click) |
| Coach note (full text) | Today, ~250 words visible | **Today post-ride, ≤3 sentences** | full note behind `<details>` |
| Weekly hours/load ("this week") | Today signals · Plan panel · Trends tiles | **Plan** week strip (in-hero) | — |
| Directive chips (5 categories) | Model (W1 planning found the "Plan chips" were actually goals rows — see goals-list row) | **Model** · Standing guidance | generator consumes internally |
| Current performance (FTP · tHR · maxHR) | Plan + Profile-ish | **Profile** rider read | expanded generator's season readout |
| Full goals & weakpoints list | Plan + Profile | **Profile** (read view + inline edit) | Plan keeps derived "this block targets…" line |
| Season (objective + events) | Profile | **Plan** (compact card by the generator) | — |
| Effort bands / zones table | Model | **Profile** (declared data, synced) | — |
| Latest weight · last intake | Trends "Last 7 days" tiles | **Trends** · Load & fuel group | weight also in Profile rider read |
| 7-day load tile | Trends | **Plan** week strip | — |
| Weekly volume chart | Trends top-level | **Trends** · Load & fuel (small, context) | — |
| Delete block | Plan hero top-right | **Plan** overflow "…" menu (in-product confirm kept) | — |

Sorting test for Profile vs Model: **Profile = what the athlete declares; Model = what the coach
learned.** Every future element sorts by that test.

## 3 · IA & navigation — tiered rail, all 7 pages stay

**Page-set verdict: keep all seven surfaces; no merges.** Each maps cleanly to a moment. The
tempting Profile+Model merge fails the moment test (identity edits vs. trust checks — different
questions). The clutter problem is equal prominence for unequal pages, not page count.

**Desktop rail (approved):** three tiers.

```
● Today  ● Plan  ● Trends          ← full weight, daily
YOU & THE COACH                    ← group label, quiet
○ Profile  ○ Model                 ← smaller/dimmer
SYSTEM
○ Settings  ○ Knowledge
```

Zero routing changes; everything one click; scan cost 3 + labels instead of 7 equals.

**One name everywhere:** the destination is **"Knowledge"** — retire "Knowledge Base" (desktop
rail) and "Docs" (mobile tab).

**Mobile (recorded, deferred):** bottom bar = the trio + a "More" sheet holding
Profile/Model/Settings/Knowledge with full labels. Retires the unlabeled brain icon → resolves
v1's deferred S2-4 and ban-list §10.8.

## 4 · Today — one page, two moments (auto-switch)

**The problem:** Today served M1 and M2 simultaneously in one fixed layout — pre-ride you waded
through debrief content, post-ride past prescription scaffolding. Plus Trend Pulse carried Trends'
page question verbatim ("Am I improving?").

**Mode detection (approved: auto-switch, no tabs):** a synced ride matching today's *local* date
(`localToday()`, per AGENTS.md) exists → **post-ride mode**; otherwise **pre-ride mode**. Rest day
(no planned session): pre-ride skeleton, session card states rest + tomorrow's preview. A quiet
corner link ("planned ↔ debrief") flips the view client-side for the odd case (evening plan-check
after a morning ride); no persistence — auto mode re-asserts on next load.

**Pre-ride (M1, ≤3 elements, fits one screen by construction):**
1. Readiness alerts — only when triggered (aviation rule: alarms outrank verdicts).
2. Verdict — `AthleteStateCard` unchanged (score/band/recommendation + why? →).
3. **Session prescription card, promoted:** name, type chip, duration, and the full step/rep
   prescription with targets — pre-ride you want *what am I about to ride*, not post-hoc analysis.
   Morning check-in renders inline here when relevant (S2-9 rules unchanged).
Quiet footer row: ▸ supporting signals · ▸ yesterday's debrief · ▸ ask coach.

**Post-ride (M2):**
1. Alerts (if any).
2. **Verdict compressed to a strip** — score · band · recommendation · why? → in one line; the
   day's go/no-go decision is already made.
3. **Debrief hero:** execution score + label · planned-vs-actual line · IF (with basis) / NP / avg ·
   coach takeaway **≤3 sentences visible**, full note behind `<details>` · power execution
   drill-down (existing `<details>`) · disposition chips with their InfoDot · Post to Intervals.icu.
4. **"Eat today" fuel card:** advised intake + formula (base + ride + buffer) — promoted; this is
   the decision that still remains post-ride.
Collapsed: supporting signals · ask coach.

**Cuts:** Trend Pulse leaves Today entirely (ledger). **Viewport-lock retires** — pre-ride fits
without it; post-ride scrolls naturally like every other page. The internal-scroll edge-fade
machinery (v1 S3-3) retires with it if no other call site needs it.

## 5 · Trends — from chart pile to a three-axis answer (approved: verdict + grouped scroll)

**The problem:** 9 equal-weight sections; the page opened with weight/intake tiles (fuel status,
not improvement); the answer to "am I improving?" had to be synthesized by the athlete every visit.

**Fold-1 — the verdict strip:** one sentence, three axes, each honestly derived from existing
signals and each linking to its group below:

> **Improving** — engine ↑ (CTL slope + Pw:HR trend) · delivery steady (execution avg, direction) ·
> fueling on target (intake vs advised)

Confidence/derivation stated per Constitution §5 (tip naming the derivation). Below it, the ranked
**coach insights** (with validation marks) promoted into fold-1 — top 3 visible, rest disclosed.

**Then four named groups** (group gap = 2× card gap; uniform chart-card height):

- **ENGINE — is the motor getting bigger?** Pw:HR decoupling · CTL, side by side.
- **DELIVERY — do I ride what's prescribed?** Execution-quality per-session bars; per-type
  planned-vs-actual becomes a **toggle on the same card** (the two sections merge — same question,
  two zoom levels).
- **LOAD & FUEL — am I feeding the work?** Fueling & weight (absorbs latest weight / trend / last
  intake from the killed tile row) · weekly volume as the small context chart.
- **MILESTONES.** Recent baselines row (W/kg · weekly hours · rides/wk · avg load) · block history
  stays collapsed at the bottom.

**Cuts:** the "Last 7 days" tile row (tenants relocated per ledger) · the "not a duplicate of
intervals.icu" mission-statement intro (the page question header replaces it).

## 6 · The remaining pages

### Plan — the calendar earns the whole fold (approved: week strip in-hero)

- **Hero gains orientation:** header "Active block — week N of M · <week character>"; a loud TODAY
  marker; a "next: <session>, <when>" pointer; week-row labels (load/build/peak/taper).
- **Week strip inside the hero** (the separate "This week" panel dies): hours vs target · load ·
  top session — one glance answers "where am I" and "how's the week going."
- **Reschedule-ready by design:** the per-day tap/focus popover keeps a reserved actions row —
  "move session…" lands there when rescheduling ships; the grid is designed as interactive, not
  read-only. (Athlete note folded in 2026-07-08.)
- **"This block targets: …"** one derived line (from block goal/weakpoint) replaces the Goals
  section (full list → Profile; directives → Model per ledger).
- **Season card arrives** (from Profile): compact objective + upcoming events, sitting beside the
  generator it feeds.
- Generator stays collapsed while a block is active; expanded (M4) it keeps the season readout and
  gains one line: *"uses your volume targets & structure — edit in Settings →"*.
- Kept: day popovers, finished-block CTA, preview-then-write microcopy, block history `<details>`.
  Delete block → overflow menu (ledger).

### Profile — the rider dossier (approved: inline-expand editing)

Order: **1) THE RIDER READ** (hero): power curve + phenotype line, current performance
(FTP · tHR · maxHR, from Plan), weight, compact PR strip — provenance badges kept.
**2) ZONES & EFFORT BANDS** (from Model, synced badge, compact table).
**3) GOALS & WEAKPOINTS** — compact read view (goal → target · type), the edit form hidden behind
an inline "▸ edit" expand (no modal — consistent with the app's disclosure pattern).
**4) NUTRITION FORMULA** — compact read + inline edit.
Season leaves for Plan. The long scroll of forms becomes a readable dossier with editing on demand.

### Model — three groups, bars not paragraphs (approved: stacked groups, not pipeline)

Reading order matches how the athlete actually asks:

1. **NOW — what drives your state:** the fused score + ranked drivers as **signed magnitude bars**
   (−10/−9/−8/+4 …), largest first — the same data Today's "why? →" links to, finally visual.
2. **LEARNED — per-athlete calibration:** one card per learned value — number · provenance
   ("learned · N rides") · confidence tier · override/contest inline with the "use learned value"
   escape (existing CalibrationPanel semantics, card-ified).
3. **STANDING GUIDANCE — directives (sole owner):** grouped by category, one line each, evidence
   behind "why ▸", validation ✓ where earned. No more text-upon-text.

Effort bands leave for Profile. Long-form metric explanations (v1 S2-6's landing spot) live here.

### Settings — two labelled groups (approved "as scoped")

**GENERATION** (weekly volume targets · weekly structure · training philosophy & equipment) and
**PLATFORM** (platform behavior · AI usage & cost · backup & restore) — visually separated tiers,
no content changes. Plan's generator links here (§6-Plan).

### Knowledge — power tool, one honest addition

No redesign. One-line provenance header above the file list: which files feed block generation vs.
reference-only — the same "where does this go?" honesty the rest of the app has. Renamed
"Knowledge" everywhere (§3).

## 7 · Sequencing (waves — each ends with a Constitution review)

1. **Wave 1 — nav + the moves.** ✅ shipped 2026-07-08 (commits `4fe638c`…`a8c29e9`; plan
   `docs/superpowers/plans/2026-07-08-ux-v2-wave-1-nav-and-relocations.md`; final review clean after
   one fix — season save now refreshes the roadmap + generator context co-located on /plan).
   Tiered rail · every ledger row (§2) executed as pure relocation
   (component moves, no redesigns yet) · name unification. Leaves no page half-moved.
2. **Wave 2 — Today auto-switch.** Mode detection + pre/post layouts + cuts (Trend Pulse,
   viewport-lock). The single biggest build; Wave 1 already thinned the page.
3. **Wave 3 — Trends rebuild.** Verdict strip (axis derivations!) + groups + the Delivery merge.
4. **Wave 4 — Profile dossier + Model three-groups.**
5. **Wave 5 — Plan hero orientation + Settings grouping + Knowledge header + density polish.**

Doc duty per wave: update DESIGN.md §8 (per-page table + layout notes — the viewport-lock clause
dies in Wave 2) and ROADMAP cross-refs in the same commit that ships the change.

**Constitution amendments to land with Wave 2** (same-commit rule): §3 gains the moment clause —
*a page may serve two moments if it presents exactly one at a time (moment-aware layout); the
mode must be data-derived, never a question the athlete answers* — and §4 codifies court rule 1
(one canonical home per metric; elsewhere it's a link).

## 8 · Success measures

- Pre-ride Today: ≤3 elements, no scroll at 1440×900; post-ride: debrief is fold-1.
- `TrendPulse` no longer imported by any Today component; Today has no viewport-lock CSS.
- Trends opens with a verdict sentence; zero orphan copies of ledger rows (grep per element).
- Coach-note visible text ≤3 sentences pre-disclosure.
- Rail renders 3 + 2 + 2 with group labels; "Knowledge Base"/"Docs" strings gone.
- Profile: no edit form visible before its disclosure is opened.
- Model: zero multi-paragraph prose blocks outside `<details>`.
- Post-wave re-audit finds no new ban-list entries.
