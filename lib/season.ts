// Macro periodization engine (MACRO-1..3). Pure + deterministic: drafts a rough, rolling season arc of
// limiter-focus periods, grounded in the knowledge base. The LLM only phrases FocusPeriod.rationale.
import type { FocusPeriod, PlannedDay, SeasonEvent, SeasonFocus, SeasonPhase, SeasonPlan, WorkoutType, AthleteModel, RideScoreEntry } from "./types";
import { DEFAULT_ACWR_BANDS } from "./calibration";
import { tagPresent } from "./session-requirements";
import { carriesEmbeddedIntensity } from "./prescription";
import { execFor } from "./intervention";

// Season phase/deload/retest context + the two season-fit/focus-match validators are TEMPORARILY
// DISABLED from shaping or gating block generation (2026-07-16, athlete decision) -- the fixed
// phase-sequence model itself is a separate, deferred question (see ROADMAP.md "Season architecture
// doubt": whether always prescribing a phase sequence regardless of a rider's existing base is even
// the right model). Season state keeps being tracked underneath this flag (replanSeasonArc still
// runs, season-plan.json still updates, B/C-priority event surfacing still injects -- those are
// calendar facts, not phase opinion) -- only the PHASE-DERIVED opinion about what a week should
// emphasise, and the validators that grade generated days against it, are switched off. Flip back to
// true once the season model is revisited.
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
  loadRampPct: 6, // +5–8% weekly-TSS ramp midpoint
  horizonPeriods: 5, // how many future periods to draft (rough & rolling)
  arcWeeks: { min: 8, max: 12 }, // bounded emphasis arc: consecutive loading weeks between aerobic-base touches
  transitionEveryLoadingWeeks: 20, // a genuine season break after ~2 full arcs of continuous loading
  transitionWeeks: 2, // the break itself: a light fortnight — volume AND intensity down
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
  // Calendar weeks since the last genuine reduced-load break (phase "transition") ended — from
  // weeksSinceSeasonBreak(). Absent/null = unknown → never draft a break (conservative).
  weeksSinceSeasonBreak?: number | null;
  // Calendar weeks already accumulated toward the NEXT deload boundary — from weeksSinceLastDeload().
  // Absent → 0 (matches every pre-existing caller/test: a fresh draft with no prior context starts
  // the cadence from scratch, same as before this field existed).
  weeksSinceLastDeload?: number;
}

const BUILD_FOCI: SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability"];

// KB: "base is non-negotiable." Lead with a base touch when the recent window carries none.
export function needsBaseGate(recentFocuses: SeasonFocus[]): boolean {
  return !recentFocuses.slice(-4).includes("aerobic-base");
}

// Estimated consecutive loading weeks since the last aerobic-base touch in a focus history
// (most recent last). The history carries no per-period week counts, so KB default weeks per
// focus are the estimate — good enough to bound an arc; overrides that stretched a period only
// shift the boundary by a week or two.
export function weeksSinceBase(recentFocuses: SeasonFocus[]): number {
  const idx = recentFocuses.lastIndexOf("aerobic-base");
  const tail = idx === -1 ? recentFocuses : recentFocuses.slice(idx + 1);
  return tail.reduce((sum, f) => sum + SEASON_CONSTANTS.weeks[f], 0);
}

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
// urgency with neutral goal/execution — the exact call shape the macro-structure sibling's
// pickBuildFocus delegation uses.
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

// Score all four build foci, best first. Each part is its WEIGHTED contribution so a caller (or a
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
// the drop-in seam the macro-structure sibling's pickBuildFocus delegates to.
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

// Type guard for a persisted-but-untyped focus string (CurrentBlock.seasonFocus is `string`, not
// SeasonFocus, so a block written before this field existed — or corrupted by hand-editing JSON —
// can't be trusted without a runtime check before feeding it into chooseNextFocus's lastFocus).
const SEASON_FOCI: readonly SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen"];
export function isSeasonFocus(v: string | undefined): v is SeasonFocus {
  return v !== undefined && (SEASON_FOCI as readonly string[]).includes(v);
}

// A week is "genuinely light" at/below this fraction of the athlete's own rolling weekly baseline —
// mirrors assignLoadTargets' "a genuine season break: ~50% load" convention and
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
// an 8-week block still gets recovery weeks spaced correctly, not just one at the front.
// NB: the loop deliberately stops one week short of `lengthWeeks` — a cap reached on a block's own
// final week is never planned as a recovery week *inside* that block. That final week is the block's
// transition point anyway (the next block's own realWeeksSinceLastRecovery call sees the same real
// data and, being right back at/over the cap, force-places recovery at ITS week 0 instead) — so a
// same-week recovery designation right at the boundary would be redundant, not helpful.
export function planRecoveryWeeks(weeksSinceRecovery: number, lengthWeeks: number, tight: boolean): number[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  const indices: number[] = [];
  let sinceRecovery = weeksSinceRecovery;
  for (let wk = 0; wk < lengthWeeks - 1; wk++) {
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

// Thin wrapper kept for existing call sites/tests: labels-only scored selection. The scored selector
// (selectBuildFocus, above) replaced both the original "first non-last of defaultBuildOrder()" fallback
// and the interim least-recently-used fallback (2026-07-15-season-critical-fixes) — the limiter is now
// a weighted bonus, not an unconditional winner.
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  return selectBuildFocus(limiter, recentFocuses);
}

// Event-anchored path selector — delegates to the scored coverage selector (2026-07-15-season-coverage-selector,
// already landed) so both the rolling and event-anchored paths share one selection quality. No signals threaded
// here (the event path has no per-day session data in scope); labels-only scoring still beats the old fixed cycle.
export function pickBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  return selectBuildFocus(limiter, recentFocuses);
}

function period(focus: SeasonFocus, phase: SeasonPhase, startDate: string, confidence: FocusPeriod["confidence"], rationale: string): FocusPeriod {
  return {
    focus, phase, startDate,
    plannedWeeks: focus === "sharpen" ? 1 : SEASON_CONSTANTS.weeks[focus],
    intensitySplit: SEASON_CONSTANTS.split[focus],
    targetWeeklyTss: null, // assigned in Task 4
    deloadWeek: false, // assigned in Task 3
    rationale, source: "derived", confidence,
  };
}

// Mode-C rolling cycle: base-gate → rotating limiter-focus build periods → a realize week. (Deload + load
// targets + the event overlay are layered by later helpers.) Drafts SEASON_CONSTANTS.horizonPeriods ahead.
export function draftSeasonArc(input: SeasonDraftInput, today: string): FocusPeriod[] {
  // Event-anchored mode: a future A-priority event takes over the whole arc (dormant until one exists —
  // see backwardScheduleFromEvent). Otherwise fall through to the Mode-C rolling cycle unchanged.
  const aEvent = input.events.find((e) => e.priority === "A" && Date.parse(e.date) > Date.parse(today));
  if (aEvent) return backwardScheduleFromEvent(aEvent, input, today);

  const periods: FocusPeriod[] = [];
  const recent = [...input.recentFocuses];
  // Foci actually drafted during THIS draftSeasonArc call — deliberately separate from `recent`,
  // which is seeded from input.recentFocuses (the incoming history) and then grows. See the
  // real-exposure filter below for why the distinction matters.
  const draftedThisCall = new Set<SeasonFocus>();
  let cursor = today;
  const conf = input.limiter.confidence;
  let sinceBreak = input.weeksSinceSeasonBreak ?? null;

  // A "reset" is either a plain 3-wk aerobic-base touch (arc boundary / base gate) or — once
  // ~two arcs of continuous loading have accrued since the last one — a genuine 2-wk
  // phase-"transition" break: volume AND intensity down, a real seasonal breather the weekly
  // 3:1 deloadWeek cadence never provides. Either way it counts as the arc's base touch.
  const pushReset = () => {
    if (sinceBreak !== null && sinceBreak >= SEASON_CONSTANTS.transitionEveryLoadingWeeks) {
      periods.push({
        focus: "aerobic-base", phase: "transition", startDate: cursor,
        plannedWeeks: SEASON_CONSTANTS.transitionWeeks, intensitySplit: "95/5",
        targetWeeklyTss: null, deloadWeek: false,
        rationale: "Season break — ~two arcs of continuous loading absorbed; a genuinely light fortnight (volume AND intensity down) before the next arc.",
        source: "derived", confidence: conf,
      });
      sinceBreak = 0;
    } else {
      periods.push(period("aerobic-base", "base", cursor, conf,
        periods.length === 0 && needsBaseGate(input.recentFocuses)
          ? "Aerobic base — the ceiling for every later phase (KB)."
          : "Arc boundary — re-touch aerobic base so the build doesn't run monotone (Foster 1998: illness tracks load × monotony)."));
      if (sinceBreak !== null) sinceBreak += periods[periods.length - 1].plannedWeeks;
    }
    recent.push("aerobic-base");
    draftedThisCall.add("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  };

  if (needsBaseGate(recent)) pushReset();

  // Arc cap (Foster 1998: illness risk tracks load × monotony): consecutive loading weeks since the
  // last base touch may never exceed arcWeeks.max — the touch also resets the rotation's recency
  // window, so the same two-focus pattern can't repeat unchanged across an arc boundary.
  let sinceBase = weeksSinceBase(recent);

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    // Real exposure (signals.exposure) is measured once, as of `today` — it does not update as this
    // loop hypothetically drafts future periods, unlike labelExposureWeeks(recent, focus), which
    // grows every iteration. Left unadjusted, a focus with real (low) exposure and no confident-limiter
    // competitor can out-score every focus that's never been trained at all for the ENTIRE draft,
    // recreating a two-focus alternation for a new reason (found live, 2026-07-15 — a confident
    // anaerobic limiter with real recent SIT/Threshold exposure locked out vo2max/durability, whose
    // real exposure was real but comparatively stale and never got a chance to grow further). Fix:
    // extrapolate a not-yet-drafted focus's real staleness forward by how far this draft has already
    // advanced past `today`; once a focus IS drafted (during THIS call), drop its real exposure
    // entirely so it falls through to labelExposureWeeks, which already resets/regrows correctly from
    // that point on. NOTE (bug found by the final whole-branch review): this must check
    // `draftedThisCall`, NOT `recent` — `recent` is seeded from input.recentFocuses (the incoming
    // history, e.g. the last 4 kept period labels in replanSeasonArc) and only grows from there, so
    // checking it conflated "already in the incoming history" with "drafted this call". That silently
    // discarded real exposure data for any focus whose label already appeared in the incoming history —
    // from iteration 1, before this call had drafted anything — defeating the real-data preference for
    // exactly the foci most likely to have real data.
    const weeksIntoThisDraft = weeksBetween(today, cursor);
    const adjustedSignals: FocusSignals | undefined = input.focusSignals?.exposure
      ? {
          ...input.focusSignals,
          exposure: Object.fromEntries(
            Object.entries(input.focusSignals.exposure)
              .filter(([f]) => !draftedThisCall.has(f as SeasonFocus))
              .map(([f, weeks]) => [f, (weeks as number) + weeksIntoThisDraft])
          ) as Partial<Record<SeasonFocus, number>>,
        }
      : input.focusSignals;
    const focus = selectBuildFocus(input.limiter, recent, adjustedSignals);
    const focusWeeks = SEASON_CONSTANTS.weeks[focus];
    if (sinceBase >= SEASON_CONSTANTS.arcWeeks.min && sinceBase + focusWeeks > SEASON_CONSTANTS.arcWeeks.max) {
      pushReset();
      sinceBase = 0;
      continue;
    }
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    draftedThisCall.add(focus);
    sinceBase += focusWeeks;
    if (sinceBreak !== null) sinceBreak += focusWeeks;
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  periods.push(period("sharpen", "build", cursor, conf, "Realize — a lighter week to absorb the block and re-test."));
  const withDeloads = applyDeloadCadence(periods, input.heavyFatigue, input.weeksSinceLastDeload ?? 0);
  const seed = input.ftp !== null && input.ctl !== null ? input.recentWeeklyTss : null;
  return assignLoadTargets(withDeloads, seed, DEFAULT_ACWR_BANDS.optimalHigh);
}

// Ramps each period's targetWeeklyTss ~+loadRampPct% off the prior period (first period off seedWeeklyTss).
// targetWeeklyTss is the period's LOADING-week target: every period advances the ramp — deloadWeek does
// NOT dampen it. The flag means "this period's TRAILING week is lighter", and that lighter week is sized
// downstream (BlockSettings.recoveryWeekHoursMin/Max in the block generator + formatSeasonContext's
// "deload week" prompt phrase), never by this envelope. (The old 0.6x/frozen-base branch was abandoned
// because applyDeloadCadence and this load-target logic together were colliding, each over-flagging.
// This session fixed applyDeloadCadence's threshold math; the 0.6x path remains inert.)
// Capped so a target never exceeds seedWeeklyTss * acwrCeiling.
// Null seed → all targets remain null.
export function assignLoadTargets(periods: FocusPeriod[], seedWeeklyTss: number | null, acwrCeiling: number): FocusPeriod[] {
  if (seedWeeklyTss === null || !Number.isFinite(seedWeeklyTss) || seedWeeklyTss <= 0) {
    return periods.map((p) => ({ ...p, targetWeeklyTss: null }));
  }
  const ramp = 1 + SEASON_CONSTANTS.loadRampPct / 100;
  const ceiling = seedWeeklyTss * acwrCeiling;
  let prev = seedWeeklyTss;
  return periods.map((p) => {
    const isBreak = p.phase === "transition"; // a genuine season break: ~50% load, deeper than a deload
    const target = isBreak
      ? Math.round(prev * 0.5)
      : Math.min(Math.round(prev * ramp), Math.round(ceiling));
    if (!isBreak) prev = target; // deloadWeek still advances the base (KB: only the flag dampens the trailing week, never this envelope) — only a transition break freezes it
    return { ...p, targetWeeklyTss: target };
  });
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
    // in-between slots rotate least-recently-used across ALL four build systems. The old fixed
    // [threshold, vo2max, durability] index cycle could never schedule anaerobic and ignored the
    // limiter entirely. (Adjacency is symmetric, so no-back-to-back survives the reversal;
    // input.recentFocuses is deliberately NOT seeded here — chronologically it borders the START
    // of the runway, i.e. the LAST period this loop generates, not the first.)
    const chosen: SeasonFocus[] = [];
    while (filled < runway) {
      const focus = pickBuildFocus(input.limiter, chosen);
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

// Re-plan the rolling arc: periods that have already ended are frozen (stamped with achieved load, never
// re-derived), the period straddling today is preserved verbatim (it's already in progress — regenerating
// it mid-stream would change the roadmap's "current, wk N/M" card's identity on every re-plan), any future
// athlete-edited override is preserved verbatim, and only the remaining derived tail is re-drafted —
// starting after whichever of {the current period, the last override} ends latest (or from `today` if
// neither exists). Pure + idempotent: unchanged inputs re-run produce the same periods (frozen achievedTss
// is filled once, not re-stamped; the current period is never re-stamped either; the derived tail is a
// deterministic function of the unchanged seed state).
export function replanSeasonArc(
  plan: SeasonPlan,
  input: SeasonDraftInput,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  // Past = periods that have already ended → frozen with achieved load, never re-drafted.
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  // The period straddling today (started, not yet ended) is preserved verbatim — regenerating it
  // mid-stream would make the roadmap's "current, wk N/M" card change identity on every re-plan.
  // No achievedTss stamp: it isn't complete yet.
  const current = plan.periods.filter((p) => p.startDate <= today && periodEnd(p) > today);
  // Future overrides the athlete edited → preserved verbatim. Excludes anything already in `current`
  // so a straddling override isn't duplicated between the two buckets.
  const overrides = plan.periods.filter(
    (p) => periodEnd(p) > today && p.source === "override" && !current.includes(p)
  );
  // Re-draft the derived tail seeded by what actually happened, starting after whichever of
  // {the straddling current period, the last override} ends latest — never before either. The
  // current period counts as "recent" too (it's real, in-progress context for base-gating/rotation) —
  // omitting it would let the redraft immediately re-insert e.g. a duplicate aerobic-base period right
  // after an in-progress aerobic-base period ends.
  const recentFocuses = [...frozen, ...current].slice(-4).map((p) => p.focus);
  const anchors = [...current, ...overrides];
  const draftStart = anchors.length
    ? anchors.map((p) => periodEnd(p)).sort().reverse()[0]
    : today;
  // Break clock + deload-cadence clock (HR-22) from the KEPT periods only ([frozen, current,
  // overrides]) — the old derived tail being replaced must not count: a discarded drafted
  // transition/deload never actually happened.
  const keptPeriods = [...frozen, ...current, ...overrides];
  const derived = draftSeasonArc(
    { ...input, recentFocuses, weeksSinceSeasonBreak: weeksSinceSeasonBreak(keptPeriods, draftStart), weeksSinceLastDeload: weeksSinceLastDeload(keptPeriods, draftStart) },
    draftStart
  );
  const periods = [...keptPeriods, ...derived].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}

// Real achieved load for a period, summed from the score-log ledger (RideScoreEntry.tss) — the
// immutable, long-lived record (last-sync.json is a rolling ~45-day window that can age a period
// out before it's stamped; the ledger can't). End-EXCLUSIVE range, matching periodForDate's
// straddling definition. null when no in-range entry carries a tss: "no data" must stay
// distinguishable from "zero load" (replanSeasonArc stamps achievedTss once, ?? keeps retrying
// null until data exists). Wired as the route's achievedTssFor (closes the `() => null` gap).
export function achievedTssForPeriod(
  entries: Array<Pick<RideScoreEntry, "date" | "tss">>,
  period: FocusPeriod
): number | null {
  const end = periodEnd(period);
  const inRange = entries.filter((e) => e.date >= period.startDate && e.date < end && e.tss !== null);
  if (inRange.length === 0) return null;
  return Math.round(inRange.reduce((sum, e) => sum + (e.tss as number), 0));
}

// Mark the period that crosses each deload boundary (30–50% volume cut lands in its trailing week).
// Boundary fires when cumulative loading weeks reach `every` (a genuine rolling count ACROSS period
// boundaries, not per-period): a period shorter than `every` on its own must not self-trip just
// because it happens to be a whole mesocycle — it combines with the next period(s) until the full
// cadence is reached. A period whose own length equals or exceeds `every` still fires on its own,
// which is correct (a 4-week period IS one full 4-week loading cycle). Fixed live, 2026-07-16: the
// previous `every - 1` threshold was smaller than any real KB period's own length (all ≥3 weeks),
// so it fired on almost every period regardless of how many calendar weeks had actually passed.
// `seedWeeks` (HR-22, 2026-07-17): weeks already accumulated toward the boundary BEFORE `periods`
// starts — from weeksSinceLastDeload(), threaded in by replanSeasonArc so the rolling count survives
// across /api/generate calls instead of restarting at 0 on every redraft of the future tail. Defaults
// to 0, matching every pre-existing caller/test (a fresh draft with no prior context).
export function applyDeloadCadence(periods: FocusPeriod[], tight: boolean, seedWeeks: number = 0): FocusPeriod[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  let weeksSinceDeload = seedWeeks;
  return periods.map((p) => {
    // A transition IS recovery: never also flag it as a deload, and restart the cadence after it.
    if (p.phase === "transition") {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: false };
    }
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= every) {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: true };
    }
    return { ...p, deloadWeek: false };
  });
}

// The period covering an arbitrary ISO date — start inclusive, end exclusive, the same straddling
// definition replanSeasonArc's "current" bucket uses. Null when no period covers the date.
export function periodForDate(plan: SeasonPlan, date: string): FocusPeriod | null {
  return plan.periods.find((p) => p.startDate <= date && periodEnd(p) > date) ?? null;
}

// Calendar weeks since the athlete's last genuine reduced-load break (phase "transition") ended,
// measured over periods that have started by `asOf`. No transition ever → measured from the first
// started period (season length so far). Null when nothing has started — a brand-new season cannot
// be "overdue for a break".
export function weeksSinceSeasonBreak(periods: FocusPeriod[], asOf: string): number | null {
  const started = periods.filter((p) => p.startDate <= asOf);
  if (started.length === 0) return null;
  const transitions = started.filter((p) => p.phase === "transition");
  const anchor = transitions.length > 0
    ? transitions.map((p) => addWeeks(p.startDate, p.plannedWeeks)).sort().reverse()[0]
    : started.map((p) => p.startDate).sort()[0];
  return weeksBetween(anchor, asOf); // clamps at 0 for an in-progress transition
}

// HR-22 (2026-07-17 hostile review): applyDeloadCadence's "genuine rolling calendar-week count"
// (fixed 2026-07-16) never actually persisted across /api/generate calls — replanSeasonArc preserves
// the in-progress current period verbatim and only redrafts the future tail, so the counter always
// restarted at 0 on that tail, discarding whatever the kept periods had already accumulated toward
// the next boundary. Mirrors weeksSinceSeasonBreak's exact pattern: find the most recent RESET
// point's end (a period flagged deloadWeek:true, or a phase:"transition" — both reset
// applyDeloadCadence's own counter identically) and measure calendar weeks forward from there; no
// reset ever → measure from the first started period (season start). 0 (not null) when nothing has
// started — unlike the break clock, a fresh cadence with no history is simply "0 weeks in", not
// unknown/conservative.
export function weeksSinceLastDeload(periods: FocusPeriod[], asOf: string): number {
  const started = periods.filter((p) => p.startDate <= asOf);
  if (started.length === 0) return 0;
  const resets = started.filter((p) => p.deloadWeek || p.phase === "transition");
  const anchor = resets.length > 0
    ? resets.map((p) => periodEnd(p)).sort().reverse()[0]
    : started.map((p) => p.startDate).sort()[0];
  return weeksBetween(anchor, asOf);
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
// the period boundary is the already-accepted case (replanSeasonArc's three-bucket re-plan handles it).
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

// B/C-priority events inside this block's own date range — surfaced so a real planned test/race
// day doesn't get a generic session written on top of it. A-priority events are deliberately
// excluded here: they already take over the whole arc via draftSeasonArc's backward-scheduling
// (this is the ONLY place a B/C event gets any generation-time visibility at all).
export function formatUpcomingEventsForBlock(
  events: SeasonEvent[],
  blockRange: { startDate: string; endDate: string }
): string | null {
  const inRange = events
    .filter((e) => e.priority !== "A" && e.date >= blockRange.startDate && e.date <= blockRange.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length === 0) return null;
  const lines = inRange.map((e) => `- ${e.date}: ${e.name} (priority ${e.priority}) — protect this day; build the week around it rather than overwriting it with a generic session.`);
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
  const matchers: Partial<Record<SeasonFocus, { label: string; match: (d: PlannedDay) => boolean }>> = {
    vo2max: { label: "VO2max", match: (d) => d.type === "VO2max" },
    threshold: { label: "Threshold", match: (d) => d.type === "Threshold" },
    anaerobic: { label: "SIT (anaerobic)", match: (d) => d.type === "SIT" },
    durability: {
      label: "durability-loaded Z2 (embedded threshold+ work)",
      match: (d) => (d.type === "Z2" || d.type === "Recovery") && carriesEmbeddedIntensity(d.workoutText, ftp),
    },
  };
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
