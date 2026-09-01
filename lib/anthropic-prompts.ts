// Pure prompt assembly for the Anthropic calls — no SDK, no network, no API key. Every export here is
// deterministic string-building from already-computed numbers, so it's cheap to unit-test and the LLM
// call layer (anthropic-api.ts) stays a thin shell over the SDK (RV-8: this file was ~400 lines tangled
// into the client). The call layer imports these builders and re-exports the public ones, so callers
// can keep importing from "@/lib/anthropic-api" unchanged.
import type { ActivitySummary, IntervalComparison, PowerPR } from "./types";
import { prDurationLabel } from "./pr";
import { isSteadyEnduranceRide } from "./aerobic";
import { ACTIVITY_NOTE_MAX_CHARS } from "./intent-note-parser";
import type { AerobicDiscipline } from "./execution-score";
import { round1 } from "./stats";
import { AEROBIC_DEADBAND_PCT } from "./aerobic";

// ---------- Today's ride analysis ----------

export interface RideAnalysisInput {
  activityDate: string;
  activityName: string;
  activityType: string;
  activityDurationMin: number;
  // Exact moving-time seconds, distinct from the rounded-minute `activityDurationMin` above — NV-11's
  // coasting share needs second-level precision to match the gap between moving time and classified
  // zone time; a minute-rounded duration would introduce noise on the same order as the gap itself.
  activityMovingTimeSec: number;
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
  // Authoritative deterministic intent verdict and segment evidence. Claude may phrase this context
  // but must not reinterpret the note or recompute the score.
  intentContext?: string | null;
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

// NV-11 (2026-08-15): each percentage below is a share of CLASSIFIED (powered) time, not total ride
// time — a ride with real coasting time has classified seconds strictly less than moving time. Folding
// coasting into the same denominator as the zones silently hides the exact behaviour an objective can
// be about ("limit coasting" read as 42% Z3 when it was actually 40.5% of the whole ride). `coastingSec`
// is optional and power-only: HR has no equivalent "zero effort" reading — a gap in HR seconds is a
// sensor dropout, not a real physiological zero — so callers only pass it for the power-zone line.
function fmtZones(times: number[], prefix: string, coastingSec?: number | null): string | null {
  const total = times.reduce((s, t) => s + t, 0);
  if (total === 0) return null;
  const parts = times
    .map((t, i) => ({ z: i + 1, pct: Math.round((t / total) * 100) }))
    .filter((z) => z.pct >= 1)
    .map((z) => `Z${z.z} ${z.pct}%`);
  if (parts.length === 0) return null;
  const zoneLine = `${prefix}: ${parts.join(" · ")}`;
  if (!coastingSec || coastingSec <= 0) return zoneLine;
  // Same rounding floor as the per-zone filter above — don't surface a coasting clause that would
  // itself round to 0% of ride time.
  const coastingPct = Math.round((coastingSec / (total + coastingSec)) * 100);
  return coastingPct >= 1 ? `${zoneLine} · Coasting/no-power ${coastingPct}% of ride time (${Math.round(coastingSec)}s)` : zoneLine;
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
  const powerCoastingSec = input.powerZoneTimes
    ? Math.max(0, input.activityMovingTimeSec - input.powerZoneTimes.reduce((s, t) => s + t, 0))
    : null;
  const powerZoneLine = input.powerZoneTimes ? fmtZones(input.powerZoneTimes, "Power zones", powerCoastingSec) : null;
  const hrZoneLine = input.hrZoneTimes ? fmtZones(input.hrZoneTimes, "HR zones") : null;
  // Power PRs set during this ride — surfaced so the coach recognises the breakthrough.
  const prLine =
    input.powerPRs && input.powerPRs.length > 0
      ? `New power PRs (84-day best): ${input.powerPRs
          .map((pr) => `${prDurationLabel(pr.durationSec)} ${pr.watts}W (was ${pr.prevWatts}W)`)
          .join(", ")}`
      : null;

  // Was capped at 400 chars, which silently cut a real self-directed ride's note mid-sentence before it
  // ever reached the note's second effort block — with no marker, so the model had no way to know its
  // input was a fragment and would describe the cut as the athlete's note being incomplete. Now shares
  // Shares the activity-note cap with the deterministic intent parser and marks a real truncation
  // explicitly rather than cutting silently.
  const trimmedNote = input.activityDescription?.trim();
  const athleteNote = trimmedNote
    ? `Athlete note: "${
        trimmedNote.length > ACTIVITY_NOTE_MAX_CHARS
          ? `${trimmedNote.slice(0, ACTIVITY_NOTE_MAX_CHARS)}… [note truncated]`
          : trimmedNote
      }"`
    : null;
  const intentLine = input.intentContext?.trim() ? input.intentContext.trim() : null;

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

  // NV-5/NV-7/NV-6 (2026-08-15): evidence-bound prose + descending safety. Live-confirmed defect —
  // with intervalComparison null and no per-segment evidence, the coach still wrote "the aero position
  // discipline and constant-pressure approach are clearly working as a durability tool": an
  // athlete-REPORTED method (was the aero position actually held?) stated as a measured, confirmed
  // outcome. No sensor in this prompt can confirm posture or technique — only the numbers above can be
  // "measured"; a cause the model constructs (terrain, a specific effort) is INFERRED and must stay
  // hedged unless timestamped per-segment evidence is given (this prompt never gives any); and a
  // technique/position the athlete reports may be connected to a measured outcome but its own
  // effectiveness is never itself measured.
  const evidenceDiscipline =
    " Match every claim to its evidence tier: a number given above (power, HR, cadence, decoupling, zone-time) may be stated as measured fact; a cause you're inferring — terrain, a specific effort, fatigue — must stay hedged as \"likely\"/\"probably\" unless timestamped per-segment evidence is given, never asserted outright; and a technique or position the athlete reports using (aero tuck, cadence focus, pacing) is athlete-reported, not measured — you may connect it to a measured outcome, but never call the technique itself \"working\" or confirmed, since no sensor here establishes posture or skill quality. Treat a single ride's Pw:HR drift reading the same way: a good or poor on-the-day durability signal, never proof of a lasting physiological adaptation.";
  // NV-6: coasting/braking is the SAFE, correct choice in corners, traffic, poor surfaces and technical
  // descents (British Cycling's own descending guidance leads with observation, braking and line choice,
  // not uninterrupted pedalling) — a low coasting share must never become blanket "eliminate coasting".
  const descendingSafety =
    " Never turn a low coasting share into blanket \"stop coasting\" advice — braking and coasting are the correct, safer choice in corners, traffic, on poor surfaces and technical descents, so frame any coasting note around sustained-effort sections, not descents in general.";

  return [
    "You are a cycling coach. Review today's ride vs the plan in 2–3 sentences. Power is the primary lens: if interval adherence is given, judge execution on BOTH the power hit AND whether each rep held its prescribed duration — a rep at target watts but cut short is NOT full execution, so don't call it textbook. Use HR — and, when a Pw:HR drift figure is shown (steady rides only), aerobic durability/fade — to judge aerobic quality; do not infer decoupling on interval days." + evidenceDiscipline + descendingSafety + disciplineInstruction + " If a DETERMINISTIC INTENT line is given, treat its score and segment evidence as authoritative: phrase it, never reinterpret the note or recompute the verdict. Be direct: execution quality, any notable deviation, and one concrete takeaway for next session. If a new power PR is listed, call it out as a breakthrough first — it's a genuine fitness signal worth recognising. If the athlete left a note, factor it in. If a FUEL PROMPT line is given, you may mention it in one sentence — use its numbers verbatim, never invent or recompute them. No greeting, no fluff, and do not restate the prescription verbatim.",
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
    intentLine,
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
    activityMovingTimeSec: activity.movingTimeSec,
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
    intentContext: null,
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
  effectiveCloseoutDate: string;
  endedEarly: boolean;
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

function retrospectiveCloseoutLine(input: RetrospectiveInput): string | null {
  return input.endedEarly
    ? `Closeout window: ended early on ${input.effectiveCloseoutDate}. Evaluate only ${input.startDate} → ${input.effectiveCloseoutDate}; scheduled days after ${input.effectiveCloseoutDate} are excluded and must not be treated as missed.`
    : null;
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
    retrospectiveCloseoutLine(input),
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
    retrospectiveCloseoutLine(input),
    `Volume ${input.plannedHours.toFixed(1)}h planned → ${input.actualHours.toFixed(1)}h actual (${input.overallCompliancePct}% compliance).`,
    profileBlock,
    "The block acted on these hypotheses (interventions). Each has now matured and been scored:",
    interventionLines,
    "",
    "For EACH numbered intervention above, return one reflection. Ground `hypothesis` and " +
      "`observation` strictly in the supplied baselines/outcomes — do not invent any metric, date, or " +
      "number. Keep `root_cause` and `adjusted_strategy` concrete and actionable for the next block; where " +
      "the rider's curve shape above is relevant to an intervention's dimension, factor it into `adjusted_strategy`.",
  ].filter((line) => line !== null).join("\n");
}
