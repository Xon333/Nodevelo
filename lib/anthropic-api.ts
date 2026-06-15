// Anthropic API client + prompt assembly for training block generation.
import Anthropic from "@anthropic-ai/sdk";
import type { ActivitySummary, AthleteProfile, BlockParams, BlockSettings, IntervalComparison, SyncData, TodayAnalysis } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";
import { weightTrendFromWellness } from "./nutrition";

// Non-negotiable: in-app generation always uses claude-sonnet-4-6.
export const GENERATION_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.3;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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

  // 8-week summary
  const totalHours = sync.activities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  lines.push(
    "",
    `Last 8 weeks: ${sync.activities.length} activities, ${totalHours.toFixed(1)} h total (${(totalHours / 8).toFixed(1)} h/week average).`
  );

  // Intensity distribution proxy from average power vs FTP.
  let easy = 0;
  let moderate = 0;
  let hard = 0;
  for (const a of sync.activities) {
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

  const keySessions = [...sync.activities]
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
  kbContext: string,
  athleteDataSection: string,
  blockParams: BlockParams
): string {
  return `You are an expert cycling coach who designs structured training blocks. You output training blocks ONLY, in exactly the format the user requests — no preamble, no commentary, no markdown formatting beyond the requested structure. You ground every coaching decision in the knowledge base provided below and in the athlete's current data. You never invent nutrition numbers: you copy the pre-computed values supplied in the user's nutrition reference table.

${WORKOUT_SYNTAX_GUIDE}

KNOWLEDGE BASE CONTEXT

${kbContext}

${athleteDataSection}

BLOCK PARAMETERS

- Block length: ${blockParams.lengthWeeks} weeks
- Block goal: ${blockParams.goal}
- Weakpoints to target this block: ${blockParams.weakpoints.length > 0 ? blockParams.weakpoints.join("; ") : "(none specified)"}`;
}

export function buildUserMessage(
  blockParams: BlockParams,
  weeks: string[][],
  nutritionTableMd: string,
  settings: BlockSettings = DEFAULT_BLOCK_SETTINGS
): string {
  const calendar = weeks
    .map(
      (dates, i) =>
        `Week ${i + 1}: ${dates.map((d) => `${d} (${weekday(d)})`).join(", ")}`
    )
    .join("\n");

  return `Generate a ${blockParams.lengthWeeks}-week training block for the athlete described above.

The block runs on these exact dates — output exactly one DAY entry per date, in order:
${calendar}

Output format — strictly follow this structure:

BLOCK OVERVIEW
[2-3 sentence summary of the block's training approach and rationale]

WEEK [N]: [Week theme]
DAY [date]: [Session name]
  TYPE: [Workout type: Z2 / Threshold / VO2max / SIT / Recovery / Strength / Rest]
  DURATION: [minutes]
  WORKOUT: [Intervals.icu workout syntax per the syntax guide; for Rest days write "Rest"]
  DESCRIPTION: [Nutrition and intent description — see format below]

[Repeat for every day of the block]

DESCRIPTION FORMAT for each workout:
  Intent: [1 sentence on the physiological goal of this session]
  Pre-ride: [Carbohydrate grams from the reference table]
  In-ride: [Carbohydrate grams/hr from the reference table, only for rides > 60 min]
  Post-ride: [Carbs and protein targets in grams from the reference table]
  Daily intake: [Total kcal for the day, copied from the reference table]

NUTRITION REFERENCE TABLE (pre-computed by the app's deterministic formula — copy these values, never calculate your own; pick the row matching the session's type and closest duration):

${nutritionTableMd}

Hard rules:
- Use ISO dates (YYYY-MM-DD) in every DAY line, exactly as listed above.
- DURATION is an integer number of minutes.
- TYPE must be one of: Z2, Threshold, VO2max, SIT, Recovery, Strength, Rest.
- Workout step durations must sum approximately to DURATION.
- **WEEKLY VOLUME (loading weeks):** Target ${settings.weeklyHoursMin}–${settings.weeklyHoursMax} hours total per week. Each loading week must reach at least ${settings.weeklyHoursMin}h.
- **WEEKLY VOLUME (recovery week):** Reduce to ${settings.recoveryWeekHoursMin}–${settings.recoveryWeekHoursMax} hours total.
- **WEEKLY STRUCTURE (loading weeks):** ${settings.qualitySessionsPerLoadingWeek} quality sessions (threshold/VO2max/SIT) + 1 long ${settings.polarisedApproach ? "Z2" : "Z2/sweet-spot"} ride (≥${settings.longRideDurationMinutes} min) + 2–3 easy Z2 sessions (60–90 min each) + ${settings.restDaysPerWeek} rest day${settings.restDaysPerWeek !== 1 ? "s" : ""} per week (avoid back-to-back hard days).${settings.polarisedApproach ? "\n- **Polarised structure:** Keep easy sessions genuinely easy (<0.75 IF). Avoid grey-zone moderate riding." : "\n- **Sweet spot structure:** Include sweet spot intervals (88–93% FTP) in addition to threshold work."}
- **Rest days:** TYPE: Rest, DURATION: 0, WORKOUT: Rest, description with Intent and Daily target only. Limit to ${settings.restDaysPerWeek} per week.
- Do not output anything before BLOCK OVERVIEW or after the final day.`;
}

export interface GenerationResult {
  raw: string;
  truncated: boolean;
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
  plannedName: string | null;
  plannedType: string | null;
  plannedDurationMin: number | null;
  plannedWorkoutText: string | null;
  athleteFtp: number;
  athleteThresholdHr: number;
}

function fmtIntervals(c: IntervalComparison | null): string | null {
  if (!c || c.reps.length === 0) return null;
  const execs = c.reps.map((r) => `${r.actualWatts}W (${r.adherencePct}%)`).join(", ");
  return `Intervals: prescribed ${c.prescribedLabels.join(" + ")} → executed ${execs}; ${c.completed}/${c.total} reps done, avg ${c.avgAdherencePct}% of target.`;
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

export async function analyseRide(input: RideAnalysisInput): Promise<string> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured.");
  }

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
    const ifVal = (input.activityAvgWatts / input.athleteFtp).toFixed(2);
    const maxW = input.activityMaxWatts ? ` · Max ${input.activityMaxWatts}W` : "";
    const dec = input.activityDecoupling != null ? ` · Decoupling ${input.activityDecoupling.toFixed(1)}%` : "";
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

  const athleteNote = input.activityDescription?.trim()
    ? `Athlete note: "${input.activityDescription.trim().slice(0, 400)}"`
    : null;

  const prompt = [
    "You are a cycling coach. Review today's ride vs the plan in 2–3 sentences. Power is the primary lens: if interval adherence is given, lead with how execution matched the prescribed power targets. Use HR and decoupling only to judge aerobic efficiency. Be direct: execution quality, any notable deviation, and one concrete takeaway for next session. If the athlete left a note, factor it in. No greeting, no fluff, and do not restate the prescription verbatim.",
    "",
    planned,
    header,
    intervalLine,
    powerLine,
    hrLine,
    effortLine,
    powerZoneLine,
    hrZoneLine,
    athleteNote,
  ].filter(Boolean).join("\n");

  const client = new Anthropic();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 280,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
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
    activityDecoupling: activity.decoupling,
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
}

export async function generateRetrospective(input: RetrospectiveInput): Promise<string> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");

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

  const prompt = [
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
    "",
    "Write 3–4 sentences covering: overall execution quality, which session types worked vs. fell short, one key physiological observation (CTL gain/decoupling), and one concrete priority for the next block.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const client = new Anthropic();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 380,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function generateTrainingBlock(
  system: string,
  userMessage: string
): Promise<GenerationResult> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured. Set ANTHROPIC_API_KEY in .env.local.");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return { raw, truncated: response.stop_reason === "max_tokens" };
}
