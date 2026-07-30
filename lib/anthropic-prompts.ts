// Pure prompt assembly for the Anthropic calls — no SDK, no network, no API key. Every export here is
// deterministic string-building from already-computed numbers, so it's cheap to unit-test and the LLM
// call layer (anthropic-api.ts) stays a thin shell over the SDK (RV-8: this file was ~400 lines tangled
// into the client). The call layer imports these builders and re-exports the public ones, so callers
// can keep importing from "@/lib/anthropic-api" unchanged.
import type {
  ActivitySummary,
  AthleteProfile,
  BlockParams,
  BlockSettings,
  IntervalComparison,
  PowerPR,
  SyncData,
} from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";
import { formatBlockSkeleton, formatWeekTargets, type BlockSkeleton, type WeekTarget } from "./block-skeleton";
import { weightTrendFromWellness } from "./nutrition";
import { formatCoachSnapshot, type CoachSnapshot } from "./coach-snapshot";
import { prDurationLabel } from "./pr";
import { isSteadyEnduranceRide } from "./trends";
import type { AerobicDiscipline } from "./execution-score";
import { round1 } from "./stats";
import { AEROBIC_DEADBAND_PCT } from "./aerobic";

// ---------- date helpers ----------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekday(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Every calendar date of the block, grouped per week.
export function blockDates(startDate: string, lengthWeeks: number): string[][] {
  return Array.from({ length: lengthWeeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(startDate, week * 7 + day))
  );
}

// Distilled from the official Intervals.icu workout builder syntax guide so
// generated workouts parse correctly when written to the calendar.
const WORKOUT_SYNTAX_GUIDE = `INTERVALS.ICU WORKOUT SYNTAX (use exactly this format in WORKOUT sections):
- Every step is a line starting with "- ", followed by a duration and a power target as %FTP.
  Durations: 30s, 10m, 1h, 1h30m. Targets: single "65%" or range "95-105%". Optional cadence: "90rpm".
  Example: - 12m 95%
- Ramps: - 15m ramp 50-70%
- Repeats: put "Main Set 4x" (or just "4x") on its own line, then the steps to repeat below it.
  Leave one empty line BEFORE and AFTER every repeat block. Nested repeats are not supported.
- Plain-text lines without a leading "- " (e.g. "Warmup", "Cooldown") are section labels and are allowed.
- Free text before the duration inside a step becomes an on-screen cue: - Settle in 10m 60%
- Open-ended steps: the phrase "Press lap" anywhere in a step's text makes the step end only when
  the athlete presses the device's lap button instead of on the timer (works on Garmin/Suunto head
  units synced via Garmin Connect — everywhere else the stated duration governs as normal). Still
  give a realistic duration; it is used for estimated time and load either way.
  Example: - Press lap when ready 20m 50%
  Use ONLY for outdoor positioning or readiness steps (e.g. "ride to the base of the climb, then
  press lap", or a "warm up until legs feel ready" segment). NEVER on a prescribed work interval —
  SIT/VO2max/Threshold protocol validation depends on the stated duration being real — and NEVER
  in indoor/ERG sessions (device-dependent; does not apply indoors).
Full example:

Warmup
- 15m ramp 50-70%

Main Set 3x
- 12m 95%
- 4m 55%

Cooldown
- 10m 50%`;

// ---------- Athlete current data (from last-sync.json) ----------

function formatDuration(sec: number): string {
  return (sec / 3600).toFixed(1);
}

const POWER_CURVE_LABELS: Record<number, string> = {
  5: "5s",
  15: "15s",
  30: "30s",
  60: "1min",
  120: "2min",
  300: "5min",
  1200: "20min",
  1800: "30min",
  3600: "60min",
};

function weightTrend14d(sync: SyncData): number | null {
  const weighIns = sync.wellness
    .filter((w): w is typeof w & { weightKg: number } => w.weightKg !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length < 2) return null;
  const latest = weighIns[weighIns.length - 1];
  const latestMs = Date.parse(latest.date);
  const reference = weighIns
    .slice(0, -1)
    .filter((w) => {
      const daysBack = (latestMs - Date.parse(w.date)) / 86_400_000;
      return daysBack >= 11 && daysBack <= 17;
    })
    .pop();
  if (!reference) return null;
  return Math.round((latest.weightKg - reference.weightKg) * 10) / 10;
}

export function buildAthleteDataSection(
  profile: AthleteProfile,
  sync: SyncData | null,
  zonesText?: string
): string {
  const p = profile.performance;
  const lines: string[] = [
    "ATHLETE CURRENT DATA",
    "",
    `Profile: FTP ${p.ftp} W, Max HR ${p.maxHr} bpm, Threshold HR ${p.thresholdHr} bpm, weight ${p.weightKg} kg (target ${profile.nutrition.targetWeightKg} kg).`,
    `Weekly training availability: ${p.weeklyHoursMin}-${p.weeklyHoursMax} hours. The plan MUST fit inside this.`,
  ];
  // Live training zones from the physiology store (synced from Intervals.icu), so workout
  // power targets are calibrated to the athlete's current FTP/zone boundaries.
  if (zonesText && zonesText.trim() !== "") {
    lines.push("", zonesText.trim());
  }

  if (!sync) {
    lines.push(
      "",
      "No synced Intervals.icu data is available yet. Plan conservatively from the profile above."
    );
    return lines.join("\n");
  }

  // The sync cache now holds ~6 months for trends, but the prompt's "current form" summary
  // should stay recent — restrict it to the last 8 weeks so the weekly average and intensity
  // mix reflect what the athlete is doing now, not a six-month blend.
  const recentCutoff = addDays(new Date().toISOString().slice(0, 10), -56);
  const recent = sync.activities.filter((a) => a.date >= recentCutoff);

  // 8-week summary
  const totalHours = recent.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  lines.push(
    "",
    `Last 8 weeks: ${recent.length} activities, ${totalHours.toFixed(1)} h total (${(totalHours / 8).toFixed(1)} h/week average).`
  );

  // Intensity distribution proxy from average power vs FTP.
  let easy = 0;
  let moderate = 0;
  let hard = 0;
  for (const a of recent) {
    if (a.avgWatts === null || p.ftp <= 0) continue;
    const intensity = a.avgWatts / p.ftp;
    const h = a.movingTimeSec / 3600;
    if (intensity < 0.6) easy += h;
    else if (intensity < 0.8) moderate += h;
    else hard += h;
  }
  const classified = easy + moderate + hard;
  if (classified > 0) {
    lines.push(
      `Intensity distribution (by avg power): ${Math.round((easy / classified) * 100)}% easy (<0.6 IF), ${Math.round((moderate / classified) * 100)}% moderate (0.6-0.8 IF), ${Math.round((hard / classified) * 100)}% hard (>0.8 IF).`
    );
  }

  const keySessions = [...recent]
    .filter((a) => a.trainingLoad !== null)
    .sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))
    .slice(0, 3);
  if (keySessions.length > 0) {
    lines.push(
      "Key recent sessions: " +
        keySessions
          .map((a) => `${a.date} ${a.name} (${formatDuration(a.movingTimeSec)} h, load ${a.trainingLoad})`)
          .join("; ") +
        "."
    );
  }

  if (sync.powerCurve.length > 0) {
    lines.push(
      "",
      "Recent power curve (84-day best efforts): " +
        sync.powerCurve
          .map((pt) => `${POWER_CURVE_LABELS[pt.durationSec] ?? `${pt.durationSec}s`} ${pt.watts} W`)
          .join(", ") +
        "."
    );
  }

  const f = sync.fitness;
  if (f.ctl !== null) {
    lines.push("", `Current fitness: CTL ${f.ctl}, ATL ${f.atl}, TSB (form) ${f.tsb}.`);
  }

  const trend14 = weightTrend14d(sync);
  const trend7 = weightTrendFromWellness(sync.wellness);
  const recentWellness = [...sync.wellness].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const sleeps = recentWellness.map((w) => w.sleepHours).filter((s): s is number => s !== null);
  const avgSleep = sleeps.length > 0 ? (sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1) : null;
  const cutoff14 = addDays(new Date().toISOString().slice(0, 10), -14);
  const rpes = sync.activities
    .filter((a) => a.date >= cutoff14 && a.rpe !== null)
    .map((a) => a.rpe as number);
  const avgRpe = rpes.length > 0 ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : null;

  const wellnessBits: string[] = [];
  if (trend14 !== null) wellnessBits.push(`weight ${trend14 > 0 ? "+" : ""}${trend14} kg over 14 days`);
  if (trend7 !== null) wellnessBits.push(`${trend7 > 0 ? "+" : ""}${trend7} kg over 7 days`);
  if (avgSleep !== null) wellnessBits.push(`average sleep ${avgSleep} h`);
  if (avgRpe !== null) wellnessBits.push(`average session RPE ${avgRpe}/10 (last 14 days)`);
  if (wellnessBits.length > 0) lines.push(`Wellness trend: ${wellnessBits.join(", ")}.`);

  return lines.join("\n");
}

// ---------- Prompt assembly (structure per spec F2) ----------

export function buildSystemPrompt(
  kbReference: string, // stable reference KB — the cacheable bulk (persona + syntax + KB below)
  dynamicContext: string, // carry-forward seeds + synthesised directives — change every block
  athleteDataSection: string,
  blockParams: BlockParams
): { cached: string; dynamic: string } {
  // `cached` is the stable prefix; everything that changes per block (seeds, directives, the
  // athlete's live data + params) goes in `dynamic`, AFTER the cache breakpoint, so it never
  // invalidates the cached prefix. The caller marks `cached` with cache_control.
  const cached = `You are an expert cycling coach who designs structured training blocks. You output training blocks ONLY, in exactly the format the user requests — no preamble, no commentary, no markdown formatting beyond the requested structure. You ground every coaching decision in the knowledge base provided below and in the athlete's current data. You never invent nutrition numbers: you copy the pre-computed values supplied in the user's nutrition reference table.

${WORKOUT_SYNTAX_GUIDE}

KNOWLEDGE BASE CONTEXT

${kbReference}`;

  const dynamic = `${dynamicContext.trim() ? `${dynamicContext.trim()}\n\n` : ""}${athleteDataSection}

BLOCK PARAMETERS

- Block length: ${blockParams.lengthWeeks} weeks
- Block goal: ${blockParams.goal}
- Weakpoints to target this block: ${blockParams.weakpoints.length > 0 ? blockParams.weakpoints.join("; ") : "(none specified)"}`;

  return { cached, dynamic };
}

// AI: the interval-protocol bands below are one of three hand-synced copies (KB prose +
// here + workout-validate.ts's PROTOCOL table) -- see docs/INVARIANTS.md#ai-provenance--cost
// item 17. Changing a protocol number here without changing the other two is a bug, not a fix.
export function buildUserMessage(
  blockParams: BlockParams,
  weeks: string[][],
  nutritionTableMd: string,
  settings: BlockSettings = DEFAULT_BLOCK_SETTINGS,
  weekTargets?: WeekTarget[],
  skeleton?: BlockSkeleton
): string {
  // Phase B task 4: the per-day skeleton (when supplied) supersedes the single weekly hour figure —
  // it owns composition (which day, which type, which duration, which intensity ceiling), so
  // formatWeekTargets stays only as the fallback for the ~15 existing callers that haven't computed
  // one yet (and formatWeekTargets(weekTargets) unconditionally otherwise, same as before).
  const volumeSection = skeleton
    ? formatBlockSkeleton(skeleton)
    : weekTargets && weekTargets.length > 0
      ? formatWeekTargets(weekTargets)
      : "";
  const calendar = weeks
    .map(
      (dates, i) =>
        `Week ${i + 1}: ${dates.map((d) => `${d} (${weekday(d)})`).join(", ")}`
    )
    .join("\n");

  return `Generate a ${blockParams.lengthWeeks}-week training block for the athlete described above.

The block runs on these exact dates — output exactly one DAY entry per date, in order:
${calendar}

Output format — strictly follow this structure. Build every WEEK/DAY first; write BLOCK OVERVIEW
LAST, once every day below it is decided, so it accurately summarises the block you actually built
rather than a plan you intend to build (a narrative written before the schedule exists is how a
block ends up promising something — e.g. "escalates X" — that its own days don't deliver):

WEEK [N]: [Week theme]
DAY [date]: [Session name]
  TYPE: [Workout type: Z2 / Threshold / VO2max / SIT / RaceSim / Recovery / Strength / Rest]
  DURATION: [minutes]
  WORKOUT: [Intervals.icu workout syntax per the syntax guide; for Rest days write "Rest"]
  DESCRIPTION: [Nutrition and intent description — see format below]

[Repeat for every day of the block]

BLOCK OVERVIEW (write this LAST)
[2-3 sentence summary of the block's training approach and rationale — describe what the weeks
above actually contain, not an aspiration]

DESCRIPTION FORMAT for each workout:
  Intent: [1 sentence on the physiological goal of this session]
  Execution: [Optional — one short pacing or technique cue for THIS session/terrain when it adds value (see execution-cue rule). Omit entirely when nothing useful applies.]
  Pre-ride: [Carbohydrate grams from the reference table]
  In-ride: [Carbohydrate grams/hr from the reference table, only for rides > 60 min]
  Daily intake: [Total kcal for the day, copied from the reference table]

NUTRITION REFERENCE TABLE (pre-computed by the app's deterministic formula — copy these values, never calculate your own; pick the row matching the session's type and closest duration):

${nutritionTableMd}

${volumeSection ? `${volumeSection}\n\n` : ""}Hard rules:
- Use ISO dates (YYYY-MM-DD) in every DAY line, exactly as listed above.
- DURATION is an integer number of minutes.
- TYPE must be one of: Z2, Threshold, VO2max, SIT, RaceSim, Recovery, Strength, Rest.
- **Interval protocols — match the knowledge base exactly:** SIT = 4–6 × 20–30s ALL-OUT efforts (maximal, 130–200% FTP) with 4 min easy recovery — never prescribe SIT as 1-minute or sub-130% efforts, and state the effort as "all-out / maximal" in the DESCRIPTION intent. VO2max = 3–8 min efforts at 106–120% FTP. Threshold = 88–105% FTP (sweet-spot 88–93%). Do not push a Threshold session above 105% or a VO2max session above 120%.
- **RaceSim (KB §10) — a peaking/sharpening session, not a base-week one, and not a repeated fixed ladder:** a real race is decided by variable, escalating efforts, not evenly-spaced identical intervals — riders don't do hill repeats in a race. Prescribe 3–5 "race moves" (2–4 min climbs/efforts at 100–115% with a 20–45s standing attack layered on), but: (1) vary EVERY move's duration, intensity, AND recovery gap — no two moves may share the same numbers, and the recovery between moves must itself vary (2–6 min), never one fixed repeated gap; (2) put the single hardest move — closest to the session's ceiling — in the LAST THIRD of the main set, not spread evenly across it: real selections happen on legs already deep in fatigue, not fresh at the start; (3) if the DESCRIPTION claims progressive/escalating intensity, the prescribed numbers must actually rise to match that claim — never describe a session as "progressively harder" while a later effort is weaker than an earlier one. Optional finishing sprint (15–25s all-out). Whole-session IF ~0.80–0.88. Use it in the back half of a build / event lead-in, as one of the week's quality sessions. Best fit for this athlete's hilly-KOM goals.
- **Athlete-directed / terrain-flexible sessions (KB §11):** for outdoor quality you may prescribe a structured-but-flexible session instead of a fixed ladder — state target efforts as ranges (count · duration band · intensity band, e.g. "2–3 × ≥5 min @ threshold"), a placement rule ("on any sustained climb"), and a strict Z2 + HR-cap floor for the rest. Keep at least one fixed/ERG quality session per week as the controlled benchmark.
- **Execution cues (DESCRIPTION "Execution" line — one short clause, only when it genuinely helps):** ground every cue in *this* athlete's listed weakpoints, their rider profile + auto-identified easy win (above), the session type, and the terrain — apply the principle, don't recite a fixed script for a rider it doesn't fit:
  - **Pacing discipline:** when grey-zone / aerobic drift is a weakpoint, govern long endurance Z2 by the HR ceiling (top of Z2), not just watts — let power drift up briefly on climbs but keep HR capped, and ease on descents instead of surging (amateurs surge climbs and coast descents — the opposite of optimal).
  - **Technique skills (only when a matching weakpoint or easy win exists):** turn the relevant terrain into deliberate practice — e.g. descents → line choice + braking when descending/cornering is flagged; the auto-identified easy win → one light weekly touch of that energy system, unless the goal points elsewhere.
  - **Position by effort type:** SIT efforts stay seated (standing recruits upper body, less consistent power for the 30s aerobic efforts). **Standing sprints** are a separate skill (KB) — cue them only on dedicated neuromuscular / race-sprint work or RaceSim attacks (hands in drops, quiet torso, bigger gear), and only when out-of-saddle power is a flagged weakpoint.
  Omit the Execution line for Rest days and whenever no cue adds value; never repeat the Intent.
  Keep every cue as concise *inline* coaching (a clause the athlete acts on mid-ride) — **never**
  tell them to watch a video, read an article, or include any external link/URL.
- **Workout step durations must sum to DURATION — no hedging.** Add up every warmup + main + cooldown step before finalising a session; if they don't match, adjust the steps (never just the stated number) so Intervals.icu's own parsed ride time (which is what actually shows on the athlete's calendar) matches what you tell them the session costs.
- **WEEKLY VOLUME:** see ${skeleton ? "WEEK SKELETON" : "WEEK-BY-WEEK HOUR TARGETS"} above — an exact figure per week, not a range.${weekTargets && weekTargets.length > 0 ? "" : ` (fallback, no per-week targets supplied) every loading week must total ${settings.weeklyHoursMin}–${settings.weeklyHoursMax} hours — plan toward the TOP of that range; recovery weeks reduce to ${settings.recoveryWeekHoursMin}–${settings.recoveryWeekHoursMax} hours.`}
- **WEEKLY STRUCTURE:** ${skeleton
    ? "see WEEK SKELETON above — it is the authority on which day carries which session type, how long it is, and its intensity ceiling. Do not deviate from it."
    : `${settings.qualitySessionsPerLoadingWeek} quality sessions (Threshold/VO2max/SIT/RaceSim COMBINED — RaceSim counts toward this total like every other quality type, and this number is a CEILING, never a target to exceed) + 1 long ${settings.polarisedApproach ? "Z2" : "Z2/sweet-spot"} ride (≥${settings.longRideDurationMinutes} min) + 2–3 easy Z2 sessions (60 min minimum each — size them UP, typically 90–120 min, until the week's total hits its WEEK-BY-WEEK HOUR TARGET) + ${settings.restDaysPerWeek} rest day${settings.restDaysPerWeek !== 1 ? "s" : ""} per week. **Never place two quality sessions on consecutive calendar days, and never let a week's quality-session count exceed the number above** — before finalising each week, count its Threshold/VO2max/SIT/RaceSim days and check no two land back-to-back; if either check fails, fix it by moving/dropping a session, not by re-labelling it.`
  }${settings.polarisedApproach ? "\n- **Polarised structure:** Keep easy sessions genuinely easy (<0.75 IF). Avoid grey-zone moderate riding." : "\n- **Sweet spot structure:** Include sweet spot intervals (88–93% FTP) in addition to threshold work."}
- **Rest days:** TYPE: Rest, DURATION: 0, WORKOUT: Rest, description with Intent and Daily target only. Limit to ${settings.restDaysPerWeek} per week.
- **Within-week sequencing (P5):** when a week has both a freshness-dependent quality session (VO2max, SIT — the stimulus needs genuinely fresh legs) and a fatigue-tolerant one (Threshold — trainable on some accumulated fatigue; RaceSim, whose hardest move belongs late on already-tired legs), place the freshness-dependent one EARLIER in the week. Do not default to Threshold on the week's freshest day and SIT/VO2max later — that's backwards.
- Do not add any content outside WEEK/DAY entries and the final BLOCK OVERVIEW.`;
}

// ---------- Today's ride analysis ----------

export interface RideAnalysisInput {
  activityDate: string;
  activityName: string;
  activityType: string;
  activityDurationMin: number;
  activityAvgWatts: number | null;
  activityNormalizedPower: number | null;
  activityMaxWatts: number | null;
  activityAvgHr: number | null;
  activityMaxHr: number | null;
  activityKj: number | null;
  activityTrainingLoad: number | null;
  activityRpe: number | null;
  activityDecoupling: number | null;
  activityDescription: string | null;
  avgCadence: number | null;
  distanceMeters: number | null;
  elevationGain: number | null;
  powerZoneTimes: number[] | null;
  hrZoneTimes: number[] | null;
  intervalComparison: IntervalComparison | null;
  powerPRs?: PowerPR[]; // new power bests set during this ride — so the coach can acknowledge them
  plannedName: string | null;
  plannedType: string | null;
  plannedDurationMin: number | null;
  plannedWorkoutText: string | null;
  athleteFtp: number;
  athleteThresholdHr: number;
  // Pre-formatted, one-line context from the deterministic fuel prompt (lib/fuel-prompt.ts) — the
  // numbers are already computed; the model may mention this in one sentence but must never
  // invent or recompute the figures. Absent (null) when no fuel prompt fired today.
  fuelPromptContext?: string | null;
  // The HR-judged easy-ride discipline read (TodayAnalysis.aerobicDiscipline) — set only on prescribed
  // Z2/Recovery days where the scorer applied it. When present, the prompt instructs the model to judge
  // "was this easy?" on THIS, not power-zone spread: outdoor watts spike on terrain even on a perfectly
  // easy ride, so a power-based "zone creep" narrative is the same terrain-confound the scoring rework
  // (2026-07-11) removed. Absent/null on interval days, off-plan rides, and durability templates B–E.
  aerobicDiscipline?: AerobicDiscipline | null;
  // The aerobic-efficiency-vs-baseline figure behind the discipline read above (signed %Δ vs the
  // athlete's own trailing Z2 Pw:HR baseline; negative = below baseline). Same gate as
  // aerobicDiscipline, same source: TodayAnalysis.aerobicEffPct (lib/aerobic.ts).
  aerobicEffPct?: number | null;
}

function fmtIntervals(c: IntervalComparison | null): string | null {
  if (!c || c.reps.length === 0) return null;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  // Include BOTH power and duration per rep — a rep at target watts but cut short is not a
  // full rep, and the coach note must reflect that rather than calling it textbook.
  const execs = c.reps
    .map(
      (r) =>
        `${r.actualWatts}W/${r.adherencePct}% power, ${mmss(r.durationSec)} of ${mmss(r.targetDurationSec)}/${r.durationPct}% duration`
    )
    .join("; ");
  const mismatchNote = c.structuralMismatch
    ? " NOTE: executed rep durations differ consistently from the plan's definition while power was on target — treat this as a plan/detection mismatch, not a failed session; judge on power and overall execution, not rep duration."
    : "";
  return `Intervals: prescribed ${c.prescribedLabels.join(" + ")} → executed ${execs}. ${c.completed}/${c.total} reps held full duration; avg ${c.avgAdherencePct}% power, ${c.avgDurationPct}% duration.${mismatchNote}`;
}

function fmtZones(times: number[], prefix: string): string | null {
  const total = times.reduce((s, t) => s + t, 0);
  if (total === 0) return null;
  const parts = times
    .map((t, i) => ({ z: i + 1, pct: Math.round((t / total) * 100) }))
    .filter((z) => z.pct >= 1)
    .map((z) => `Z${z.z} ${z.pct}%`);
  return parts.length > 0 ? `${prefix}: ${parts.join(" · ")}` : null;
}

// The full ride-analysis prompt from the deterministic, already-computed inputs. Pure + unit-testable;
// analyseRide() just sends this to the model.
export function buildRideAnalysisPrompt(input: RideAnalysisInput): string {
  const planned = input.plannedName
    ? `Planned: ${input.plannedType} — "${input.plannedName}" (${input.plannedDurationMin} min)`
    : "No session planned today.";

  // Header: name, type, duration, distance, elevation
  const dist = input.distanceMeters ? ` · ${(input.distanceMeters / 1000).toFixed(1)} km` : "";
  const elev = input.elevationGain ? ` · +${Math.round(input.elevationGain)}m` : "";
  const typeLabel = input.activityType !== "Ride" ? ` (${input.activityType})` : "";
  const header = `Actual: "${input.activityName}"${typeLabel} — ${input.activityDurationMin} min${dist}${elev}`;

  // Power line
  let powerLine: string | null = null;
  if (input.activityAvgWatts !== null) {
    const np = input.activityNormalizedPower ?? Math.round(input.activityAvgWatts * 1.05);
    // IF is NP/FTP (fall back to raw avg when NP is absent) — same basis as the Today card and
    // score-log, so the note's IF can't disagree with what the athlete sees on the card (MR-1).
    const ifBasis = input.activityNormalizedPower ?? input.activityAvgWatts;
    const ifVal = input.athleteFtp > 0 ? (ifBasis / input.athleteFtp).toFixed(2) : "—";
    const maxW = input.activityMaxWatts ? ` · Max ${input.activityMaxWatts}W` : "";
    // Only present on steady rides (gated in buildRideAnalysisInput) — there it's a durability/aerobic-fade
    // read; on interval days whole-ride decoupling is a ride-structure artifact, so it's omitted entirely.
    const dec = input.activityDecoupling != null ? ` · Pw:HR drift ${input.activityDecoupling.toFixed(1)}% (durability)` : "";
    const npLabel = input.activityNormalizedPower ? "NP" : "NP ~";
    powerLine = `Power:  Avg ${input.activityAvgWatts}W · ${npLabel} ${np}W · IF ${ifVal}${maxW}${dec}`;
  }

  // HR line
  let hrLine: string | null = null;
  if (input.activityAvgHr !== null) {
    const maxHr = input.activityMaxHr ? ` · Max ${input.activityMaxHr} bpm` : "";
    hrLine = `HR:     Avg ${input.activityAvgHr} bpm${maxHr} (threshold ${input.athleteThresholdHr} bpm)`;
  }

  // Effort line
  const effortParts: string[] = [];
  if (input.activityTrainingLoad !== null) effortParts.push(`TSS ${input.activityTrainingLoad}`);
  if (input.activityRpe !== null) effortParts.push(`RPE ${input.activityRpe}/10`);
  if (input.avgCadence !== null) effortParts.push(`Cadence ${Math.round(input.avgCadence)} rpm`);
  const effortLine = effortParts.length > 0 ? `Effort: ${effortParts.join(" · ")}` : null;

  // Interval adherence (the primary, power-centric comparison) + zone distributions
  const intervalLine = fmtIntervals(input.intervalComparison);
  const powerZoneLine = input.powerZoneTimes ? fmtZones(input.powerZoneTimes, "Power zones") : null;
  const hrZoneLine = input.hrZoneTimes ? fmtZones(input.hrZoneTimes, "HR zones") : null;
  // Power PRs set during this ride — surfaced so the coach recognises the breakthrough.
  const prLine =
    input.powerPRs && input.powerPRs.length > 0
      ? `New power PRs (84-day best): ${input.powerPRs
          .map((pr) => `${prDurationLabel(pr.durationSec)} ${pr.watts}W (was ${pr.prevWatts}W)`)
          .join(", ")}`
      : null;

  const athleteNote = input.activityDescription?.trim()
    ? `Athlete note: "${input.activityDescription.trim().slice(0, 400)}"`
    : null;

  // Deterministic fuel-prompt context (lib/fuel-prompt.ts) — a pre-computed, one-line nudge or gap
  // read the model may mention, never recompute. Pre-formatted by the caller; passed through verbatim.
  const fuelPromptLine = input.fuelPromptContext?.trim() ? input.fuelPromptContext.trim() : null;

  // HR-judged easy-ride discipline (2026-07-11 scoring rework, LLM surface). Only present on prescribed
  // Z2/Recovery days where the scorer applied the read — there, the HEART is the judge of "was it easy",
  // and the model must not re-derive a power-based "zone creep" verdict the scoring just rejected.
  const disciplineLabel: Record<AerobicDiscipline, string> = {
    dialed: "dialed in — HR stayed aerobic (within the easy ceiling)",
    drift: "some drift — a few efforts crept above the aerobic ceiling",
    hot: "ran hot — HR sat above the aerobic ceiling for a large share of the ride; it genuinely wasn't an easy ride, and its real training load (not the plan's easy-day load) is what the fatigue model reads, so that extra cost is already counted against freshness",
  };
  // Append the efficiency figure only when it's a notable read (matches AEROBIC_DEADBAND_PCT, the
  // same weak-band threshold the off-plan scoring axis uses) — a small, noisy delta adds no signal.
  const disciplineLine = input.aerobicDiscipline
    ? `Easy-ride discipline (HR-judged): ${disciplineLabel[input.aerobicDiscipline]}${
        input.aerobicEffPct != null && input.aerobicEffPct <= -AEROBIC_DEADBAND_PCT
          ? ` · aerobic efficiency ${round1(input.aerobicEffPct)}% below your 90-day baseline`
          : ""
      }`
    : null;
  const disciplineInstruction = disciplineLine
    ? " This was a prescribed easy day: judge \"was it actually easy\" ONLY by the HR-judged discipline line — do not judge easy-ride discipline from the power-zone distribution or call power spread \"zone creep\": outdoor watts spike on descents, rollers, restarts and corners even on a perfectly ridden easy ride, and the execution score already accounts for this."
    : "";

  return [
    "You are a cycling coach. Review today's ride vs the plan in 2–3 sentences. Power is the primary lens: if interval adherence is given, judge execution on BOTH the power hit AND whether each rep held its prescribed duration — a rep at target watts but cut short is NOT full execution, so don't call it textbook. Use HR — and, when a Pw:HR drift figure is shown (steady rides only), aerobic durability/fade — to judge aerobic quality; do not infer decoupling on interval days." + disciplineInstruction + " Be direct: execution quality, any notable deviation, and one concrete takeaway for next session. If a new power PR is listed, call it out as a breakthrough first — it's a genuine fitness signal worth recognising. If the athlete left a note, factor it in. If a FUEL PROMPT line is given, you may mention it in one sentence — use its numbers verbatim, never invent or recompute them. No greeting, no fluff, and do not restate the prescription verbatim.",
    "",
    planned,
    header,
    prLine,
    intervalLine,
    powerLine,
    hrLine,
    effortLine,
    powerZoneLine,
    hrZoneLine,
    disciplineLine,
    athleteNote,
    fuelPromptLine,
  ].filter(Boolean).join("\n");
}

export function buildRideAnalysisInput(
  activity: ActivitySummary,
  planned: { name: string; type: string; durationMin: number; workoutText?: string } | null,
  athleteFtp: number,
  athleteThresholdHr: number
): RideAnalysisInput {
  return {
    activityDate: activity.date,
    activityName: activity.name,
    activityType: activity.type,
    activityDurationMin: Math.round(activity.movingTimeSec / 60),
    activityAvgWatts: activity.avgWatts,
    activityNormalizedPower: activity.normalizedPower,
    activityMaxWatts: activity.maxWatts,
    activityAvgHr: activity.avgHr,
    activityMaxHr: activity.maxHr,
    activityKj: activity.kj,
    activityTrainingLoad: activity.trainingLoad,
    activityRpe: activity.rpe,
    // Decoupling is a steady-ride DURABILITY signal only (ACC-2026-06-25): on an interval day the
    // whole-ride figure is a ride-structure artifact, so the coach note never sees it there.
    activityDecoupling: isSteadyEnduranceRide(activity, athleteFtp) ? activity.decoupling : null,
    activityDescription: activity.description,
    avgCadence: activity.avgCadence,
    distanceMeters: activity.distanceMeters,
    elevationGain: activity.elevationGain,
    powerZoneTimes: activity.powerZoneTimes,
    hrZoneTimes: activity.hrZoneTimes,
    intervalComparison: null, // set by the sync route after fetching Intervals' intervals
    plannedName: planned?.name ?? null,
    plannedType: planned?.type ?? null,
    plannedDurationMin: planned?.durationMin ?? null,
    plannedWorkoutText: planned?.workoutText ?? null,
    athleteFtp,
    athleteThresholdHr,
  };
}

// ---------- Block retrospective ----------

export interface RetrospectiveInput {
  goal: string;
  lengthWeeks: number;
  startDate: string;
  endDate: string;
  plannedHours: number;
  actualHours: number;
  overallCompliancePct: number;
  ctlStart: number | null;
  ctlEnd: number | null;
  complianceByType: Record<string, number>;
  topSessions: Array<{ date: string; name: string; tss: number }>;
  avgDecoupling: number | null;
  // Rider power-profile context (curve shape: rider type + relative-strength systems + easy-win weak
  // point), pre-formatted by lib/power-profile.formatPowerProfileForPrompt. Empty string when the curve
  // is too thin to say anything — the prompt then omits the section. (ROADMAP Track A.)
  powerProfile?: string;
}

// The prose-retrospective prompt. Pure; generateRetrospective() sends it to the model.
export function buildRetrospectivePrompt(input: RetrospectiveInput): string {
  const ctlLine =
    input.ctlStart !== null && input.ctlEnd !== null
      ? `CTL: ${input.ctlStart} → ${input.ctlEnd} (${input.ctlEnd >= input.ctlStart ? "+" : ""}${(input.ctlEnd - input.ctlStart).toFixed(1)})`
      : "";

  const typeLines = Object.entries(input.complianceByType)
    .map(([t, pct]) => `  ${t}: ${pct}%`)
    .join("\n");

  const topLine = input.topSessions
    .map((s) => `"${s.name}" ${s.date} (TSS ${s.tss})`)
    .join(", ");

  const decoupLine = input.avgDecoupling !== null
    ? `Avg decoupling across block: ${input.avgDecoupling.toFixed(1)}%`
    : "";

  const profileBlock = input.powerProfile ? `\nRIDER POWER PROFILE (curve shape):\n${input.powerProfile}\n` : "";

  return [
    "You are a cycling coach writing a concise retrospective for a completed training block. Be direct and coaching-like — no bullet points, no fluff, flowing prose only. Do not start with 'This block'.",
    "",
    `Block: "${input.goal}" — ${input.lengthWeeks} weeks (${input.startDate} → ${input.endDate})`,
    `Volume: ${input.plannedHours.toFixed(1)}h planned → ${input.actualHours.toFixed(1)}h actual (${input.overallCompliancePct}% compliance)`,
    ctlLine,
    decoupLine,
    "",
    "Compliance by session type:",
    typeLines || "  (no data)",
    "",
    `Top sessions: ${topLine || "(none)"}`,
    profileBlock,
    "Write 3–4 sentences covering: overall execution quality, which session types worked vs. fell short, one key physiological observation (CTL gain/decoupling), and one concrete priority for the next block. Read the rider's curve SHAPE, not just compliance — if a session type's strength sits below the rider's own engine (or the easy-win weak point), weigh that in the next-block priority.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// One matured intervention (a hypothesis the last block acted on) + the outcome it produced — the
// raw material the model turns into a StructuredReflection. Deterministic data in; phrasing out.
export interface ReflectionInterventionInput {
  dimension: string;
  severity: "alert" | "watch" | "good";
  title: string;
  physMetric: string;
  baselineExecEwma: number | null;
  baselinePhys: number | null;
  outcome: {
    execNow: number | null;
    physNow: number | null;
    execDelta: number | null;
    physDelta: number | null;
    verdict: "validated" | "refuted" | "inconclusive";
  };
}

// The structured-reflection prompt (Track D). Pure; generateStructuredRetrospective() sends it via
// native tool-use. Assumes at least one intervention (the caller short-circuits an empty list to []).
export function buildStructuredRetrospectivePrompt(
  input: RetrospectiveInput & { interventions: ReflectionInterventionInput[] }
): string {
  const fmtDelta = (d: number | null) => (d === null ? "n/a" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}`);
  const interventionLines = input.interventions
    .map((iv, idx) => {
      const o = iv.outcome;
      return [
        `${idx + 1}. [${iv.dimension}] (${iv.severity}) ${iv.title}`,
        `   hypothesis baseline — execution EWMA ${iv.baselineExecEwma ?? "n/a"}, ${iv.physMetric} ${iv.baselinePhys ?? "n/a"}`,
        `   matured outcome — verdict ${o.verdict}; execution ${iv.baselineExecEwma ?? "n/a"} → ${o.execNow ?? "n/a"} (Δ ${fmtDelta(o.execDelta)}); ${iv.physMetric} Δ ${fmtDelta(o.physDelta)} (+ = improvement)`,
      ].join("\n");
    })
    .join("\n");

  const profileBlock = input.powerProfile ? `\nRIDER POWER PROFILE (curve shape — context for adjusted_strategy):\n${input.powerProfile}\n` : "";

  return [
    `Completed block: "${input.goal}" — ${input.lengthWeeks} weeks (${input.startDate} → ${input.endDate}).`,
    `Volume ${input.plannedHours.toFixed(1)}h planned → ${input.actualHours.toFixed(1)}h actual (${input.overallCompliancePct}% compliance).`,
    profileBlock,
    "The block acted on these hypotheses (interventions). Each has now matured and been scored:",
    interventionLines,
    "",
    "For EACH numbered intervention above, return one reflection. Ground `hypothesis` and " +
      "`observation` strictly in the supplied baselines/outcomes — do not invent any metric, date, or " +
      "number. Keep `root_cause` and `adjusted_strategy` concrete and actionable for the next block; where " +
      "the rider's curve shape above is relevant to an intervention's dimension, factor it into `adjusted_strategy`.",
  ].join("\n");
}

// ---------- Low-token "ask coach" spot-checks ----------

export interface AskCoachContext {
  // Pre-computed resolved-numbers snapshot (block position, today's execution, form + TSB modifier,
  // fuel, fused state, directives, disposition guard). The LLM reads facts, not guesses — see
  // lib/coach-snapshot.ts.
  snapshot: CoachSnapshot;
  // Today's prescribed session (null on a rest/unplanned day) — the detailed prescription the
  // snapshot's `today.sessionType` only names.
  session: { name: string; type: string; durationMin: number; intervals: string[] } | null;
  // The next planned session after today, so forward-looking questions ("how do I approach
  // tomorrow's SIT?") see the real prescription instead of the coach inventing rep durations.
  upcoming: { inDays: number; name: string; type: string; durationMin: number; intervals: string[] } | null;
}

// Pure prompt builder — injects the resolved CoachSnapshot plus the exact session prescriptions,
// but NOT the full historical ledger, so spot-checks stay cheap. Deterministic + unit-testable.
// AI: this call site sends no `system` param at all (persona lives in the user message below) --
// inconsistent with every other call site in anthropic-api.ts, but intentional-ish. See
// docs/systems/07-ai-layer.md#known-rough-edges before "fixing" the inconsistency.
export function buildAskCoachPrompt(ctx: AskCoachContext, query: string): string {
  const lines: string[] = [
    "You are the athlete's cycling coach. Answer their question in 2–4 short, practical, decisive sentences. Use the situation below plus whatever they tell you in the question (e.g. weather, how they feel) — don't ask for more data.",
    "",
    formatCoachSnapshot(ctx.snapshot),
  ];
  lines.push(
    ctx.session
      ? `Today's session: ${ctx.session.type} — "${ctx.session.name}" (${ctx.session.durationMin} min)` +
          (ctx.session.intervals.length > 0 ? `; intervals ${ctx.session.intervals.join(", ")}` : "")
      : "No structured session is planned today."
  );
  // The next planned session, with its exact prescription, so the coach answers forward-looking
  // questions from the real plan rather than guessing rep lengths/intensities.
  if (ctx.upcoming) {
    const when = ctx.upcoming.inDays === 1 ? "Tomorrow's session" : `Next session (in ${ctx.upcoming.inDays} days)`;
    lines.push(
      `${when}: ${ctx.upcoming.type} — "${ctx.upcoming.name}" (${ctx.upcoming.durationMin} min)` +
        (ctx.upcoming.intervals.length > 0
          ? `; intervals ${ctx.upcoming.intervals.join(", ")}. Use these exact reps/intensities — do not invent durations.`
          : ".")
    );
  }
  lines.push("", `Question: ${query.trim()}`);
  return lines.join("\n");
}
