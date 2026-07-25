// Macro periodization engine (MACRO-1..3). Pure + deterministic: settles season history (rolling mode —
// each block's focus is chosen fresh via chooseNextFocus, not drafted ahead) or backward-schedules an
// event-anchored arc (event mode), grounded in the knowledge base. The LLM only phrases
// FocusPeriod.rationale.
import type { FocusPeriod, PlannedDay, SeasonEvent, SeasonFocus, SeasonPhase, SeasonPlan, WorkoutType, AthleteModel, RideScoreEntry } from "./types";
import { tagPresent } from "./session-requirements";
import { carriesEmbeddedIntensity } from "./prescription";
import { execFor } from "./intervention";
import type { WeekTarget } from "./block-skeleton";

// Season phase/deload/retest context + the two season-fit/focus-match validators are TEMPORARILY
// DISABLED from shaping or gating block generation (2026-07-16, athlete decision) -- the fixed
// phase-sequence model itself is a separate, deferred question (see ROADMAP.md "Season architecture
// doubt": whether always prescribing a phase sequence regardless of a rider's existing base is even
// the right model). Season state keeps being tracked underneath this flag (settleSeasonHistory/
// replanEventArc still run, season-plan.json still updates, B/C-priority event surfacing still
// injects -- those are calendar facts, not phase opinion) -- only the PHASE-DERIVED opinion about
// what a week should emphasise, and the validators that grade generated days against it, are
// switched off. Flip back to true once the season model is revisited.
export const SEASON_SHAPES_GENERATION = false;

// KB-grounded (cycling_database.md Annual Periodisation Framework + training_knowledge.md). Mode-C focus
// periods are mesocycle-sized (a "base touch" is 2–4 wk, not the 10–16 wk annual base phase).
export const SEASON_CONSTANTS = {
  weeks: { "aerobic-base": 3, threshold: 4, vo2max: 4, anaerobic: 3, durability: 3, sharpen: 1 } as Record<SeasonFocus, number>,
  split: { "aerobic-base": "90/10", threshold: "80/20", vo2max: "80/20", anaerobic: "80/20", durability: "80/20", sharpen: "75/25" } as Record<SeasonFocus, string>,
  peakWeeks: 5, // 4–6
  taperWeeks: 1, // 1–2
  deloadEveryWeeks: 4, // 3:1 — a deload week after 3 loading weeks
  deloadTightEveryWeeks: 3, // 2:1 under heavy fatigue
  retestEveryWeeks: 8, // FTP/power-curve retest cadence: 6–8 wk (aggressive) ∩ 8–12 wk (conservative) = one arc
} as const;

// Display labels for a goal's focus. "general" is not a physiological system — it means "relevant in
// every phase" (filterGoalsByFocus always includes it), so it reads as an intentional "all phases" tag
// rather than the meaningless default it looked like before. Stored values are unchanged; this is display-only.
export const FOCUS_LABELS: Record<SeasonFocus | "general", string> = {
  general: "all phases",
  "aerobic-base": "aerobic base",
  threshold: "threshold",
  vo2max: "VO2max",
  anaerobic: "anaerobic",
  durability: "durability",
  sharpen: "sharpen",
};

// Build-phase rotation order when no confident limiter is known (KB variety rule).
export function defaultBuildOrder(): SeasonFocus[] {
  return ["threshold", "vo2max", "durability"];
}

// ---------- Coverage selector, factor 1: goal relevance ----------
// (2026-07-15-season-coverage-selector) Does the stated goal/weakpoint text plausibly gate on a focus?
// Same negation-aware clause matching as deriveSessionRequirements (lib/session-requirements.ts) — no
// new NLP. Research-grounded weight choice: an FTP/TTE goal makes BOTH threshold and vo2max relevant
// (Odden et al. 2024 — threshold and VO2max sessions raise VO2max comparably; at high fractional
// utilization the aerobic ceiling gates further FTP), so a goal-driven athlete is steered to the
// ceiling, not to a deficit-greedy "weakest system" pick. Regexes are lowercase-only (haystack is
// lowercased); a focus a fired pattern doesn't mention scores 0 (deliberately penalised vs neutral).
const GOAL_PATTERNS: Array<{ re: RegExp; weights: Partial<Record<SeasonFocus, number>> }> = [
  { re: /\b(ftp|tte|time.?trial|sustained|steady.?state|threshold)\b/, weights: { threshold: 1, vo2max: 0.8, durability: 0.3 } },
  { re: /\b(sprint|sprints|kick|snap|jump|neuromuscular)\b/, weights: { anaerobic: 1 } },
  { re: /\b(fondo|century|endurance|ultra|all.?day|long ride|long rides|kom|climb|climbs|climbing)\b/, weights: { durability: 1, threshold: 0.5 } },
];

// 0..1 relevance of a focus to the athlete's goal text. Neutral 0.5 when there is no text or no
// pattern fires (absence of a goal must not distort the other scoring factors). When patterns fire,
// the max weight across fired patterns wins; an unmentioned focus scores 0.
export function goalRelevanceForFocus(goalText: string | undefined, focus: SeasonFocus): number {
  // Foundational, not goal-gated (season-continuous-focus-selection §4, KB: "base is non-negotiable") —
  // no goal ever names aerobic-base explicitly, so letting the fired-pattern penalty zero it out
  // whenever ANY other pattern fires would make it lose every goal-driven scoring round by construction.
  if (focus === "aerobic-base") return 0.5;
  const haystack = (goalText ?? "").toLowerCase();
  if (!haystack.trim()) return 0.5;
  const fired = GOAL_PATTERNS.filter((p) => tagPresent(haystack, p.re));
  if (fired.length === 0) return 0.5;
  return Math.max(...fired.map((p) => p.weights[focus] ?? 0));
}

// ---------- Coverage selector, factor 3 inputs: decay urgency ----------
// Estimated weeks since `focus` last ENDED in a label history (most recent last) — the fallback
// signal when no real session data covers a focus. The history carries no per-period week counts,
// so KB default weeks per label are the estimate. null = never appeared (maximally dark).
export function labelExposureWeeks(recentFocuses: SeasonFocus[], focus: SeasonFocus): number | null {
  const idx = recentFocuses.lastIndexOf(focus);
  if (idx === -1) return null;
  return recentFocuses.slice(idx + 1).reduce((sum, f) => sum + SEASON_CONSTANTS.weeks[f], 0);
}

// A generated session day, structurally satisfied by CurrentBlockDay and PlannedDay — the REAL
// exposure record, closing the "engine reasons about its own past labels, not reality" gap.
export interface SessionSample {
  date: string; // YYYY-MM-DD
  type: WorkoutType;
  durationMin: number;
  workoutText?: string;
  durabilityTemplate?: string;
}

// Whole weeks since the latest MEANINGFUL session per build focus, from actual generated days
// (block history + current block). Mapping: threshold←Threshold, vo2max←VO2max, anaerobic←SIT
// (mirrors mapSystemToFocus's vocabulary in app/api/generate/route.ts), durability←a Z2/Recovery
// ride that actually carries embedded threshold+ work (carriesEmbeddedIntensity) or a durability-
// template stamp — a plain easy spin is not durability training. A focus with no qualifying session
// is ABSENT from the result: the selector falls back to label-derived exposure for it, so real data
// wins where it exists and labels only fill the gaps.
export function exposureFromSessions(
  days: SessionSample[],
  ftp: number,
  asOf: string
): Partial<Record<SeasonFocus, number>> {
  const latest: Partial<Record<SeasonFocus, string>> = {};
  const note = (focus: SeasonFocus, date: string) => {
    if (!latest[focus] || date > latest[focus]!) latest[focus] = date;
  };
  for (const d of days) {
    if (d.date > asOf || d.durationMin <= 0) continue;
    if (d.type === "Threshold") note("threshold", d.date);
    else if (d.type === "VO2max") note("vo2max", d.date);
    else if (d.type === "SIT") note("anaerobic", d.date);
    else if (d.type === "Z2" || d.type === "Recovery") {
      if (d.durabilityTemplate || carriesEmbeddedIntensity(d.workoutText, ftp)) note("durability", d.date);
      else note("aerobic-base", d.date);
    }
  }
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, date] of Object.entries(latest) as Array<[SeasonFocus, string]>) {
    out[focus] = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(date)) / (7 * 86_400_000)));
  }
  return out;
}

// Add whole weeks to an ISO date (UTC-safe).
export function addWeeks(iso: string, weeks: number): string {
  return new Date(Date.parse(iso) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

export interface SeasonDraftInput {
  objective: string;
  events: SeasonEvent[];
  ctl: number | null;
  ftp: number | null;
  recentWeeklyTss: number | null;
  limiter: { system: SeasonFocus | null; confidence: "low" | "medium" | "high" };
  recentFocuses: SeasonFocus[]; // most recent last
  heavyFatigue: boolean;
  // Optional reality signals for the scored coverage selector (goal text, real session exposure,
  // execution EWMAs). Absent → labels-only selection (every pre-existing caller/fixture unchanged).
  focusSignals?: FocusSignals;
}

const BUILD_FOCI: SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability"];

// ---------- Coverage selector (2026-07-15-season-coverage-selector) ----------
// Scored build-focus selection: goal-relevance × decay-urgency × trainability × execution quality,
// with the confident limiter demoted from "always wins" to a bonus. Research grounding (athlete-
// approved): "train the weakest system" and "train the system that unlocks the goal" diverge — this
// athlete's weakest system (sprint/anaerobic) is durable and slow-to-respond, while his FTP constraint
// is the aerobic ceiling (FTP/5-min ≈ 85% fractional utilization), so a deficit-greedy selector
// systematically mis-selects. Physiology floor (Hickson et al. 1985; Odden et al. 2024): what must
// persist is INTENSITY EXPOSURE — ≥ WEEKLY_INTENSITY_FLOOR quality session(s)/week at a high fraction
// of FTP/VO2max, satisfiable by threshold, VO2max, anaerobic OR sharpen work — NOT any particular
// label, so there is deliberately no "literal vo2max every N weeks" rule here (it would fight
// goal-relevance while adding nothing physiological; the weekly floor itself is enforced downstream
// by BlockSettings.qualitySessionsPerLoadingWeek).
export const WEEKLY_INTENSITY_FLOOR = 1;

// Fixed responsiveness-per-week constant per focus (deliberately not modeled further): threshold/
// vo2max respond within a mesocycle; durability is slower; sprint/anaerobic gains are multi-season
// and strength-anchored.
export const FOCUS_TRAINABILITY: Record<"aerobic-base" | "threshold" | "vo2max" | "anaerobic" | "durability", number> = {
  "aerobic-base": 0.9, // responds quickly to a short re-touch (KB: 2-4wk sufficient to re-establish the ceiling)
  threshold: 1.0,
  vo2max: 0.9,
  durability: 0.6,
  anaerobic: 0.3,
};

const SELECTOR_WEIGHTS = { goal: 0.35, urgency: 0.3, trainability: 0.2, execution: 0.15, limiterBonus: 0.2 } as const;
const URGENCY_SATURATION_WEEKS = 12; // exposure this old (or older) is maximally urgent…
const NEVER_SEEN_URGENCY = 1.3; // …except NEVER seen, which outranks even saturated staleness.

// Optional reality signals for the selector. All absent → the selector degrades to label-only
// urgency with neutral goal/execution — the exact call shape backwardScheduleFromEvent's
// selectBuildFocus call uses.
export interface FocusSignals {
  goalText?: string; // objective + block goal + goals/weakpoints, joined
  exposure?: Partial<Record<SeasonFocus, number>>; // weeks since real exposure (exposureFromSessions)
  execQuality?: Partial<Record<SeasonFocus, number>>; // execution EWMA 1–10 (execQualityByFocus)
}

export interface FocusScore {
  focus: SeasonFocus;
  score: number;
  parts: { goal: number; urgency: number; trainability: number; execution: number; limiter: number }; // weighted; sums to score
}

// Score all five build foci, best first. Each part is its WEIGHTED contribution so a caller (or a
// debug log) can read exactly why a focus won. Deterministic: ties break by BUILD_FOCI order.
export function scoreFocusCandidates(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[],
  signals?: FocusSignals
): FocusScore[] {
  const confBonus = limiter.confidence === "high" ? 1 : limiter.confidence === "medium" ? 0.6 : 0;
  return BUILD_FOCI.map((focus, i) => {
    // Urgency: real session exposure wins where it exists; the plan's own labels only fill the gaps.
    const weeks = signals?.exposure?.[focus] ?? labelExposureWeeks(recentFocuses, focus);
    const urgency = weeks === null || weeks === undefined ? NEVER_SEEN_URGENCY : Math.min(weeks / URGENCY_SATURATION_WEEKS, 1);
    const execEwma = signals?.execQuality?.[focus];
    const execution = execEwma === undefined ? 0.5 : Math.min(Math.max((execEwma - 1) / 9, 0), 1);
    const parts = {
      goal: SELECTOR_WEIGHTS.goal * goalRelevanceForFocus(signals?.goalText, focus),
      urgency: SELECTOR_WEIGHTS.urgency * urgency,
      trainability: SELECTOR_WEIGHTS.trainability * FOCUS_TRAINABILITY[focus as keyof typeof FOCUS_TRAINABILITY],
      execution: SELECTOR_WEIGHTS.execution * execution,
      limiter: focus === limiter.system ? SELECTOR_WEIGHTS.limiterBonus * confBonus : 0,
    };
    return { focus, i, score: parts.goal + parts.urgency + parts.trainability + parts.execution + parts.limiter, parts };
  })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ focus, score, parts }) => ({ focus, score, parts }));
}

// The selector: top-scored candidate that isn't the most recent focus (KB variety — never repeat
// back-to-back, preserved from every prior selector version). `signals` optional by design: this is
// the drop-in seam backwardScheduleFromEvent's backward fill calls directly (no signals in scope there).
export function selectBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[],
  signals?: FocusSignals
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  return scoreFocusCandidates(limiter, recentFocuses, signals).filter((s) => s.focus !== last)[0].focus;
}

// One stateless focus decision for the next block, made fresh every /api/generate call from real data —
// replaces the old drafted-period-sequence model for the rolling (no upcoming A-event) case (season-
// continuous-focus-selection §4). Thin wrapper over the existing scored selector: no new scoring logic,
// just a caller-friendly input/output shape plus a rationale string for the prompt.
export interface FocusChoice {
  focus: SeasonFocus;
  rationale: string;
  scores: FocusScore[]; // full ranking, for the roadmap outlook + debug
}

export interface ChooseNextFocusInput {
  limiter: SeasonDraftInput["limiter"];
  lastFocus: SeasonFocus | null; // no-back-to-back variety rule
  signals: FocusSignals;
}

export function chooseNextFocus(input: ChooseNextFocusInput): FocusChoice {
  const recent = input.lastFocus ? [input.lastFocus] : [];
  const scores = scoreFocusCandidates(input.limiter, recent, input.signals);
  const focus = scores.filter((s) => s.focus !== input.lastFocus)[0].focus;
  const rationale =
    input.limiter.system === focus && input.limiter.confidence !== "low"
      ? "your most depressed system relative to your engine"
      : focus === "aerobic-base"
        ? "re-touching the aerobic ceiling — every later phase depends on it (KB)"
        : "rotating the quality focus (KB: avoid repeating one stimulus)";
  return { focus, rationale, scores };
}

// The same A-event lookup draftSeasonArc used to gate on internally — extracted so /api/generate can
// branch on it directly (season-continuous-focus-selection §4/§9: the rolling and event-anchored paths
// now diverge before this point, not inside one dispatcher function).
export function findUpcomingAEvent(events: SeasonEvent[], today: string): SeasonEvent | null {
  return events.find((e) => e.priority === "A" && Date.parse(e.date) > Date.parse(today)) ?? null;
}

export interface SeasonOutlookSlot {
  focus: SeasonFocus;
  rationale: string;
  startDate: string; // hypothetical
  weeks: number; // nominal display length (SEASON_CONSTANTS.weeks[focus])
}

const DEFAULT_OUTLOOK_SLOTS = 4;

// Stateless forward projection for the roadmap UI (season-roadmap-preview §6) — never persisted, never
// gates real generation, recomputed fresh every time it's shown. Re-runs chooseNextFocus forward a
// handful of hypothetical slots, extrapolating real exposure forward: a not-yet-projected focus's real
// staleness is advanced by how far the projection has already run, and once a focus IS projected this
// call, its clock RESETS to that point and grows forward from there (ordinary staleness growth) —
// deliberately NOT dropped to undefined. Dropping it (an earlier draft of this function did) falls
// through to chooseNextFocus's own lastFocus-only fallback (labelExposureWeeks), which only ever sees a
// single prior focus — so anything that isn't the literal immediate predecessor reads as "never seen"
// (maximal urgency) the very next slot, and whichever focus IS momentarily the predecessor also resets
// to "just trained". The two leapfrog each other's score every slot and starve out every other focus for
// the WHOLE projection — the exact bug the two REGRESSION tests below pin (caught by hand-tracing the
// drop-based draft against its own test expectations before running them; the drop version reproduces
// the forbidden ["anaerobic","threshold","anaerobic","threshold"] sequence and never surfaces vo2max).
//
// The pick-time Map alone isn't sufficient: a focus can be CHOSEN via chooseNextFocus's own label-
// fallback path (labelExposureWeeks) while having NO entry in input.signals.exposure at all —
// exposureFromSessions's documented contract is that a focus with no qualifying session is ABSENT from
// its result, the realistic common case for a real athlete profile, not a corner case. Recomputing
// staleness only for foci that were already keys of the original exposure object (the first fix) still
// drops such a focus the moment it stops being the literal lastFocus: it falls through to
// labelExposureWeeks again with a one-element history that no longer contains it → null →
// NEVER_SEEN_URGENCY — the exact same artificial spike, just triggered from "never had real exposure"
// instead of "had real exposure, then got dropped". So the adjusted exposure object is built from the
// UNION of every key in the original exposure object AND every focus recorded in the pick-time Map, and
// this adjustment runs even when input.signals.exposure starts entirely undefined/empty — once ANY
// focus is picked in the projection, its clock is real and growing from its OWN pick point in every
// later slot, regardless of whether it ever had a real exposure entry to begin with.
export function projectSeasonOutlook(
  input: ChooseNextFocusInput,
  today: string,
  slots: number = DEFAULT_OUTLOOK_SLOTS
): SeasonOutlookSlot[] {
  const out: SeasonOutlookSlot[] = [];
  const chosenAtWeeks = new Map<SeasonFocus, number>(); // weeksIntoProjection when a focus was chosen this call
  let cursor = today;
  let lastFocus = input.lastFocus;
  for (let i = 0; i < slots; i++) {
    const weeksIntoProjection = weeksBetween(today, cursor);
    const originalExposure = input.signals.exposure;
    const adjustedSignals: FocusSignals =
      originalExposure || chosenAtWeeks.size > 0
        ? {
            ...input.signals,
            exposure: Object.fromEntries(
              Array.from(
                new Set<SeasonFocus>([...(originalExposure ? (Object.keys(originalExposure) as SeasonFocus[]) : []), ...chosenAtWeeks.keys()])
              ).map((f) => {
                const chosenAt = chosenAtWeeks.get(f);
                const adjusted = chosenAt !== undefined ? weeksIntoProjection - chosenAt : (originalExposure![f] as number) + weeksIntoProjection;
                return [f, adjusted];
              })
            ) as Partial<Record<SeasonFocus, number>>,
          }
        : input.signals;
    const choice = chooseNextFocus({ limiter: input.limiter, lastFocus, signals: adjustedSignals });
    const weeks = SEASON_CONSTANTS.weeks[choice.focus];
    out.push({ focus: choice.focus, rationale: choice.rationale, startDate: cursor, weeks });
    chosenAtWeeks.set(choice.focus, weeksIntoProjection);
    lastFocus = choice.focus;
    cursor = addWeeks(cursor, weeks);
  }
  return out;
}

// Type guard for a persisted-but-untyped focus string (CurrentBlock.seasonFocus is `string`, not
// SeasonFocus, so a block written before this field existed — or corrupted by hand-editing JSON —
// can't be trusted without a runtime check before feeding it into chooseNextFocus's lastFocus).
const SEASON_FOCI: readonly SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen"];
export function isSeasonFocus(v: string | undefined): v is SeasonFocus {
  return v !== undefined && (SEASON_FOCI as readonly string[]).includes(v);
}

// A week is "genuinely light" at/below this fraction of the athlete's own rolling weekly baseline —
// the same "a genuine season break: ~50% load" convention the old load-target envelope used, and
// BlockSettings.recoveryWeekHoursMin/Max's real recovery-week volume band, so "light" means the same
// thing everywhere in this codebase.
const LIGHT_WEEK_FRACTION = 0.5;
// Give up after this many weeks of backward search (a new athlete with under ~6mo of ledger) rather
// than loop indefinitely — the whole available history simply counts as "since the last light week".
const MAX_RECOVERY_LOOKBACK_WEEKS = 26;

// Real-data recovery hard cap (season-continuous-focus-selection §5) — replaces applyDeloadCadence's
// cross-call counter (the single largest source of correctness bugs across the last three sessions,
// most recently HR-22) with a value re-derived fresh from real ride history every call: nothing is
// stored or threaded between /api/generate calls, so there's no cross-call state to drift.
export function realWeeksSinceLastRecovery(
  entries: Array<Pick<RideScoreEntry, "date" | "tss">>,
  avgWeeklyTss: number | null,
  today: string
): number {
  if (avgWeeklyTss === null || !Number.isFinite(avgWeeklyTss) || avgWeeklyTss <= 0) return 0;
  const dayMs = 86_400_000;
  for (let w = 0; w < MAX_RECOVERY_LOOKBACK_WEEKS; w++) {
    const weekEndMs = Date.parse(today) - w * 7 * dayMs;
    const weekStartMs = weekEndMs - 6 * dayMs;
    const weekEnd = new Date(weekEndMs).toISOString().slice(0, 10);
    const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
    const weekTss = entries
      .filter((e) => e.date >= weekStart && e.date <= weekEnd && e.tss !== null)
      .reduce((sum, e) => sum + (e.tss as number), 0);
    if (weekTss <= avgWeeklyTss * LIGHT_WEEK_FRACTION) return w;
  }
  return MAX_RECOVERY_LOOKBACK_WEEKS;
}

// Which 0-indexed week(s) within a new block of `lengthWeeks` must be recovery, given how many real
// calendar weeks have already elapsed since the last genuinely light one. Hard cap: never more than
// `every` weeks without recovery — continues counting forward within a block longer than the cap, so
// an 8-week block still gets recovery weeks spaced correctly, not just one at the front. Matches
// applyDeloadCadence's own documented semantics (a period whose own length equals or exceeds `every`
// still fires on its own): a cap reached on a block's own final week DOES flag that week as recovery
// — a fresh, exactly-cadence-length block still gets its needed recovery week, on its own last day,
// rather than deferring it into the next block and silently stretching the real cadence by one week.
export function planRecoveryWeeks(weeksSinceRecovery: number, lengthWeeks: number, tight: boolean): number[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  const indices: number[] = [];
  let sinceRecovery = weeksSinceRecovery;
  for (let wk = 0; wk < lengthWeeks; wk++) {
    sinceRecovery += 1;
    if (sinceRecovery >= every) {
      indices.push(wk);
      sinceRecovery = 0;
    }
  }
  return indices;
}

// Prompt-injectable recovery-week callout — additive to formatFocusContext/formatSeasonContext (Task 5).
export function formatRecoveryWeeks(indices: number[], lengthWeeks: number): string | null {
  if (indices.length === 0) return null;
  const label = indices.map((i) => `week ${i + 1}`).join(", ");
  return `RECOVERY: cut volume ~30–50% in ${label} of this ${lengthWeeks}-week block (hard cap — real training history shows ≥${SEASON_CONSTANTS.deloadEveryWeeks} calendar weeks since the last genuinely light week).`;
}

// Execution EWMA per build focus, via the intervention loop's own accessor (execFor) so focus
// selection and intervention validation read the SAME number. Durability's execution dimension is
// Z2 — durability rides are typed Z2 and scored there. Only foci with data appear.
export function execQualityByFocus(model: AthleteModel): Partial<Record<SeasonFocus, number>> {
  const dims: Array<[SeasonFocus, string]> = [
    ["threshold", "Threshold"],
    ["vo2max", "VO2max"],
    ["anaerobic", "SIT"],
    ["durability", "Z2"],
    // Same Z2 dimension as durability — the athlete model has no finer distinction between a
    // durability-templated Z2 ride and a plain aerobic-base Z2 ride; both are steady-state execution.
    ["aerobic-base", "Z2"],
  ];
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, dim] of dims) {
    const e = execFor(model, dim);
    if (e !== null) out[focus] = e;
  }
  return out;
}

// Whole weeks between two ISO dates, floored, clamped at 0 (never negative for a past "today").
function weeksBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / (7 * 86_400_000)));
}

// Backward schedule from an A-priority event: taper (1–2 wk) ends on/just-before the date, peak (4–6 wk)
// before that, then build/base periods fill the remaining runway backward from the peak. Clamps to a
// taper-only (or taper+peak) schedule when the runway can't fit a real build (KB: don't fabricate a
// nonsensical block out of a handful of days). Build-rotation periods are always phase "build" — "peak"
// is reserved for the dedicated race-specific sharpen period the KB defines right before taper.
// Deload cadence does NOT apply to this path: the peak→taper runway is a distinct structural unit from
// the rolling build cycle deload cadence was designed for, so it's exempt (peak must hold near-race load).
export function backwardScheduleFromEvent(event: SeasonEvent, input: SeasonDraftInput, today: string): FocusPeriod[] {
  const runway = weeksBetween(today, event.date);
  const conf = input.limiter.confidence;
  const mk = (focus: SeasonFocus, phase: SeasonPhase, weeks: number, rationale: string): Omit<FocusPeriod, "startDate"> => ({
    focus, phase, plannedWeeks: weeks, intensitySplit: SEASON_CONSTANTS.split[focus],
    targetWeeklyTss: null, deloadWeek: false, rationale, source: "derived", confidence: conf,
  });
  const taper = mk("sharpen", "taper", SEASON_CONSTANTS.taperWeeks, `Taper into ${event.name} — cut volume, hold intensity (KB).`);
  const tail: Omit<FocusPeriod, "startDate">[] = [];
  if (runway <= SEASON_CONSTANTS.taperWeeks + 1) {
    tail.push(taper); // too close — taper only, no room for a real peak or build
  } else {
    const peakWeeks = Math.min(SEASON_CONSTANTS.peakWeeks, runway - SEASON_CONSTANTS.taperWeeks - 1);
    tail.push(mk("sharpen", "peak", Math.max(1, peakWeeks), `Peak/sharpen for ${event.name} — race-specific.`));
    let filled = peakWeeks + SEASON_CONSTANTS.taperWeeks;
    // Backward fill, nearest-to-peak first: each pick sees the running `chosen` history, so a
    // confident limiter lands in the most race-specific slot (right before the peak) and the
    // in-between slots rotate least-recently-used across every build system. The old fixed
    // [threshold, vo2max, durability] index cycle could never schedule anaerobic and ignored the
    // limiter entirely. (Adjacency is symmetric, so no-back-to-back survives the reversal;
    // input.recentFocuses is deliberately NOT seeded here — chronologically it borders the START
    // of the runway, i.e. the LAST period this loop generates, not the first.)
    const chosen: SeasonFocus[] = [];
    while (filled < runway) {
      const focus = selectBuildFocus(input.limiter, chosen);
      const w = Math.min(SEASON_CONSTANTS.weeks[focus], runway - filled);
      if (w <= 0) break;
      tail.unshift(mk(focus, "build", w, `Build ${focus} toward ${event.name}.`));
      chosen.push(focus);
      filled += w;
    }
    tail.push(taper);
  }
  // Date them forward from today.
  let cursor = today;
  const dated: FocusPeriod[] = [];
  for (const t of tail) {
    dated.push({ ...t, startDate: cursor });
    cursor = addWeeks(cursor, t.plannedWeeks);
  }
  return dated;
}

// A period's computed end date (startDate + plannedWeeks).
const periodEnd = (p: FocusPeriod): string => addWeeks(p.startDate, p.plannedWeeks);

// Rolling mode (season-continuous-focus-selection §4/§9): freeze past periods with achieved load
// (same semantics the old replanSeasonArc always had for this bucket), preserve a period straddling
// today verbatim until it ends, and drop every future period — rolling mode no longer drafts a
// forward sequence; chooseNextFocus decides each block's focus fresh instead. What remains after this
// is pure settled history: done-cards for the roadmap, achievedTss for the selector's execution
// signal. Pure + idempotent.
export function settleSeasonHistory(
  plan: SeasonPlan,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  const current = plan.periods.filter((p) => p.startDate <= today && periodEnd(p) > today);
  const periods = [...frozen, ...current].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}

// Event-anchored mode (season-continuous-focus-selection §7 — kept close to shipped behavior): the
// same three-bucket re-plan the old replanSeasonArc always did for this case (freeze past / preserve
// current / preserve overrides / redraft the tail), with the tail always going straight to
// backwardScheduleFromEvent instead of through draftSeasonArc's now-removed dispatcher. Deload-cadence
// threading is gone because it never applied to this path (see backwardScheduleFromEvent's own
// comment: peak/taper are exempt).
export function replanEventArc(
  plan: SeasonPlan,
  event: SeasonEvent,
  input: SeasonDraftInput,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  const current = plan.periods.filter((p) => p.startDate <= today && periodEnd(p) > today);
  const overrides = plan.periods.filter(
    (p) => periodEnd(p) > today && p.source === "override" && !current.includes(p)
  );
  const anchors = [...current, ...overrides];
  const draftStart = anchors.length ? anchors.map((p) => periodEnd(p)).sort().reverse()[0] : today;
  const keptPeriods = [...frozen, ...current, ...overrides];
  const derived = backwardScheduleFromEvent(event, input, draftStart);
  const periods = [...keptPeriods, ...derived].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}

// Real achieved load for a period, summed from the score-log ledger (RideScoreEntry.tss) — the
// immutable, long-lived record (last-sync.json is a rolling ~45-day window that can age a period
// out before it's stamped; the ledger can't). End-EXCLUSIVE range, matching periodForDate's
// straddling definition. null when no in-range entry carries a tss: "no data" must stay
// distinguishable from "zero load" (settleSeasonHistory/replanEventArc each stamp achievedTss once,
// ?? keeps retrying null until data exists). Wired as the route's achievedTssFor (closes the `() =>
// null` gap).
export function achievedTssForPeriod(
  entries: Array<Pick<RideScoreEntry, "date" | "tss">>,
  period: FocusPeriod
): number | null {
  const end = periodEnd(period);
  const inRange = entries.filter((e) => e.date >= period.startDate && e.date < end && e.tss !== null);
  if (inRange.length === 0) return null;
  return Math.round(inRange.reduce((sum, e) => sum + (e.tss as number), 0));
}

// The period covering an arbitrary ISO date — start inclusive, end exclusive, the same straddling
// definition settleSeasonHistory/replanEventArc's "current" bucket uses. Null when no period covers the date.
export function periodForDate(plan: SeasonPlan, date: string): FocusPeriod | null {
  return plan.periods.find((p) => p.startDate <= date && periodEnd(p) > date) ?? null;
}

// The period straddling `today` (started, not yet ended) — periodForDate specialised to "now".
// Null when the plan has no period covering today (e.g. an empty/stale plan).
export function currentPeriod(plan: SeasonPlan, today: string): FocusPeriod | null {
  return periodForDate(plan, today);
}

// Every period an inclusive date range [startDate, endDate] overlaps, in chronological order. A block
// can span several focus periods — a 6–8-week block routinely outlives a 3-week mesocycle.
export function periodsInRange(plan: SeasonPlan, startDate: string, endDate: string): FocusPeriod[] {
  return plan.periods
    .filter((p) => p.startDate <= endDate && periodEnd(p) > startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

const ALLOWED_BLOCK_WEEKS = [2, 4, 6, 8] as const;

// Suggested (not locked) block length for the generator's pre-fill: ceiling-rounds the period's remaining
// weeks to the smallest allowed value >= it, floored at 2, capped at 8. Ceiling (not nearest/floor) is
// deliberate — the suggested block always covers AT LEAST the rest of the current period rather than
// leaving a stray week neither covered by the block nor a full next period; a block running slightly past
// the period boundary is the already-accepted case (settleSeasonHistory/replanEventArc's three-bucket
// re-plan handles it).
export function suggestedBlockWeeks(period: FocusPeriod, today: string): 2 | 4 | 6 | 8 {
  const remaining = period.plannedWeeks - weeksBetween(period.startDate, today);
  for (const w of ALLOWED_BLOCK_WEEKS) {
    if (w >= remaining) return w;
  }
  return 8;
}

// Goals relevant to the season's current focus, for the block-goal pre-fill: a focus match, plus every
// "general"-tagged goal (not tied to one physiological system — always shown). Returns every goal
// unfiltered when there's no current period (seasonFocus null) — identical to today's un-narrowed pre-fill.
export function filterGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(
  goals: T[],
  seasonFocus: SeasonFocus | null
): T[] {
  if (seasonFocus === null) return goals;
  return goals.filter((g) => g.focus === seasonFocus || g.focus === "general");
}

// Prompt-injectable summary of where the athlete sits in the season arc. Without a blockRange — or when
// the range fits inside one period — this is the original one-liner (byte-identical output is a
// compatibility contract: PlanView and single-period blocks depend on the exact wording). When the range
// spans several periods it instead lists each period's segment in chronological order, mapped to block
// weeks, so the generator plans each week against ITS OWN period instead of stamping one static phase on
// the whole block. Null when there's nothing to describe (no covering period at all).
export function formatSeasonContext(
  plan: SeasonPlan,
  today: string,
  blockRange?: { startDate: string; endDate: string }
): string | null {
  const objective = plan.objective.trim() ? `${plan.objective.trim()} — ` : "";
  const spanned = blockRange ? periodsInRange(plan, blockRange.startDate, blockRange.endDate) : [];
  if (blockRange && spanned.length > 1) {
    const dayBefore = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10);
    const wkOf = (iso: string) => Math.floor((Date.parse(iso) - Date.parse(blockRange.startDate)) / (7 * 86_400_000)) + 1;
    const segments = spanned.map((p) => {
      const from = p.startDate > blockRange.startDate ? p.startDate : blockRange.startDate;
      const periodLast = dayBefore(periodEnd(p));
      const to = periodLast < blockRange.endDate ? periodLast : blockRange.endDate; // clip to the block
      const wkFrom = wkOf(from);
      const wkTo = wkOf(to);
      const wks = wkFrom === wkTo ? `wk ${wkFrom}` : `wk ${wkFrom}–${wkTo}`;
      const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
      // deloadWeek means ONLY the period's own trailing week is lighter — never the whole segment.
      // A multi-week segment must name which single week that is (and only if this block actually
      // reaches it — periodLast <= blockRange.endDate means the clip above didn't cut the period's
      // true tail off early), or a 2+ week span reads as fully deload and the model treats every
      // week in it as light (found live, 2026-07-16 — a 2-week aerobic-base segment both flagged
      // deload, producing two consecutive light weeks instead of one).
      const deload = p.deloadWeek && periodLast <= blockRange.endDate
        ? wkFrom === wkTo
          ? " · deload week"
          : ` · deload in wk ${wkTo} ONLY — wk ${wkFrom}${wkTo - 1 > wkFrom ? `–${wkTo - 1}` : ""} still loads normally`
        : "";
      return `- ${wks} (${from} → ${to}): phase ${p.phase} · focus ${p.focus} · ${p.intensitySplit} split${load}${deload}. ${p.rationale}`;
    });
    return `SEASON CONTEXT: ${objective}this block spans ${spanned.length} season periods — plan each week to match its own period, shifting phase/intensity at the boundaries:\n${segments.join("\n")}`;
  }
  const p = spanned[0] ?? currentPeriod(plan, today);
  if (!p) return null;
  const wk = Math.max(1, weeksBetween(p.startDate, today) + 1);
  const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
  // Same fix as the multi-segment branch above: deloadWeek means only the period's OWN final week
  // is lighter. "wk 2 of 3 ... deload week" previously read as ambiguous — name explicitly whether
  // we're actually in that final week yet, so an early week in a deload-flagged period isn't
  // mistaken for the deload itself.
  const deload = p.deloadWeek
    ? wk === p.plannedWeeks
      ? " · deload week"
      : ` · deload arrives wk ${p.plannedWeeks} (not yet — load normally now)`
    : "";
  return `SEASON CONTEXT: ${objective}phase ${p.phase} · focus ${p.focus} · wk ${wk} of ${p.plannedWeeks}${load}${deload}. ${p.rationale}`;
}

// Rolling-mode prompt context (season-continuous-focus-selection §4) — replaces formatSeasonContext
// for the no-upcoming-A-event case. Instruction-shaped, not "you are in phase X": there is no drafted
// period for "wk N of M" to refer to — one focus covers the whole block, every week, full stop (no
// mid-block phase shift, unlike the old period-boundary model).
export function formatFocusContext(choice: FocusChoice, objective: string): string {
  const obj = objective.trim() ? `${objective.trim()} — ` : "";
  return `BLOCK FOCUS: ${obj}${choice.focus} — ${choice.rationale}. Build this block's quality sessions around this focus; every week shares it (no mid-block phase shift).`;
}

// Rolling-mode validator (season-continuous-focus-selection §4) — replaces validateSeasonFit +
// validateFocusMatch for the no-upcoming-A-event case: one block-wide focus, no per-period bucketing,
// no spanDays fairness gate (the whole block belongs to its one chosen focus, so it always gets a fair
// chance). Merges both old checks: a build focus needs >=1 matching session; aerobic-base needs a
// duration-weighted hard-share <= 20%. Mirrors validateFocusMatch's matcher table and
// validateSeasonFit's hard-share math exactly (same thresholds, same "Season fit:" prefix contract).
export interface FocusSessionMatcher {
  label: string;
  match: (d: PlannedDay) => boolean;
}

// Shared by validateBlockFocus, validateFocusMatch, and formatFocusCoverageLine (P2c, 2026-07-24
// block-generation redesign) — ONE definition of "what session satisfies focus X" so the requirement
// injected into the prompt and its post-generation enforcement can never disagree. Previously
// duplicated verbatim in both validators. aerobic-base/sharpen have no single required session type
// and are absent (callers treat a missing entry as "no specific type owed").
export function focusSessionMatchers(ftp: number): Partial<Record<SeasonFocus, FocusSessionMatcher>> {
  return {
    vo2max: { label: "VO2max", match: (d) => d.type === "VO2max" },
    threshold: { label: "Threshold", match: (d) => d.type === "Threshold" },
    anaerobic: { label: "SIT (anaerobic)", match: (d) => d.type === "SIT" },
    durability: {
      label: "durability-loaded Z2 (embedded threshold+ work)",
      match: (d) => (d.type === "Z2" || d.type === "Recovery") && carriesEmbeddedIntensity(d.workoutText, ftp),
    },
  };
}

// P2c (2026-07-24 block-generation redesign): the block's chosen focus, injected as a mandatory
// coverage requirement BEFORE generation — the reviewed live block shipped zero VO2max sessions
// despite VO2max being the athlete's own profile-flagged FTP limiter, with nothing upfront asking for
// it. Reuses focusSessionMatchers so this requirement and validateBlockFocus's/
// validatePrimaryQualityCadence's enforcement can never drift apart.
// P5 (2026-07-24, athlete direction): upgraded from "at least 1 somewhere in the block" to "every
// loading week" — this was originally held back because stacking it alongside RaceSim's own
// per-loading-week ask risked over-constraining the shared quality-session budget (P2a's concern).
// That's resolved now: RaceSim is relaxed to a sporadic, block-wide ask (lib/session-requirements.ts),
// explicitly subordinate to structured interval work for the same budget — so the primary quality can
// safely claim every loading week. Rolling mode only (event-anchored mode stays behind
// SEASON_SHAPES_GENERATION, same as the rest of the doubted fixed-phase bundle).
export function formatFocusCoverageLine(focus: SeasonFocus, ftp: number): string | null {
  const m = focusSessionMatchers(ftp)[focus];
  if (!m) return null;
  return `REQUIRED COVERAGE: this block's focus is ${focus} — include at least 1 ${m.label} session in EVERY loading week (not just once across the block). This is the block's primary quality work — it takes priority over RaceSim for the week's quality-session slots; RaceSim is sporadic and fills a slot only when it doesn't crowd this out. Do not substitute a different quality type for this requirement.`;
}

export function validateBlockFocus(days: PlannedDay[], focus: SeasonFocus, ftp: number): string[] {
  const rides = days.filter((d) => d.type !== "Rest" && d.type !== "Strength");
  if (rides.length === 0) return [];
  const dates = rides.map((d) => d.date).sort();

  if (focus === "aerobic-base") {
    const totalMin = rides.reduce((sum, d) => sum + d.durationMin, 0);
    if (totalMin <= 0) return [];
    const HARD = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
    const hardMin = rides.filter((d) => HARD.has(d.type)).reduce((sum, d) => sum + d.durationMin, 0);
    const hardShare = hardMin / totalMin;
    if (hardShare <= 0.2) return [];
    return [`Season fit: ${dates[0]} → ${dates[dates.length - 1]} — this block's focus is aerobic-base, but ${Math.round(hardShare * 100)}% of riding time is hard — expected mostly Z2.`];
  }

  const m = focusSessionMatchers(ftp)[focus];
  if (!m || rides.some(m.match)) return [];
  return [`Season fit: ${dates[0]} → ${dates[dates.length - 1]} — this block's focus is ${focus} but carries zero ${m.label} sessions.`];
}

// P5a (2026-07-24 block-generation redesign): validateBlockFocus's block-wide floor ("at least 1
// somewhere") doesn't catch the actual defects found live — Week 3 silently dropped its standalone
// Threshold session, and SIT vanished entirely in weeks 5-6 despite the overview claiming escalation.
// Both are "primary quality disappeared mid-block," which a block-wide minimum of 1 can't see. This
// checks every LOADING week specifically (recovery weeks are exempt — the KB's own "quality is
// minimal" framing applies there), reusing the same matcher table so this can never disagree with
// formatFocusCoverageLine's prompt instruction or validateBlockFocus's own floor.
export function validatePrimaryQualityCadence(
  days: PlannedDay[],
  focus: SeasonFocus,
  weekTargets: WeekTarget[],
  ftp: number
): string[] {
  const m = focusSessionMatchers(ftp)[focus];
  if (!m) return []; // aerobic-base/sharpen have no single required session type
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  const warnings: string[] = [];
  for (const t of weekTargets) {
    if (t.isRecovery) continue;
    const weekDays = byWeek.get(t.weekNumber) ?? [];
    if (!weekDays.some(m.match)) {
      warnings.push(
        `PRIMARY QUALITY: week ${t.weekNumber} (loading) — this block's focus is ${focus} but has no ${m.label} session this week. The primary quality should appear every loading week, not skip weeks.`
      );
    }
  }
  return warnings;
}

// B/C-priority events inside this block's own date range — surfaced so a real planned test/race
// day doesn't get a generic session written on top of it. A-priority events are deliberately
// excluded here: they already take over the whole arc via replanEventArc's backward-scheduling
// (this is the ONLY place a B/C event gets any generation-time visibility at all).
export function formatUpcomingEventsForBlock(
  events: SeasonEvent[],
  blockRange: { startDate: string; endDate: string }
): string | null {
  const inRange = events
    .filter((e) => e.priority !== "A" && e.date >= blockRange.startDate && e.date <= blockRange.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length === 0) return null;
  // P4 (2026-07-24 block-generation redesign): a lightweight taper cue for B/C events, short of full
  // A-tier backward scheduling — no quality session in the final 2 days before the event, and no more
  // than 1 other quality session in its own week. Enforced post-generation by validateEventTaper.
  const lines = inRange.map(
    (e) =>
      `- ${e.date}: ${e.name} (priority ${e.priority}) — protect this day; build the week around it rather than overwriting it with a generic session. Taper into it: no quality session (Threshold/VO2max/SIT/RaceSim) in the 2 days before, and at most 1 other quality session that week.`
  );
  return `UPCOMING EVENTS THIS BLOCK:\n${lines.join("\n")}`;
}

// A short prompt-injectable nudge when the athlete's tested FTP has gone stale (ftpStaleDays is the
// figure /api/profile already computes off physiology.json's effectiveFrom). Due every
// retestEveryWeeks — one arc. Points at THIS block's own recovery week (from planRecoveryWeeks, above)
// instead of looking ahead into a drafted period array — there is no such array to look ahead into
// once a block's focus is chosen fresh each call (season-continuous-focus-selection §5). Null when
// fresh or unknown. A nudge, never a hard gate.
export function formatRetestNote(ftpStaleDays: number | null, recoveryWeekIndices: number[], blockStartDate: string): string | null {
  if (ftpStaleDays === null || ftpStaleDays < SEASON_CONSTANTS.retestEveryWeeks * 7) return null;
  const where = recoveryWeekIndices.length > 0
    ? ` Best slot: this block's recovery week starting ${addWeeks(blockStartDate, recoveryWeekIndices[0])}.`
    : "";
  return `RETEST DUE: FTP last validated ${ftpStaleDays} days ago (cadence ~${SEASON_CONSTANTS.retestEveryWeeks} wk). Schedule an FTP/power-curve retest to re-anchor zones and load targets.${where}`;
}

// Non-blocking warnings, mirroring validateSchedule/validateNutrition. A base period should skew easy.
// Each day is checked against the period covering ITS OWN date (a long block can span base → build, and
// build-week quality must not be blamed on an earlier base period), and the hard share is
// duration-weighted — what a "90/10 by time" split actually means — so two short quality touches in a
// six-ride week no longer trip a count-based tripwire, while one monster hard day can't hide behind a
// low session count either. Days outside every period are skipped.
export function validateSeasonFit(days: PlannedDay[], plan: SeasonPlan, ftp: number): string[] {
  void ftp;
  const warnings: string[] = [];
  const HARD = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
  // Bucket riding days by the period active on their own date (insertion order keeps warnings chronological).
  const buckets = new Map<FocusPeriod, PlannedDay[]>();
  for (const d of days) {
    if (d.type === "Rest" || d.type === "Strength") continue;
    const p = periodForDate(plan, d.date);
    if (!p) continue;
    const rides = buckets.get(p);
    if (rides) rides.push(d);
    else buckets.set(p, [d]);
  }
  for (const [p, rides] of buckets) {
    const totalMin = rides.reduce((sum, d) => sum + d.durationMin, 0);
    if (totalMin <= 0) continue;
    const hardMin = rides.filter((d) => HARD.has(d.type)).reduce((sum, d) => sum + d.durationMin, 0);
    const hardShare = hardMin / totalMin;
    if ((p.phase === "base" || p.phase === "transition") && hardShare > 0.2) {
      const label = p.phase === "transition" ? "transition (season-break)" : "base/aerobic";
      const dates = rides.map((d) => d.date).sort();
      warnings.push(
        `Season fit: ${dates[0]} → ${dates[dates.length - 1]} sits in a ${label} period (${p.intensitySplit}), but ${Math.round(hardShare * 100)}% of riding time is hard — expected mostly Z2.`
      );
    }
  }
  return warnings;
}

// Companion to validateSeasonFit (same non-blocking "Season fit: ..." contract): does a build period's
// actual generated training match its own focus LABEL? Intensity-share can pass while the label lies —
// a "vo2max" period full of threshold work is a plan/label disagreement worth surfacing. Mapping is the
// reverse of the route's mapSystemToFocus vocabulary: vo2max→VO2max, threshold→Threshold, anaerobic→SIT,
// durability→a Z2/Recovery ride actually carrying embedded threshold+ work (carriesEmbeddedIntensity —
// PlannedDay carries no durability-template stamp, so the parsed prescription is the evidence). Only
// fires when the block gives the period a fair chance: the period's bucket must span ≥ 7 calendar days.
// aerobic-base/sharpen imply no specific quality type and are skipped.
export function validateFocusMatch(days: PlannedDay[], plan: SeasonPlan, ftp: number): string[] {
  const matchers = focusSessionMatchers(ftp);
  const warnings: string[] = [];
  const buckets = new Map<FocusPeriod, PlannedDay[]>();
  for (const d of days) {
    if (d.type === "Rest" || d.type === "Strength") continue;
    const p = periodForDate(plan, d.date);
    if (!p) continue;
    const rides = buckets.get(p);
    if (rides) rides.push(d);
    else buckets.set(p, [d]);
  }
  for (const [p, rides] of buckets) {
    const m = matchers[p.focus];
    if (!m) continue;
    const dates = rides.map((d) => d.date).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
    if (spanDays < 6) continue; // the block only brushes this period — it doesn't owe it a session
    if (rides.some(m.match)) continue;
    warnings.push(
      `Season fit: ${dates[0]} → ${dates[dates.length - 1]} sits in a ${p.focus} period but carries zero ${m.label} sessions — the period's focus label and its prescribed training disagree.`
    );
  }
  return warnings;
}

const FOCUS_LABEL: Record<SeasonFocus, string> = {
  "aerobic-base": "Aerobic", threshold: "Threshold", vo2max: "VO2max", anaerobic: "Anaerobic", durability: "Durability", sharpen: "Sharpen",
};

// Pure view-model for the /plan roadmap stepper. Status mirrors currentPeriod's straddling
// definition (periodEnd(p) <= today → done; p.startDate <= today → current; else upcoming).
export function roadmapView(plan: SeasonPlan, today: string): {
  focus: SeasonFocus;
  phase: SeasonPhase;
  label: string;
  weeks: number;
  status: "done" | "current" | "upcoming";
  deloadWeek: boolean;
  targetWeeklyTss: number | null;
  startDate: string;
}[] {
  return plan.periods.map((p) => ({
    focus: p.focus,
    phase: p.phase,
    label: FOCUS_LABEL[p.focus],
    weeks: p.plannedWeeks,
    deloadWeek: p.deloadWeek,
    targetWeeklyTss: p.targetWeeklyTss,
    status: (periodEnd(p) <= today ? "done" : p.startDate <= today ? "current" : "upcoming") as "done" | "current" | "upcoming",
    startDate: p.startDate,
  }));
}

// Pure input validator for PUT /api/season (athlete-owned fields only — periods stay engine-drafted).
// Mirrors parseBlockParams' style: returns the parsed object, or a string error message on invalid input.
export function validateSeasonPlanInput(body: unknown): { objective: string; events: SeasonEvent[] } | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const b = body as Record<string, unknown>;
  const objective = typeof b.objective === "string" ? b.objective.trim() : "";
  const rawEvents = Array.isArray(b.events) ? b.events : [];
  const events: SeasonEvent[] = [];
  for (const e of rawEvents) {
    if (!e || typeof e !== "object") return "Each event must be an object.";
    const ev = e as Record<string, unknown>;
    const name = typeof ev.name === "string" ? ev.name.trim() : "";
    const date = typeof ev.date === "string" ? ev.date : "";
    const priority = ev.priority;
    if (!name) return "Event name is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return "Event date must be a valid YYYY-MM-DD.";
    if (priority !== "A" && priority !== "B" && priority !== "C") return "Event priority must be A, B or C.";
    events.push({ name, date, priority });
  }
  return { objective, events };
}
