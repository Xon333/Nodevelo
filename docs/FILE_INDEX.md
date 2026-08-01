# File index

One line per file that matters. The authoritative per-file table — README keeps only a grouped overview. Line counts are approximate (2026-07-25); importer counts = unique importing files.

## `lib/` — engine modules

### Persistence & platform

| Module | Purpose |
|---|---|
| `types.ts` | Every shared interface (999 lines, 54 importers — widest blast radius). No test file (types only) |
| `json-store.ts` | Atomic write + `.bak` rotation + per-file locks + corruption-aware recovery |
| `data-store.ts` | Typed accessors over json-store; `updatedAt` stamping; self-healing shape merges (31 importers) |
| `date.ts` | `localToday()` / `resolveToday()` — the ONLY sanctioned "what day is it for the athlete" source (27 importers) |
| `backup.ts` | Backup bundle build + auto-snapshot rotation (14 kept) |
| `csrf.ts` | Same-origin write guard; enforced app-wide by root `proxy.ts` |
| `log.ts` | One-line JSON `logError`/`logWarn` |
| `client-api.ts` | Client fetch wrapper `api<T>()` + `timeAgo`/`isStale`/`nextMonday` (17 importers) |
| `text.ts` | Small text helpers |
| `stats.ts` | `round1/round2/clamp/median/toleranceBand` — the universal leaf (13+ engine importers) |

### Sync & integration

| Module | Purpose |
|---|---|
| `intervals-api.ts` | Intervals.icu client: pulls activities/wellness/curves/streams/settings, pushes calendar events (idempotent `nodevelo-<date>` upserts); 20s abort timeouts; suspect-empty-sync guard |
| `sync-ledger.ts` | Idempotent ledger-schema backfill + one-shot rebuild gate |
| `sync-analysis.ts` | The deferred LLM coach-note step (`addCoachNote`), idempotent, auto-post option |
| `calendar-mirror.ts` | Outbound mirror (`persistMirroredMove`) + inbound reconcile of athlete moves |
| `reschedule.ts` | Pure reactive/proactive reschedule engines (never raids rest days) |

### Season & block structure

| Module | Purpose |
|---|---|
| `season.ts` | Rolling coverage selector + event-anchored backward scheduling + validators + prompt formatters (925 lines — [systems/05-season.md](systems/05-season.md)) |
| `season-signals.ts` | Single assembler of `chooseNextFocus` inputs (generate & season routes share it) |
| `block-skeleton.ts` | Exact per-week hour targets + feasibility pre-gate + week-hours validator + the day-slot skeleton (`computeBlockSkeleton`/`formatBlockSkeleton`). Change when day-level composition rules need to change — its two invariants (exact-sum, envelope ordering) are property-swept, not example-tested ([06-generation.md § week skeleton](systems/06-generation.md#the-week-skeleton-composition-authority)) |
| `block-events.ts` | Which calendar event ids to delete on block discard/replace |
| `block-version.ts` | CAS 409 guard for block mutations. No test file |
| `plan-week-character.ts` | Presentational load/build/peak/taper week labels |
| `session-requirements.ts` | Goal-text → required sessions (RaceSim); `tagPresent` negation-aware matcher |
| `session-level.ts` | Difficulty stamp for cross-block comparability |
| `prescription.ts` | Workout-text → structured `PrescribedInterval[]`; `carriesEmbeddedIntensity` |
| `durability.ts` | The 5 long-ride templates (A–E) + deterministic selection |

### Scoring & learning

| Module | Purpose |
|---|---|
| `execution-score.ts` | The 1–10 scorer; compliance-capped-by-execution trust guarantee |
| `interval-match.ts` | Rep-by-rep prescription matching (duration-greedy) |
| `durability-score.ts` | Grades template delivery (±2); `EXPECTS_EMBEDDED_EFFORTS` gate |
| `ride-analysis.ts` | Today-ride analysis assembler (extracted from sync for testability) |
| `ride-classify.ts` | Off-plan effort-type inference (grouping only, never judgment) |
| `score-log.ts` | Ledger builder + append-only/rebuild merges (LEDGER-1/2) + provenance stamps. Change when adding ledger fields — needs an idempotent backfill in `sync-ledger.ts` ([RECIPES § scoring](RECIPES.md#change-scoring)) |
| `athlete-model.ts` | Ledger → EWMA per-type model → ranked `Insight[]` |
| `athlete-state.ts` | 0–100 fused "right now" score with lived-signal override |
| `readiness.ts` | Build/Hold/Recover, ACWR, ramp/fatigue alerts, rolling baselines |
| `calibration.ts` | Per-athlete parameter derivation; `trustedCalibration` precedence. Change via [RECIPES § calibration](RECIPES.md#add-a-calibratable-parameter) |
| `correlation.ts` | `deriveExecutionEdge`/`deriveOptimum` with discrimination guards (imported ONLY by calibration — direction is deliberate) |
| `intervention.ts` | Directive baseline → 28-day validation → hit-rate |
| `plan-vs-actual.ts` | Per-type planned-vs-actual + FTP-retest advisory (asymmetric by design) |
| `coach-snapshot.ts` | The one resolved-numbers bundle for all LLM surfaces. Change when a new signal must reach LLM surfaces ([RECIPES § readiness](RECIPES.md#add-a-readinessstate-signal)) |
| `disposition.ts` | Session self-attribution merge/apply |
| `morning-check.ts` | Pre-ride override decisions |
| `quirks.ts` | NLP quirk mining from ride notes (hints, ≥2 rides) |
| `pr.ts` | Curve-to-curve power-PR detection |
| `power-profile.ts` | Rider-type classification + auto "easy win" weak point |
| `aerobic.ts` | Z2-only Pw:HR signal + shared deadband constant |
| `zones.ts` | Zone bucketing + IF band labels |
| `physiology.ts` | Effective-dated FTP/zone store + reconcile |
| `loading.ts` | **Carb**-loading prompts + effectiveness (not training load) |
| `fuel-prompt.ts` | Post-ride fuel-logging nudges |
| `nutrition.ts` | The deterministic nutrition formula — daily target, NEAT calibration, feed-forward buffer, carb targets, energy availability, under-fuel streak. **Change when:** any "how much should I eat" question → [09-nutrition](systems/09-nutrition.md) first |
| `trends.ts` | EF/HRRc series, weekly energy aggregation |
| `trends-verdict.ts` | The one-word Trends verdict (computed client-side) |
| `profile-goals.ts` | Goals/weakpoints JSON handling |
| `trace.ts` | Ride power-chart downsampling (**not** LLM tracing) |
| `workout-types.ts` | Per-type Tailwind style map (presentational). No test file |

### AI layer

| Module | Purpose |
|---|---|
| `anthropic-api.ts` | SDK shell: client, models, call functions, usage recording |
| `anthropic-prompts.ts` | ALL prompt assembly, pure/offline-testable. Change via [RECIPES § generation](RECIPES.md#change-generation-behavior-prompt-rules-output-shape); bump PROMPT_VERSION |
| `tool-schema.ts` | The one zod→tool-schema bridge. No test file |
| `plan-schema.ts` | Block tool schema (`weeks` before `overview` — deliberate) |
| `retrospective-schema.ts` | Structured-reflection tool schema + re-injection formatter |
| `narrative-critic.ts` | Overview-vs-facts critic (haiku, overview-only rewrites) |
| `plan-parser.ts` | Mostly retired; live part = `planDayToEvent` calendar converter |
| `workout-validate.ts` | KB-grounded protocol validator (violations vs advisories) |
| `schedule-validate.ts` | Placement validators: spacing, quality budget, taper, sequencing, recovery density, skeleton conformance. Each owns one fact only — check no existing validator already warns about it before adding another |
| `nutrition-validate.ts` | Kcal check + the ONLY auto-repairing validator |
| `generate-cache.ts` | 60s in-flight dedupe |
| `ai-usage.ts` | Token/cost telemetry (PRICING table duplicates model ids — keep in sync) |
| `kb-loader.ts` | KB read/write/fallback, athlete-md parsing, retrospective seeds |
| `synthesis.ts` | Insights + validation → ONE ranked directives block |

Note: `system-prompt.test.ts` and `ask-coach.test.ts` test functions in `anthropic-prompts.ts` — no such modules exist.

## `app/api/` — routes

| Route | Methods | Purpose | LLM |
|---|---|---|---|
| `sync` | GET/POST/DELETE | The sync orchestrator; DELETE removes the current block (the largest route, ~905 lines) | config-check only |
| `analyze` | POST | Deferred coach-note generation for today's ride | ✅ sonnet |
| `generate` | POST | Block generation (proposal only) | ✅ sonnet + haiku critic |
| `write` | POST | Accept a plan: calendar writes w/ rollback, archive, interventions | — |
| `ask` | POST | Streaming ask-coach | ✅ haiku, streamed |
| `retrospective` | GET/POST | Block retrospective (prose + structured) + archive + clear block | ✅ sonnet ×2 |
| `season` | GET/PUT | Season objective/events CRUD + outlook projection | — |
| `reschedule` | GET/POST/PUT/PATCH | Make-up / manual move / swap + calendar mirror | — |
| `morning-check` | GET/POST/PUT | Morning flag → decision → confirmed apply | — |
| `disposition` | GET/POST | Session self-report; re-stamps score log | — |
| `loading` | GET/POST | Carb-loading prompt + attribution | — |
| `trends` | GET | Trends payload assembly (read-only) | — |
| `history` | GET | Block-history list | — |
| `profile` | GET/PUT | Athlete profile (physiology overlaid at read) | — |
| `settings` | GET/PUT | Block settings + calibration-band overrides | — |
| `calibration` | GET/POST | Read/override calibrated parameters | — |
| `knowledge` | GET/PUT | KB file read/write | — |
| `note` | POST | Manual coach-note post to Intervals.icu | — |
| `export` / `import` | GET / POST | Backup bundle down/up | — |
| `dev/reset-today` | POST | Dev-only: clear today's analysis (`npm run reset:today`) | — |

## `data/` files

| File | Owner | `.bak`? | Shape (one line) |
|---|---|---|---|
| `athlete.json` | data-store | ✅ | Profile: performance (physiology-overlaid at read), goals, weakpoints, nutrition config |
| `physiology.json` | physiology | ✅ | Effective-dated FTP/zone/LTHR history |
| `last-sync.json` | intervals-api | — | Full Intervals.icu snapshot (regenerable) |
| `current-block.json` | data-store | ✅ | Active block + per-day prescription/eventId/execution |
| `block-history.json` | data-store | ✅ | Archived blocks + retrospectives + reflections (cap 200) |
| `block-settings.json` | data-store | ✅ | Generation knobs + calibration overrides (may not exist → defaults) |
| `score-log.json` | score-log | ✅ | THE append-only ledger (cap 400) |
| `ledger-rebuild.json` | data-store | — | One-shot rebuild guard `{rebuiltAt}` |
| `dispositions.json` | disposition | ✅ | Per-date session self-reports |
| `intervention-log.json` | intervention | ✅ | Directive baselines + matured outcomes |
| `morning-check.json` | morning-check | — | Per-date flags + decisions |
| `loading-log.json` | loading | — | Carb-loading prompts/attributions (may not exist) |
| `season-plan.json` | season | — | Objective, events, periods |
| `today-analysis.json` | ride-analysis | — | Today's analysis + coach note |
| `rolling-baselines.json` | readiness | — | 90-day derived baselines |
| `calibration.json` | calibration | — | Derived + overridden parameters |
| `athlete-quirks.json` | quirks | — | Mined quirks (fully regenerated each sync) |
| `ai-usage.json` | ai-usage | — | Token/cost telemetry |

## `components/` — see [systems/08-frontend.md](systems/08-frontend.md) for the ownership map

Shell: `Nav`, `SyncProvider`, `SyncNotice`, `QueryProvider` · Primitives: `ui.tsx` (Card, PrimaryButton, StatTile, Skeleton, MetricTip, useMountLoad…), `athlete-state-ui.tsx` · Page modules: `dashboard/` (TodayView, PlanView, today.tsx, plan.tsx, BlockGenerator, shared.tsx), `trends/` (sections, verdict, types) · The rest are single-feature PascalCase components listed in [systems/08-frontend.md](systems/08-frontend.md).
