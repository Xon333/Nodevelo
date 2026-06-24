# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## Open

**CR-2026-06-24 — xhigh code-review sweep of the Jun-23 logic commits + the a11y pass.** 15 findings,
verified against source. Act top-down; P1 = data-integrity, fix first.

### P1 — data-integrity (act first)

- ☑ P1 `bug` **LEDGER-1** — SYNC-2 rebuild could reclassify pre-current-block planned rides as off-plan
  (`buildRideScores` knows only the current block; block history keeps no per-day plan, so it can't be
  reconstructed). **Audit: live ledger clean** — only one block has ever existed (all 8 planned entries
  fall inside it; the 100 pre-block rides are legitimately legacy), so the rebuild caused 0 downgrades. It
  was a latent landmine (detonates on the first rebuild after a 2nd block exists). **Fix:** new
  `mergeScoreLogRebuild` guarantees a rebuild never downgrades a frozen `planned` entry to off-plan; wired
  into the rebuild branch. Off-plan/current-block/new dates still re-score. 6 tests added.
  _[score-log.ts](lib/score-log.ts) · [sync/route.ts:267](app/api/sync/route.ts:267)._
- ☑ P1 `bug` **SET-1** — settings PUT silently dropped `strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights` (rebuilt `updated`, only re-attached `acwrBands` + `tsbModifierEdges`; full-overwrite
  wiped the rest every save). **Fix:** all three now accept+clamp via their resolvers and preserve-when-omitted
  — `strainBands` + `durabilityInsertEnvelope` in SET-1, `athleteStateWeights` accept block added with CAL-1
  once its resolver clamped. 6 route tests. _[settings/route.ts](app/api/settings/route.ts)._
- ☑ P1 `bug` **LEDGER-2** — SYNC-2 rebuild dropped frozen `formState`/`morningCheck` provenance for rides
  older than the fresh wellness window (`fresh` won the merge with `formState:undefined`, deleting
  correlation-engine data points). **Fix:** `mergeScoreLogRebuild` now carries forward any context stamp
  the re-scored `fresh` entry lacks (a fresh stamp still wins when present; context-free stays context-free).
  3 tests added. _[score-log.ts](lib/score-log.ts)._
- ☑ P1 `audit` **LEDGER-3** — `rebuildLedger` was an unguarded destructive boolean on the hot sync route
  that re-ran on every sync if set. **Fix:** persisted one-shot marker (`ledger-rebuild.json`) + pure
  `shouldRebuildLedger(requested, alreadyRebuilt, force)` predicate — a normal sync never rebuilds, a repeat
  request is refused once the marker is set, and `force:true` is the explicit re-run path. (Kept on the sync
  trigger by design: the rebuild needs fresh-sync-derived state — calibration/ftpForDate/context — so a
  standalone endpoint would just re-run a sync; the guard is the right-depth fix.) 4 predicate tests added.
  _[sync-ledger.ts](lib/sync-ledger.ts) · [sync/route.ts:158](app/api/sync/route.ts:158)._
- ☑ P1 `bug` **CAL-1** — `resolveAthleteStateWeights` was the only resolver with no clamp/ordering, so an
  extreme override could disable the lived-fatigue safety cap at [athlete-state.ts:122](lib/athlete-state.ts:122).
  **Fix:** a per-leaf `ATHLETE_STATE_WEIGHT_BOUNDS` spec + `clampLeaves` walker bounds every leaf; key
  safety invariants — `override.scoreCap` ≤70 (stays below the 80+ "primed" band) and `override.livedThreshold`
  ≤3 (only 3 lived signals exist, so the cap stays reachable); scales pinned ≥0 and ACWR optimal/danger
  sign-locked so polarity can't invert; `tsb.freshAbove` order-enforced above `deepBelow`. Resolver is the
  single chokepoint (sync + coach-snapshot both route through it). Settings PUT now accepts the override.
  5 tests added. _[calibration.ts:238](lib/calibration.ts:238)._ Deeper schema-driven unification = CAL-2.

### P2 — correctness, lower urgency / latent

- ☐ P2 `bug` **CAL-3** — durability envelope split-brain: `validateSchedule`→`isHardDay`→
  `carriesEmbeddedIntensity` uses the population default while `validatePlanProtocol` gets the resolved
  per-athlete envelope. _[schedule-validate.ts:31](lib/schedule-validate.ts:31)._ → thread the resolved
  envelope into `validateSchedule` (the param/comment already invite it).
- ☐ P2 `bug` **API-1** — `normalizedPower = num(icu_weighted_avg_watts) ?? num(icu_normalized_power)`;
  `num(0)===0` short-circuits, so a 0-watt weighted-avg → NP=0 → IF=0 (quality day read as recovery). Dead
  fallback too (icu_normalized_power never returned). _[intervals-api.ts:210](lib/intervals-api.ts:210)._
  → treat 0 as missing for the NP basis.
- ☐ P2 `bug` **API-2** — decoupling silently lost if the API serializes it as a numeric string; `num()`
  is a strict `typeof number` guard so `"4.5"` → null, fallback null. _[intervals-api.ts:218](lib/intervals-api.ts:218)._
  → coerce with `Number(x)` (verify against a real payload first).
- ☐ P2 `feat` **FUEL-1** — `fuelStampFor` drops a logged `0g` carb ride (`grams<=0 → {}`), so fasted rides
  are indistinguishable from unlogged — the Track-C carbs→execution correlation can never learn the
  underfueling side. _[score-log.ts:46](lib/score-log.ts:46)._ → stamp 0 when explicitly logged; distinguish
  null (unlogged) from 0.

### P3 — altitude / cleanup / a11y polish

- ☐ P3 `audit` **CAL-2** — four sibling resolvers re-implement `pick+clamp+order-nudge` by hand (the reason
  CAL-1 slipped). _[calibration.ts:31](lib/calibration.ts:31)._ → one schema-driven resolver
  (`{field:[min,max], order:[...]}`), the spec-driven pattern already used for `deriveExecutionEdge`.
- ☐ P3 `audit` **A11Y-1** — the "AA pass" is a manual 24-file idiom swap; 27 bare `text-zinc-400` labels
  (no `dark:` sibling) still render sub-AA in light mode, and nothing enforces it. _[globals.css:47](app/globals.css:47)._
  → add a `--muted` semantic token + a `detect.mjs` rule flagging `text-zinc-400` without a `dark:` pair.
- ☐ P3 `bug` **A11Y-2** — driver-effect neutral arm is bare `text-zinc-400` (no `dark:`), violating DESIGN.md
  §7 Dual-theme; the a11y commit fixed the adjacent red arm and left this in both
  [StateDriversCard.tsx:58](components/StateDriversCard.tsx:58) and [AthleteStateCard.tsx:65](components/AthleteStateCard.tsx:65).
- ☐ P3 `ux` **UI-1** — `StateDriversCard` re-implements `AthleteStateCard`'s band-color table + driver-effect
  render (already drifted — see A11Y-2). _[StateDriversCard.tsx](components/StateDriversCard.tsx)._ → extract
  one shared renderer.
- ☐ P3 `bug` **CAL-4** — `DECOUPLING_BOUNDS {2.5,8}` is a hand-copy of the clamp in `deriveDecouplingGood`,
  linked only by a comment. _[calibration/route.ts:7](app/api/calibration/route.ts)._ → share one constant.
- ☐ P3 `ux` **UI-2** — `CalibrationPanel.submit` validates only `Number.isFinite`, not the 2.5–8 range its
  error text promises; out-of-range input is posted then silently server-clamped. _[CalibrationPanel.tsx:61](components/CalibrationPanel.tsx:61)._

_Prior 2026-06-23 sync triage (SYNC-1, NP/decoupling map, SYNC-2, SYNC-3) shipped/closed → [ARCHIVE.md](ARCHIVE.md).
Note: this sweep found LEDGER-1/2/3 are regressions in SYNC-2 itself._

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).

_Design/judgment calls that surfaced during the CR sweep now live in [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming;
whether IF should be replaced rather than annotated; CR-C observability (P8); CR-F per-carb checks (Track C)._
