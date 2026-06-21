// CoachSnapshot — one deterministic, pre-computed bundle of resolved numbers that the LLM-facing
// surfaces (Ask-Coach + block generation) read, so the model is handed facts instead of inventing
// them (ROADMAP #1, the "objective telemetry lens"). All math/decisions stay in TypeScript; the LLM
// only phrases what's here.
//
// Foundations build: most slots are populated now; a few are reserved (null) until the tracks that
// own their data land — see the WIP markers and ROADMAP #1.
import type {
  AcwrResult,
  AthleteModel,
  AthleteState,
  CurrentBlock,
  DispositionEntry,
  FitnessMetrics,
  LoadRampAlert,
  MorningCheckEntry,
  ReadinessSignal,
  RollingBaselines,
  SyncData,
  TodayAnalysis,
  WorkoutType,
} from "./types";
import { computeAcwr, computeLoadRamp, computeReadiness } from "./readiness";
import { athleteStateInputsFrom, computeAthleteState } from "./athlete-state";
import { weightTrendFromWellness } from "./nutrition";

export interface CoachSnapshot {
  date: string;
  ftp: number | null;
  block: { goal: string; weekOfBlock: number; totalWeeks: number; overview: string } | null;
  today: {
    sessionType: string | null; // today's planned type (null on a rest/unplanned day)
    rideLogged: boolean;
    // Resolved off todayAnalysis.intervalComparison + executionScore. null when no ride is logged.
    execution: {
      score: number | null; // 1–10
      completed: number | null; // reps that finished (≥90% of prescribed duration)
      total: number | null; // prescribed reps
      effectivePct: number | null; // power × duration completion (what scoring uses)
      powerPct: number | null; // avg power adherence
      durationPct: number | null; // avg duration completion
      structuralMismatch: boolean; // plan-vs-detection mismatch guard
    } | null;
    // The athlete's pre-session subjective read (ROADMAP #3), null until they check in today.
    morningCheck: {
      fatigue: number;
      sleep: number;
      soreness: number;
      illness: MorningCheckEntry["illness"];
      decision: MorningCheckEntry["decision"];
    } | null;
  };
  form: {
    tsb: number | null;
    acwr: AcwrResult["level"] | null;
    readiness: ReadinessSignal["level"] | null;
    loadRamp: LoadRampAlert["level"] | null; // null unless an alert is triggered
    // TSB resolved against today's prescription — the actionable modifier (ROADMAP #1). Band edges
    // are population defaults and are a calibration hook for #2 (per-athlete TSB adaptation window).
    tsbModifier: { band: string; guidance: string } | null;
  };
  fuel: {
    todayTargetKcal: number | null; // advised daily intake (same formula as generation)
    rideBurnKj: number | null; // today's ride energy (kJ ≈ kcal of work)
    weightTrend7dKg: number | null;
    // WIP — no intake logging yet; these populate when Track C / §6 (fueling engine +
    // energy-availability evaluator) land. Kept here so they wire in without reshaping the type.
    intakeVsNeed: number | null;
    fuelingState: string | null;
  };
  state: { score: number; band: AthleteState["band"]; recommendation: AthleteState["recommendation"]; headline: string } | null;
  directives: string | null; // synthesized coaching directives block (may be empty string → null)
  disposition: { kind: DispositionEntry["disposition"]; reason: DispositionEntry["reason"] } | null;
}

export interface CoachSnapshotInput {
  date: string; // resolved "today" (local)
  ftp: number | null;
  block: CurrentBlock | null;
  todaySessionType: WorkoutType | null;
  fitness: FitnessMetrics | null;
  readiness: ReadinessSignal | null;
  acwr: AcwrResult | null;
  loadRamp: LoadRampAlert | null;
  athleteState: AthleteState | null;
  todayAnalysis: TodayAnalysis | null;
  weightTrend7dKg: number | null;
  directives: string | null;
  disposition: DispositionEntry | null;
  morningCheck: MorningCheckEntry | null;
}

// The form/fuel/state half of the snapshot input — the signals both /api/ask and /api/generate
// resolve identically from the loaded stores. Extracted so the two routes can't drift (CR-9). Keys
// match CoachSnapshotInput so the caller can spread it in. Deterministic; the route does the IO.
export interface CoachSignals {
  fitness: FitnessMetrics | null;
  readiness: ReadinessSignal | null;
  acwr: AcwrResult | null;
  loadRamp: LoadRampAlert | null;
  athleteState: AthleteState | null;
  weightTrend7dKg: number | null;
}

export function resolveCoachSignals(
  sync: SyncData | null,
  athleteModel: AthleteModel,
  baselines: RollingBaselines,
  acwrBands: Parameters<typeof computeAcwr>[1]
): CoachSignals {
  if (!sync) return { fitness: null, readiness: null, acwr: null, loadRamp: null, athleteState: null, weightTrend7dKg: null };
  const acwr = computeAcwr(sync.activities, acwrBands);
  return {
    fitness: sync.fitness,
    readiness: computeReadiness(sync.fitness, sync.wellness),
    acwr,
    loadRamp: computeLoadRamp(sync.activities),
    athleteState: computeAthleteState(athleteStateInputsFrom(sync, athleteModel, baselines, acwr)),
    weightTrend7dKg: weightTrendFromWellness(sync.wellness),
  };
}

// Quality session types — TSB carries more decision weight before these than before easy work.
const QUALITY_TYPES = new Set<string>(["Threshold", "VO2max", "SIT", "RaceSim"]);

// Resolve TSB against today's prescription: not just "−12" but what it means for executing today.
// Population-default band edges; per-athlete calibration is #2's TSB adaptation window. Deterministic
// — the LLM only phrases the chosen guidance.
export function resolveTsbModifier(
  tsb: number | null,
  todayType: WorkoutType | null
): { band: string; guidance: string } | null {
  if (tsb === null) return null;
  const quality = todayType != null && QUALITY_TYPES.has(todayType);
  if (tsb <= -25) {
    return {
      band: "deep fatigue",
      guidance: quality
        ? "deeply fatigued — today's quality stimulus may not fully adapt; consider softening it or moving it if RPE climbs early."
        : "deeply fatigued — keep it easy and prioritise recovery.",
    };
  }
  if (tsb <= -10) {
    return {
      band: "productive overload",
      guidance: quality
        ? "productive fatigue — the stimulus still adapts; proceed, but drop a rep if RPE passes 8 before the final efforts."
        : "carrying productive fatigue — fine for easy volume.",
    };
  }
  if (tsb <= 5) {
    return {
      band: "balanced",
      guidance: quality ? "balanced form — good to execute the session as prescribed." : "balanced form.",
    };
  }
  return {
    band: "fresh",
    guidance: quality ? "fresh/tapered — full quality is well-supported." : "fresh/tapered.",
  };
}

function weekOfBlock(block: CurrentBlock, date: string): number {
  return Math.min(
    block.lengthWeeks,
    Math.max(1, Math.floor((Date.parse(date) - Date.parse(block.startDate)) / (7 * 86_400_000)) + 1)
  );
}

// Pure assembler — the route does the IO + computes readiness/acwr/state/directives, then hands the
// resolved objects here. Maps + bands only; no fetching, no AI.
export function buildCoachSnapshot(input: CoachSnapshotInput): CoachSnapshot {
  const { block, todayAnalysis, date } = input;
  const ride = todayAnalysis && todayAnalysis.activityDate === date ? todayAnalysis : null;
  const ic = ride?.intervalComparison ?? null;

  return {
    date,
    ftp: input.ftp,
    block: block
      ? {
          goal: block.goal,
          weekOfBlock: weekOfBlock(block, date),
          totalWeeks: block.lengthWeeks,
          overview: (block.overview ?? "").slice(0, 160),
        }
      : null,
    today: {
      sessionType: input.todaySessionType,
      rideLogged: ride !== null,
      execution:
        ride && (ride.executionScore != null || ic)
          ? {
              score: ride.executionScore,
              completed: ic?.completed ?? null,
              total: ic?.total ?? null,
              effectivePct: ic?.effectiveAdherencePct ?? null,
              powerPct: ic?.avgAdherencePct ?? null,
              durationPct: ic?.avgDurationPct ?? null,
              structuralMismatch: ic?.structuralMismatch ?? false,
            }
          : null,
      morningCheck: input.morningCheck
        ? {
            fatigue: input.morningCheck.fatigue,
            sleep: input.morningCheck.sleep,
            soreness: input.morningCheck.soreness,
            illness: input.morningCheck.illness,
            decision: input.morningCheck.decision,
          }
        : null,
    },
    form: {
      tsb: input.fitness?.tsb ?? null,
      acwr: input.acwr?.level ?? null,
      readiness: input.readiness?.level ?? null,
      loadRamp: input.loadRamp?.triggered ? input.loadRamp.level : null,
      tsbModifier: resolveTsbModifier(input.fitness?.tsb ?? null, input.todaySessionType),
    },
    fuel: {
      todayTargetKcal: ride?.advisedIntakeKcal ?? null,
      rideBurnKj: ride?.activityKj ?? null,
      weightTrend7dKg: input.weightTrend7dKg,
      intakeVsNeed: null, // WIP — no intake logging (Track C / §6)
      fuelingState: null, // WIP — energy-availability evaluator (Track C / §6)
    },
    state: input.athleteState
      ? {
          score: input.athleteState.score,
          band: input.athleteState.band,
          recommendation: input.athleteState.recommendation,
          headline: input.athleteState.headline,
        }
      : null,
    directives: input.directives && input.directives.trim() ? input.directives.trim() : null,
    disposition: input.disposition
      ? { kind: input.disposition.disposition, reason: input.disposition.reason }
      : null,
  };
}

// The athlete-attribution guard — a compromised/partial session must not be read as under-recovery
// or under-fuelling. Phrased strongly because it has to override any inference from a low score.
function dispositionGuard(d: CoachSnapshot["disposition"]): string | null {
  if (!d) return null;
  if (d.kind === "compromised") {
    return `IMPORTANT: the athlete marked today's session COMPROMISED${d.reason ? ` (${d.reason})` : ""}. A low execution score reflects that, NOT under-recovery or under-fuelling — do not infer recovery debt or recommend skipping on the basis of it.`;
  }
  if (d.kind === "partial") return "The athlete marked today's session partial (cut short).";
  return null;
}

// Full resolved-numbers block for Ask-Coach. Lines whose data is absent are omitted; the reserved
// fuel slots (intakeVsNeed/fuelingState) are intentionally not rendered while null.
export function formatCoachSnapshot(s: CoachSnapshot): string {
  const lines: string[] = ["SITUATION (resolved numbers — treat as ground truth; do not invent or override):"];

  if (s.block) {
    lines.push(`- Block: "${s.block.goal}" — week ${s.block.weekOfBlock} of ${s.block.totalWeeks}.${s.block.overview ? ` ${s.block.overview}` : ""}`);
  }

  const todayBits = [s.today.sessionType ? `${s.today.sessionType} planned` : "no structured session planned"];
  todayBits.push(s.today.rideLogged ? "ride logged" : "no ride logged yet");
  lines.push(`- Today: ${todayBits.join(", ")}.`);

  const ex = s.today.execution;
  if (ex) {
    const parts: string[] = [];
    if (ex.score != null) parts.push(`execution ${ex.score}/10`);
    if (ex.completed != null && ex.total != null) parts.push(`${ex.completed}/${ex.total} reps`);
    if (ex.effectivePct != null) {
      const pd =
        ex.powerPct != null && ex.durationPct != null ? ` (power ${ex.powerPct}% × duration ${ex.durationPct}%)` : "";
      parts.push(`effective ${ex.effectivePct}%${pd}`);
    }
    if (parts.length > 0) {
      lines.push(`- Execution (today): ${parts.join(" · ")}${ex.structuralMismatch ? " · ⚠ plan/detection mismatch — duration is unreliable, judge on power" : ""}.`);
    }
  }

  const mc = s.today.morningCheck;
  if (mc) {
    lines.push(
      `- Reported this morning: fatigue ${mc.fatigue}/5 · sleep ${mc.sleep}/5 · soreness ${mc.soreness}/5${mc.illness !== "none" ? ` · illness ${mc.illness}` : ""} → ${mc.decision === "downgrade" ? "recommended a downgrade" : "cleared to proceed"}.`
    );
  }

  const f = s.form;
  if (f.tsb != null || f.acwr || f.readiness) {
    const parts: string[] = [];
    if (f.tsb != null) {
      const mod = f.tsbModifier ? ` (${f.tsbModifier.band} — ${f.tsbModifier.guidance})` : "";
      parts.push(`TSB ${f.tsb > 0 ? "+" : ""}${f.tsb}${mod}`);
    }
    if (f.acwr) parts.push(`ACWR ${f.acwr}`);
    if (f.readiness) parts.push(`readiness ${f.readiness}`);
    if (f.loadRamp) parts.push(`load ramp ${f.loadRamp}`);
    lines.push(`- Form: ${parts.join(" · ")}.`);
  }

  const fuelParts: string[] = [];
  if (s.fuel.todayTargetKcal != null) fuelParts.push(`target ${s.fuel.todayTargetKcal.toLocaleString()} kcal`);
  if (s.fuel.rideBurnKj != null) fuelParts.push(`ride burn ${s.fuel.rideBurnKj.toLocaleString()} kJ`);
  if (s.fuel.weightTrend7dKg != null) {
    const t = s.fuel.weightTrend7dKg;
    fuelParts.push(`weight trend 7d ${t > 0 ? "+" : ""}${t.toFixed(1)} kg`);
  }
  if (fuelParts.length > 0) lines.push(`- Fuel: ${fuelParts.join(" · ")}.`);

  if (s.state) lines.push(`- Fused state: ${s.state.headline} (${s.state.score}/100, ${s.state.recommendation}).`);
  if (s.ftp) lines.push(`- FTP: ${s.ftp} W.`);
  if (s.directives) lines.push(`- Coaching directives: ${s.directives}`);

  const guard = dispositionGuard(s.disposition);
  if (guard) lines.push(guard); // last, so it overrides any inference from a low score

  return lines.join("\n");
}

// Compact form(+TSB-modifier)+fuel line for block generation, which already injects fused-state +
// directives separately. Adds only the resolved current form/fuel the planner shouldn't invent.
export function formatFormFuelLine(s: CoachSnapshot): string | null {
  const parts: string[] = [];
  if (s.form.tsb != null) {
    const mod = s.form.tsbModifier ? ` (${s.form.tsbModifier.band})` : "";
    parts.push(`TSB ${s.form.tsb > 0 ? "+" : ""}${s.form.tsb}${mod}`);
  }
  if (s.form.acwr) parts.push(`ACWR ${s.form.acwr}`);
  if (s.form.readiness) parts.push(`readiness ${s.form.readiness}`);
  if (s.fuel.todayTargetKcal != null) parts.push(`fuel target ${s.fuel.todayTargetKcal.toLocaleString()} kcal`);
  if (s.fuel.weightTrend7dKg != null) {
    const t = s.fuel.weightTrend7dKg;
    parts.push(`weight trend 7d ${t > 0 ? "+" : ""}${t.toFixed(1)} kg`);
  }
  if (parts.length === 0) return null;
  return `CURRENT FORM & FUEL (resolved — do not invent): ${parts.join(" · ")}.`;
}
