# NodeVelo — UX Masterplan

The ranked, evidence-based UX work plan. Governed by [`UX-CONSTITUTION.md`](UX-CONSTITUTION.md);
visual tokens stay in [`DESIGN.md`](DESIGN.md). Produced by the full-product audit + red-team of
2026-07-03 (all seven surfaces, at commit `d635119`). Every finding carries file evidence. This is a
living document: re-audit after each wave, strike what ships, amend the Constitution when a rule
proves wrong.

**Division of labour:** this document designs; implementation sessions execute from it. System-level
fixes (S1) come before page-level fixes (S2/S3) — the system before the screens.

---

## 1 · What already works — protect these

The trust architecture is genuinely strong; an audit that "cleans up" any of the following is
regressing the product's core idea:

- **Provenance**: `synced` badges on measured sections ([AthleteProfileForm.tsx:100](components/AthleteProfileForm.tsx#L100)); IF's NP-vs-avg basis stamped next to the value ([today.tsx:118](components/dashboard/today.tsx#L118)).
- **Confidence tiers** shown only when not high ([AthleteStateCard.tsx:29](components/AthleteStateCard.tsx#L29)).
- **Ranked drivers** — every state point traces to a named signal ([StateDriversCard.tsx](components/StateDriversCard.tsx)).
- **Contest/correct**: calibration override + "Use learned value" escape ([CalibrationPanel.tsx:153](components/CalibrationPanel.tsx#L153)).
- **Track record beside advice** — coach accuracy, insight validation ([TodayView.tsx:127](components/dashboard/TodayView.tsx#L127), [Trends.tsx:149](components/Trends.tsx#L149)).
- **Execution honesty** — structural-mismatch caveat instead of a silently wrong score ([today.tsx:309](components/dashboard/today.tsx#L309)); compromised-session containment ([SessionDisposition.tsx](components/SessionDisposition.tsx)).
- **Question headers + zone ranks** on Today; `<details>` drill-downs; the finished-block →
  "Generate the next block →" CTA ([today.tsx:537](components/dashboard/today.tsx#L537)).
- Real aria in places: `aria-current` nav, `role="switch"` toggles, `role="alert"`/`aria-live` on SyncNotice.

---

## 2 · System-level findings (S1 — fix the system first)

### S1-1 · Today answers "can I go hard?" four times, in three vocabularies — ✅ shipped 2026-07-04

**Evidence:** Zone 1 stacks MorningCheckIn + AthleteStateCard (0–100, `primed…depleted`) +
CoachSnapshotCard ("Form +3 · fresh — guidance") + ReadinessBadge (`Build/Hold/Recover`) + TSB/ACWR/
polarization tiles ([TodayView.tsx:59–97](components/dashboard/TodayView.tsx#L59)). Three registers for
one concept ([shared.tsx:6](components/dashboard/shared.tsx#L6) vs [athlete-state-ui](components/athlete-state-ui.tsx) vs TSB bands), no stated precedence.

**Why it matters:** this is the product's #1 question, read by the most degraded reader (pre-ride,
30 seconds). Four same-altitude instruments force the athlete to reconcile them — and on the day two
visibly disagree (state `primed`, readiness `Recover`), trust in all four dies. Constitution §4.

**Direction:** one verdict owns fold-1 — the fused AthleteState is the natural owner (it already
*is* the signal fusion; §5 of the app's design). Readiness, coach's read, and the tiles become its
supporting layer: visually subordinate, reconciled by construction (drivers must reference them).
Merge or re-register the `Build/Hold/Recover` vocabulary into the state register. Alerts
(fatigue/load-ramp) stay top — alarms outrank verdicts, aviation-style.

**Measure:** fold-1 contains exactly one verdict; the two vocabularies become one; time-to-decision
proxy = elements above the session card drops from ~7 to ≤4.

**Shipped:** `AthleteStateCard` is now the sole fold-1 verdict — score/band/recommendation visible
without interaction (only the ranked drivers stay behind hover/focus), with the coach-snapshot
TSB-modifier guidance and FTP-retest advisory folded in as its supporting lines (`components/AthleteStateCard.tsx`).
The standalone `Build/Hold/Recover` badge (`ReadinessBadge`) is retired; `ReadinessAlerts`
(`components/dashboard/today.tsx`) keeps only the triggered fatigue/load-ramp alarms above the verdict,
aviation-style. `CoachSnapshotCard.tsx` is deleted (content absorbed). The TSB/ACWR/Polarization/EA
tiles + remaining coach context (FTP, fuel) collapse into a "Supporting signals" `<details>`
(`components/dashboard/TodayView.tsx`) — hidden, not deleted. `ReadinessSignal`/`computeReadiness` are
untouched and still feed the AI snapshot (`lib/coach-snapshot.ts`) unchanged — this was a presentation-layer
merge only. S2-3 (the two near-identical `e/m/h` splits) fell out of it for free: the 7-day tile is now
labelled "Polarization · 7d" against the Trend Pulse's "Time in zones · 28d". Fold-1 element count above
the session card: 1 (was ~5).

### S1-2 · The entire explanation layer is hover-only — invisible to touch, keyboard, and screen readers

**Evidence:** `MetricTip`/`InfoDot` are `group-hover` spans with no focus/tap semantics
([ui.tsx:9–30](components/ui.tsx#L9)); the state card's band + recommendation + drivers reveal on
hover only ([AthleteStateCard.tsx:52](components/AthleteStateCard.tsx#L52)); block-calendar day detail
(name, type, execution, missed/compromised) is a hover tooltip ([plan.tsx:297](components/dashboard/plan.tsx#L297));
zone-bar segments likewise ([shared.tsx:48](components/dashboard/shared.tsx#L48)); plus `title=`
attributes on score bars, PR chips, rep chips.

**Why it matters:** the trust philosophy ("the athlete can always reach what the brain knows") is
currently *desktop-mouse-only*. On the phone — the primary red-team context — the athlete cannot see
why their state is 62, what Thursday's session is on the calendar, or what any ⓘ explains. This is
the single largest gap between the product's stated values and its behaviour. Constitution §6, §9.

**Direction:** upgrade the one primitive everything already uses — `MetricTip`/`InfoDot` become a
tap-and-focus-capable popover (open on click/tap/focus, dismiss on outside-tap/Esc, trigger is a
`<button>` with `aria-expanded`/`aria-describedby`). Hover stays as the desktop accelerator. Then
migrate the two bespoke hover reveals (state-card detail, calendar day detail) onto the same
mechanic; calendar days become tappable. Because every tip flows through `ui.tsx`, this is one
primitive fix + two call-site migrations, not a page-by-page rewrite.

**Measure:** on a touch viewport, every ⓘ, the state detail, and every calendar day can be opened;
keyboard Tab reaches them; ban-list §10.1 becomes grep-enforceable (`group-hover` carrying
decision-critical content → 0).

### S1-3 · Best-effort features fail silently — absence is indistinguishable from breakage

**Evidence:** empty `catch {}` on season/profile prefill/history ([PlanView.tsx:63,86,117](components/dashboard/PlanView.tsx#L63)),
trend pulse ([TrendPulse.tsx:102](components/TrendPulse.tsx#L102)), morning check ([MorningCheckIn.tsx:45](components/MorningCheckIn.tsx#L45)),
reschedule ([RescheduleBanner.tsx:29](components/RescheduleBanner.tsx#L29)), disposition, season roadmap.
Worst case: "Post to Intervals.icu" swallows failure — the button just returns to rest
([TodayView.tsx:50](components/dashboard/TodayView.tsx#L50)).

**Why it matters:** "Never hide uncertainty" is the trust philosophy; a card that vanishes on error
hides it completely. The athlete plans around a Season strip that isn't there and never learns why.
Constitution §5, §8.

**Direction:** a shared degraded-state convention: best-effort fetches distinguish
`empty` (render nothing — correct for optional context) from `failed` (render the slot with a quiet
one-liner: "Season couldn't load — retry"). Actions (post note, apply, save) always surface failure
at the button. One tiny helper/pattern, applied at each call site.

**Measure:** `grep -n "catch {}" components/` → every hit either renders a failed-state or is
explicitly commented as *empty-equivalent* with a reason; the post-note button shows a failure state.

### S1-4 · The first-run journey is dead ends + developer jargon

**Evidence:** a fresh athlete on Today sees "Sync to compute today's readiness."
([TodayView.tsx:82](components/dashboard/TodayView.tsx#L82)) and "No session planned for today."
([today.tsx:553](components/dashboard/today.tsx#L553)) — no link anywhere to the actual path
(configure → sync → generate a block on /plan). Generation failure surfaces
"ANTHROPIC_API_KEY is not set — generation is unavailable." ([BlockGenerator.tsx:83](components/dashboard/BlockGenerator.tsx#L83)).

**Why it matters:** it's a single-athlete app, but "first run" recurs: new machine, restored backup,
a friend's install — and the same dead-end pattern hits the *returning* athlete whose block expired.
Dev jargon in athlete copy breaks the coach voice. Constitution §7, §8.

**Direction:** empty states become onboarding: no-block Today links to /plan ("Plan your next block →",
matching the finished-block CTA that already exists); unconfigured states name the step in coach
language ("Connect the AI coach in setup — generation needs it") with the env detail relegated to a
tip/docs. No wizard needed — just honest links.

**Measure:** from a blank `data/`, every visible empty state contains the next action as a link;
`grep -rn "ANTHROPIC_API_KEY" components/ app/ --include=*.tsx` → no athlete-facing hits.

### S1-5 · The canonical theme flashes light on every load

**Evidence:** no pre-hydration theme script — dark is applied in a `useEffect` after mount, admitted
in the comment ([Nav.tsx:91–103](components/Nav.tsx#L91)).

**Why it matters:** DESIGN.md declares dark canonical and "a dark-mode regression is a real bug."
Every single open — the 30-second glance included — starts with a white flash, worst at night
(pre-dawn ride checks). Constitution §8.

**Direction:** classic inline script in `app/layout.tsx` `<head>` (read localStorage/matchMedia, set
`.dark` before paint); `DarkToggle` then reads the applied class instead of re-deriving, deleting the
mismatch workaround.

**Measure:** hard reload with dark stored → no flash (verifiable in the preview); the eslint-disable
comment in Nav.tsx is gone.

---

## 3 · Severity-ranked backlog (S2 page-level · S3 polish)

| ID | Sev | Where | Finding (evidence) | Direction |
|---|---|---|---|---|
| S2-1 | high | Plan (mobile) | Block calendar cells show only a day number; all meaning is hover-locked ([plan.tsx:278–333](components/dashboard/plan.tsx#L278)) | Rides on S1-2's tap popover; consider type initial in-cell on mobile |
| S2-2 | high | global | Routine touch targets under ~24px: disposition chips `py-0.5 text-[11px]` ([SessionDisposition.tsx:54](components/SessionDisposition.tsx#L54)), calibration override link ([CalibrationPanel.tsx:153](components/CalibrationPanel.tsx#L153)), "Show more" ([plan.tsx:25](components/dashboard/plan.tsx#L25)) | Bump padding/hit-area (visual size can stay); sweep for `text-[10px]`/`[11px]` *buttons* |
| S2-3 | med | Today | Two near-identical `e/m/h` splits, different windows: "Polarization" 7d ([today.tsx:478](components/dashboard/today.tsx#L478)) vs "Time in zones · 28d" ([TrendPulse.tsx:69](components/TrendPulse.tsx#L69)) | Ban-list §10.7: unify window or make the difference loud; likely drop one from Today |
| S2-4 | med | IA / nav | Mobile demotes Model (the trust centerpiece) to an unlabeled brain icon while Knowledge (a markdown power-tool) keeps a tab; label drift "Knowledge Base"/"Docs" ([Nav.tsx:11–20](components/Nav.tsx#L11)) | Recommend: swap — Model gets the 6th tab, Knowledge moves behind Settings (it's configuration, visited rarely); one name everywhere |
| S2-5 | med | Settings | h1 reads "Block generation settings" but the page also owns AI usage + backup; nav says "Settings" ([settings/page.tsx:14](app/settings/page.tsx#L14)) | h1 "Settings"; section titles carry the split (generation / platform) |
| S2-6 | med | Today | Tooltip essays: EA tip ~120 words, ACWR ~60 ([today.tsx:520,469](components/dashboard/today.tsx#L520)) | Constitution §6: cut to ≤2 sentences + "more → /model"; long-form lives on Model page |
| S2-7 | med | Plan / Knowledge | Destructive/discard flows use `window.confirm` ([PlanView.tsx:187](components/dashboard/PlanView.tsx#L187), [KnowledgeBaseEditor.tsx:34](components/KnowledgeBaseEditor.tsx#L34)); delete states no consequence | In-product confirm stating what's kept (ridden history survives block deletion) |
| S2-8 | med | Today | "Generate Next Block" while a block is active doesn't say what happens to the current one ([BlockGenerator.tsx:76](components/dashboard/BlockGenerator.tsx#L76)) | One microcopy line under the button (preview-then-write already makes it safe — say so) |
| S2-9 | med | coaching | No "injury" path: disposition reasons stop at equipment/sickness/weather/other ([SessionDisposition.tsx:15](components/SessionDisposition.tsx#L15)); morning check-in offers ill/extreme-fatigue only ([MorningCheckIn.tsx:8](components/MorningCheckIn.tsx#L8)) | Add `injury` reason + check-in flag; feeds the same downgrade machinery — red-team persona "injured athlete" currently has no honest input |
| S2-10 | low | Today | Session attribution chips appear with zero explanation of what "Compromised" does (the one concept that changes what the model learns) ([today.tsx:403](components/dashboard/today.tsx#L403)) | One InfoDot on the row: "Compromised keeps the ride but stops it teaching the model" |
| S3-1 | low | global | Loading is bare "Loading…" text (Dashboard, Trends, Profile) — layout jumps on resolve | Skeleton/held-height per Constitution §8; cheap on local-first |
| S3-2 | low | global | Most buttons have no `focus-visible` ring; inputs rely on border-color only | Add a token-level focus ring (zinc/accent) in globals |
| S3-3 | low | Today (desktop) | Viewport-locked layout hides internal scrollability (macOS overlay scrollbars) ([TodayView.tsx:58](components/dashboard/TodayView.tsx#L58)) | Subtle fade/affordance at the clipped edge |
| S3-4 | low | dark theme | Muted micro-labels (`zinc-500` dark on `zinc-900`) are borderline in sunlight — the red-team outdoor case | Spot-check contrast; consider `zinc-400` floor for dark-mode labels |
| S3-5 | low | re-entry | Returning after months: no "what changed while you were away" summary (stale-FTP warning and retro prompt exist and help) | Roadmap-tier feature; note only — pairs with the ledger/context-stamp work (`← #2`) |

---

## 4 · Page notes (apply after S1 lands)

- **Today** — post S1-1 restructure: alerts → verdict (state) → session card. Session card is
  already strong; keep the `<details>` drill-down as the model for everything else.
- **Plan** — healthy shape (hero block → goals/debrief → collapsed generator → history). S2-1/7/8
  are the gaps. The generator's season readout is a quiet trust win — keep.
- **Trends** — intentional review depth is right. Watch the intro line "not a duplicate of
  intervals.icu" — that's a mission statement, not athlete value; candidates for the page question:
  "Am I improving?" Density item already tracked in ROADMAP (UI refinements).
- **Profile** — the synced/owned split (§5 pattern) is exemplary. Forms are long but honest; S2-2
  applies to the tiny add/remove buttons.
- **Model** — the right content, and where S2-6's long-form explanations should land. After S2-4 it
  gains the mobile prominence its content deserves.
- **Settings** — S2-5 retitle; otherwise fine (ToggleRow is the a11y high-water mark — reuse it).
- **Knowledge** — power tool; fine behind a quieter entry point (S2-4). The per-file hints are good.

## 5 · Sequencing

1. **Wave 1 — system primitives** (unblocks everything): S1-2 tip/popover primitive · S1-3
   degraded-state convention · S1-5 theme script. ✅ shipped 2026-07-04 (commit `3aaa78a`).
2. **Wave 2 — the verdict**: S1-1 Today hierarchy + vocabulary merge; S2-3 falls out of it.
   ✅ shipped 2026-07-04.
3. **Wave 3 — page fixes**: S1-4 empty-state links + copy · S2-1 (rides on Wave 1) · S2-2 · S2-4/5
   IA moves · S2-6/7/8/10.
4. **Wave 4 — polish + coaching**: S2-9 injury path · S3-1..4.

Each wave ends with a Phase-6 review against the Constitution before the next starts.

## 6 · Success measures

- Fold-1 of Today: one verdict, ≤4 elements above the session card.
- Touch viewport: every explanation reachable by tap; keyboard: by Tab. `group-hover`-only
  decision content → 0 occurrences.
- All async actions report failure at the control; `catch {}` sites all classified.
- Blank-data walkthrough reaches a generated block using only in-app links.
- No light flash on dark load; no dev jargon strings in athlete-facing copy (grep-clean).
- Post-wave re-audit finds no new ban-list entries.
