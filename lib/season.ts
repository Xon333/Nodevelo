// Macro periodization engine (MACRO-1..3). Pure + deterministic: drafts a rough, rolling season arc of
// limiter-focus periods, grounded in the knowledge base. The LLM only phrases FocusPeriod.rationale.
import type { FocusPeriod, PlannedDay, SeasonEvent, SeasonFocus, SeasonPhase, SeasonPlan } from "./types";
import { DEFAULT_ACWR_BANDS } from "./calibration";
import { tagPresent } from "./session-requirements";

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
  const haystack = (goalText ?? "").toLowerCase();
  if (!haystack.trim()) return 0.5;
  const fired = GOAL_PATTERNS.filter((p) => tagPresent(haystack, p.re));
  if (fired.length === 0) return 0.5;
  return Math.max(...fired.map((p) => p.weights[focus] ?? 0));
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
}

const BUILD_FOCI: SeasonFocus[] = ["threshold", "vo2max", "anaerobic", "durability"];

// KB: "base is non-negotiable." Lead with a base touch when the recent window carries none.
export function needsBaseGate(recentFocuses: SeasonFocus[]): boolean {
  return !recentFocuses.slice(-4).includes("aerobic-base");
}

// Weakest system first when confident; else a least-recently-used rotation over BUILD_FOCI (KB variety).
// Never repeats the last focus — the last focus is by definition the most recently used candidate.
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  const wanted =
    limiter.system && limiter.confidence !== "low" && BUILD_FOCI.includes(limiter.system)
      ? limiter.system
      : null;
  if (wanted && wanted !== last) return wanted;
  // LRU fallback: the candidate that appeared furthest back in recentFocuses wins (lastIndexOf === -1,
  // i.e. never appeared, wins outright). Ties break by defaultBuildOrder()'s stable order; anaerobic
  // (absent from the default order) sorts last among ties, so it surfaces only via genuine staleness,
  // never as a tiebreak default. This replaces the old first-non-last scan over defaultBuildOrder(),
  // which locked a confident limiter into a permanent two-focus alternation (anaerobic → threshold →
  // anaerobic → ...) and starved vo2max/durability forever.
  const order = defaultBuildOrder();
  const tiebreak = (f: SeasonFocus): number => {
    const i = order.indexOf(f);
    return i === -1 ? order.length : i;
  };
  return [...BUILD_FOCI].sort(
    (a, b) => recentFocuses.lastIndexOf(a) - recentFocuses.lastIndexOf(b) || tiebreak(a) - tiebreak(b)
  )[0];
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
  let cursor = today;
  const conf = input.limiter.confidence;

  if (needsBaseGate(recent)) {
    periods.push(period("aerobic-base", "base", cursor, conf, "Aerobic base — the ceiling for every later phase (KB)."));
    recent.push("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    const focus = nextBuildFocus(input.limiter, recent);
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  periods.push(period("sharpen", "build", cursor, conf, "Realize — a lighter week to absorb the block and re-test."));
  const withDeloads = applyDeloadCadence(periods, input.heavyFatigue);
  const seed = input.ftp !== null && input.ctl !== null ? input.recentWeeklyTss : null;
  return assignLoadTargets(withDeloads, seed, DEFAULT_ACWR_BANDS.optimalHigh);
}

// Ramps each period's targetWeeklyTss ~+loadRampPct% off the prior period (first period off seedWeeklyTss).
// targetWeeklyTss is the period's LOADING-week target: every period advances the ramp — deloadWeek does
// NOT dampen it. The flag means "this period's TRAILING week is lighter", and that lighter week is sized
// downstream (BlockSettings.recoveryWeekHoursMin/Max in the block generator + formatSeasonContext's
// "deload week" prompt phrase), never by this envelope. (The old 0.6x/frozen-base branch here collided
// with applyDeloadCadence flagging every 3-4-week period, flattening whole seasons to ~0.6x seed and
// making the unflagged sharpen week the heaviest of the season.)
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
    const target = Math.min(Math.round(prev * ramp), Math.round(ceiling));
    prev = target;
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
    const order = [...defaultBuildOrder()];
    let i = 0;
    while (filled < runway) {
      const focus = order[i % order.length];
      const w = Math.min(SEASON_CONSTANTS.weeks[focus], runway - filled);
      if (w <= 0) break;
      tail.unshift(mk(focus, "build", w, `Build ${focus} toward ${event.name}.`));
      filled += w; i += 1;
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
  const derived = draftSeasonArc({ ...input, recentFocuses }, draftStart);
  const periods = [...frozen, ...current, ...overrides, ...derived].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}

// Mark the period that crosses each deload boundary (30–50% volume cut lands in its trailing week).
// Boundary fires when cumulative loading weeks reach (every - 1), i.e. after 3 loading weeks for 3:1,
// after 2 loading weeks for 2:1 (tight).
export function applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  const threshold = every - 1; // loading weeks before the deload period
  let weeksSinceDeload = 0;
  return periods.map((p) => {
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= threshold) {
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
      const deload = p.deloadWeek ? " · deload week" : "";
      return `- ${wks} (${from} → ${to}): phase ${p.phase} · focus ${p.focus} · ${p.intensitySplit} split${load}${deload}. ${p.rationale}`;
    });
    return `SEASON CONTEXT: ${objective}this block spans ${spanned.length} season periods — plan each week to match its own period, shifting phase/intensity at the boundaries:\n${segments.join("\n")}`;
  }
  const p = spanned[0] ?? currentPeriod(plan, today);
  if (!p) return null;
  const wk = Math.max(1, weeksBetween(p.startDate, today) + 1);
  const load = p.targetWeeklyTss != null ? ` · target ~${p.targetWeeklyTss} TSS/wk` : "";
  const deload = p.deloadWeek ? " · deload week" : "";
  return `SEASON CONTEXT: ${objective}phase ${p.phase} · focus ${p.focus} · wk ${wk} of ${p.plannedWeeks}${load}${deload}. ${p.rationale}`;
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
    if (p.phase === "base" && hardShare > 0.2) {
      const dates = rides.map((d) => d.date).sort();
      warnings.push(
        `Season fit: ${dates[0]} → ${dates[dates.length - 1]} sits in a base/aerobic period (${p.intensitySplit}), but ${Math.round(hardShare * 100)}% of riding time is hard — expected mostly Z2.`
      );
    }
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
