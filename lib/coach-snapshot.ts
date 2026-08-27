// CoachSnapshot — one deterministic, pre-computed bundle of resolved numbers that the LLM-facing
// surfaces read, so the model is handed facts instead of inventing
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
  InterventionLog,
  IntentOverlay,
  LoadRampAlert,
  MorningCheckEntry,
  ReadinessSignal,
  RideScoreEntry,
  RollingBaselines,
  SyncData,
  TodayAnalysis,
  WorkoutType,
} from "./types";
import { computeAcwr, computeLoadRamp, computeReadiness } from "./readiness";
import type { AerobicDiscipline } from "./execution-score";
import { detectFtpRetest, type FtpRetestSignal } from "./plan-vs-actual";
import { athleteStateInputsFrom, computeAthleteState } from "./athlete-state";
import { balanceLevel, computeEnergyAvailability, eaLevel, weightTrendFromWellness, type EnergyAvailability } from "./nutrition";
import { localToday } from "./date";
import type { WeeklyEnergyBalance } from "./trends";
import { DEFAULT_TSB_MODIFIER_EDGES, resolveAcwrBands, resolveAthleteStateWeights, resolveTsbEdgesOverride, resolveTsbModifierEdges, type AcwrBands, type AthleteStateWeights, type DeepPartial, type TsbModifierEdges } from "./calibration";
import { buildAthleteModel, deriveInsights } from "./athlete-model";
import { synthesizeCoachingDirectives } from "./synthesis";
import { summariseValidation } from "./intervention";
import { round1 } from "./stats";
import { AEROBIC_DEADBAND_PCT } from "./aerobic";

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
      // The terrain-immune HR-judged easy-ride discipline read (dialed/drift/hot), lifted straight from
      // TodayAnalysis.aerobicDiscipline — already gated Z2/Recovery-only, on-plan, !embedsEfforts by
      // ride-analysis.ts. null when not an easy day, off-plan, a durability template B–E, or no HR-zone data.
      aerobicDiscipline: AerobicDiscipline | null;
      // The aerobic-efficiency-vs-baseline figure behind aerobicDiscipline above, lifted straight
      // from TodayAnalysis.aerobicEffPct — same gate, same source.
      aerobicEffPct: number | null;
    } | null;
    // The athlete's manual morning override (ROADMAP #3), null until they flag today.
    morningCheck: {
      flag: MorningCheckEntry["flag"];
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
    // Energy-availability read (Track C / #1): `fuelingState` = the low/adequate/ample band, `intakeVsNeed`
    // = its kcal/kg figure (energy left after exercise per kg body weight — a body-weight proxy for whether
    // intake meets need, NOT the clinical FFM cutoff). Both null until ≥3 complete logged days exist.
    intakeVsNeed: number | null;
    // §6: the precise weekly ratio for the week that just closed — null when under-logged. Present →
    // owns fuelingState (precedence over the EA proxy band above).
    // balanceIntakeKcal, not intakeKcal — the figure that actually divides to `ratio` (review §2.8;
    // WeeklyEnergyBalance's doc comment). The narrative line pairs this with `ratio` in one sentence.
    weekBalance: { weekOf: string; balanceIntakeKcal: number; needKcal: number; ratio: number } | null;
    fuelingState: string | null;
  };
  state: { score: number; band: AthleteState["band"]; recommendation: AthleteState["recommendation"]; headline: string } | null;
  directives: string | null; // synthesized coaching directives block (may be empty string → null)
  disposition: { kind: DispositionEntry["disposition"]; reason: DispositionEntry["reason"] } | null;
  // Execution-driven FTP-retest advisory (ROADMAP #4): non-null only when recent FTP-anchored quality
  // sessions consistently over-delivered vs the FTP-derived band (lib/plan-vs-actual.ts). Advisory
  // ONLY — nudges an Intervals.icu re-test; never writes FTP locally (physiology.json stays the SoT).
  ftpRetest: FtpRetestSignal | null;
}

// The form/fuel/state half of the snapshot input — the signals /api/sync and /api/generate
// resolve identically from the loaded stores (via resolveCoachSignals). Extracted so the two routes
// can't drift (CR-9). Deterministic; the route does the IO.
export interface CoachSignals {
  fitness: FitnessMetrics | null;
  readiness: ReadinessSignal | null;
  acwr: AcwrResult | null;
  loadRamp: LoadRampAlert | null;
  athleteState: AthleteState | null;
  weightTrend7dKg: number | null;
  energyAvailability: EnergyAvailability | null;
  // §6: the precise intake-vs-need read for the week that just closed (day-matched, complete weeks
  // only — lib/trends.ts latestWeeklyBalance). Null when the prior week was under-logged. When
  // present it OWNS fuelingState; the daily EA proxy is the fallback band (one verdict, two sources,
  // documented precedence — never two disagreeing fuel verdicts in one snapshot).
  weeklyBalance: WeeklyEnergyBalance | null;
  // Execution-driven FTP-retest advisory (#4) — resolved here so /ask, /sync and /generate can't
  // drift (CR-9). Null below the overdelivery gates (thin data / nothing over / no current FTP).
  ftpRetest: FtpRetestSignal | null;
}

// The non-signal half (the IO/context the route owns); the form/fuel/state signals are inherited from
// CoachSignals so the two halves can't drift apart — the compiler now enforces what was a comment (RR-6).
export interface CoachSnapshotInput extends CoachSignals {
  date: string; // resolved "today" (local)
  ftp: number | null;
  block: CurrentBlock | null;
  todaySessionType: WorkoutType | null;
  todayAnalysis: TodayAnalysis | null;
  directives: string | null;
  disposition: DispositionEntry | null;
  morningCheck: MorningCheckEntry | null;
  // Raw per-athlete override for the TSB adaptation-window edges (settings.tsbModifierEdges); resolved
  // here so callers don't each repeat resolveTsbModifierEdges(). Absent → population defaults (ROADMAP #2).
  tsbModifierEdgesOverride?: Partial<TsbModifierEdges> | null;
}

// `acwrBandsOverride` is the raw per-athlete override (settings.acwrBands); resolution to the full
// bands lives here so callers don't each repeat resolveAcwrBands() and drift (RR-5/RR-7).
// `athleteStateWeightsOverride` (settings.athleteStateWeights) is resolved here for the same reason.
export function resolveCoachSignals(
  sync: SyncData | null,
  athleteModel: AthleteModel,
  // Retained for the signal bundle's shape; the athlete-state aerobic signal now reads each ride's own
  // Z2 Pw:HR (icu_power_hr_z2) from `sync`, not a pre-rolled all-rides average, so this is no longer read here.
  baselines: RollingBaselines,
  acwrBandsOverride?: Partial<AcwrBands> | null,
  athleteStateWeightsOverride?: DeepPartial<AthleteStateWeights> | null,
  // Resolved local "today" so the ACWR / load-ramp windows anchor to the athlete's calendar day, not
  // UTC (they match activities on local date). Absent → localToday().
  today?: string,
  // #4: the frozen ledger + the FTP currently configured (physiology SoT with profile fallback) —
  // the retest detector's inputs. Omitted → the advisory resolves null (same silent-degradation
  // contract as the optional `today` above; the failure direction is conservative: flag absent).
  scoreEntries: RideScoreEntry[] = [],
  currentFtp: number | null = null,
  weeklyBalance: WeeklyEnergyBalance | null = null
): CoachSignals {
  if (!sync) return { fitness: null, readiness: null, acwr: null, loadRamp: null, athleteState: null, weightTrend7dKg: null, energyAvailability: null, weeklyBalance: null, ftpRetest: null };
  void baselines; // see note above — kept in the signature, not used
  const resolvedToday = today ?? localToday();
  const acwr = computeAcwr(sync.activities, resolveAcwrBands(acwrBandsOverride), resolvedToday);
  return {
    fitness: sync.fitness,
    readiness: computeReadiness(sync.fitness, sync.wellness),
    acwr,
    loadRamp: computeLoadRamp(sync.activities, resolvedToday),
    athleteState: computeAthleteState(
      athleteStateInputsFrom(sync, athleteModel, acwr, resolvedToday),
      resolveAthleteStateWeights(athleteStateWeightsOverride)
    ),
    weightTrend7dKg: weightTrendFromWellness(sync.wellness),
    // Same proxy the Today EA tile shows — anchored to the resolved local day so today's still-logging
    // intake is excluded. Null until ≥3 complete logged days; then it fills the fuel slots below.
    energyAvailability: computeEnergyAvailability(sync.wellness, sync.activities, resolvedToday),
    weeklyBalance,
    ftpRetest: detectFtpRetest(scoreEntries, resolvedToday, currentFtp),
  };
}

// Quality session types — TSB carries more decision weight before these than before easy work.
const QUALITY_TYPES = new Set<string>(["Threshold", "VO2max", "SIT", "RaceSim"]);

// Resolve TSB against today's prescription: not just "−12" but what it means for executing today.
// Band edges are the per-athlete TSB adaptation window (ROADMAP #2): population-validated defaults,
// optionally manually overridden, resolved by resolveTsbModifierEdges. Deterministic — the LLM only
// phrases the chosen guidance.
export function resolveTsbModifier(
  tsb: number | null,
  todayType: WorkoutType | null,
  edges: TsbModifierEdges = DEFAULT_TSB_MODIFIER_EDGES
): { band: string; guidance: string } | null {
  if (tsb === null) return null;
  const quality = todayType != null && QUALITY_TYPES.has(todayType);
  if (tsb <= edges.deepFatigue) {
    return {
      band: "deep fatigue",
      guidance: quality
        ? "deeply fatigued — today's quality stimulus may not fully adapt; consider softening it or moving it if RPE climbs early."
        : "deeply fatigued — keep it easy and prioritise recovery.",
    };
  }
  if (tsb <= edges.productiveOverload) {
    return {
      band: "productive overload",
      guidance: quality
        ? "productive fatigue — the stimulus still adapts; proceed, but drop a rep if RPE passes 8 before the final efforts."
        : "carrying productive fatigue — fine for easy volume.",
    };
  }
  if (tsb <= edges.balanced) {
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
              aerobicDiscipline: ride?.aerobicDiscipline ?? null,
              aerobicEffPct: ride?.aerobicEffPct ?? null,
            }
          : null,
      morningCheck: input.morningCheck
        ? { flag: input.morningCheck.flag, decision: input.morningCheck.decision }
        : null,
    },
    form: {
      tsb: input.fitness?.tsb ?? null,
      acwr: input.acwr?.level ?? null,
      readiness: input.readiness?.level ?? null,
      loadRamp: input.loadRamp?.triggered ? input.loadRamp.level : null,
      tsbModifier: resolveTsbModifier(
        input.fitness?.tsb ?? null,
        input.todaySessionType,
        resolveTsbModifierEdges(input.tsbModifierEdgesOverride)
      ),
    },
    fuel: {
      todayTargetKcal: ride?.advisedIntakeKcal ?? null,
      rideBurnKj: ride?.activityKj ?? null,
      weightTrend7dKg: input.weightTrend7dKg,
      intakeVsNeed: input.energyAvailability?.eaKcalPerKg ?? null, // EA kcal/kg (Track C / #1)
      weekBalance: input.weeklyBalance
        ? { weekOf: input.weeklyBalance.weekOf, balanceIntakeKcal: input.weeklyBalance.balanceIntakeKcal, needKcal: input.weeklyBalance.needKcal, ratio: input.weeklyBalance.ratio }
        : null,
      // Precedence: precise weekly ratio > daily EA proxy band > null (see CoachSignals.weeklyBalance).
      fuelingState: input.weeklyBalance
        ? balanceLevel(input.weeklyBalance.ratio)
        : input.energyAvailability
          ? eaLevel(input.energyAvailability.eaKcalPerKg)
          : null,
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
    ftpRetest: input.ftpRetest,
  };
}

// The already-loaded stores a snapshot is assembled from. The caller does the IO; this owns the
// deterministic assembly (model → signals → directives → snapshot) so generation and the sync GET
// (the Today card) build the *same* snapshot — the athlete sees exactly the numbers the LLM does (ROADMAP #1).
export interface CoachSnapshotSources {
  date: string;
  ftp: number | null;
  block: CurrentBlock | null;
  sync: SyncData | null;
  todayAnalysis: TodayAnalysis | null;
  scoreEntries: RideScoreEntry[];
  intentOverlays: IntentOverlay[];
  baselines: RollingBaselines;
  dispositions: DispositionEntry[];
  interventionLog: InterventionLog;
  morningChecks: MorningCheckEntry[];
  // §6: caller-computed weekly intake-vs-need ratio (lib/trends.ts latestWeeklyBalance) — threaded
  // through to CoachSignals.weeklyBalance so this builder stays IO-free.
  weeklyBalance: WeeklyEnergyBalance | null;
  acwrBandsOverride?: Partial<AcwrBands> | null;
  tsbModifierEdgesOverride?: Partial<TsbModifierEdges> | null;
  athleteStateWeightsOverride?: DeepPartial<AthleteStateWeights> | null;
}

export function buildCoachSnapshotFromSources(s: CoachSnapshotSources): CoachSnapshot {
  const athleteModel = buildAthleteModel(s.scoreEntries, s.intentOverlays);
  const signals = resolveCoachSignals(s.sync, athleteModel, s.baselines, s.acwrBandsOverride, s.athleteStateWeightsOverride, s.date, s.scoreEntries, s.ftp, s.weeklyBalance);
  // Only a real session (durationMin > 0) sets the type — a rest day stays null.
  const todayDay = s.block?.days.find((d) => d.date === s.date && d.durationMin > 0) ?? null;
  return buildCoachSnapshot({
    date: s.date,
    ftp: s.ftp,
    block: s.block,
    todaySessionType: todayDay?.type ?? null,
    ...signals,
    todayAnalysis: s.todayAnalysis,
    directives: synthesizeCoachingDirectives(deriveInsights(athleteModel), summariseValidation(s.interventionLog)),
    disposition: s.dispositions.find((e) => e.date === s.date) ?? null,
    morningCheck: s.morningChecks.find((e) => e.date === s.date) ?? null,
    // Derived deep-fatigue edge (from the ledger's stamped TSB context) under any manual override (ROADMAP #2).
    tsbModifierEdgesOverride: resolveTsbEdgesOverride(s.scoreEntries, s.tsbModifierEdgesOverride),
  });
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

// Full resolved-numbers block for AI prompts. Lines whose data is absent are omitted; the reserved
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
    if (ex.aerobicDiscipline != null) {
      const label =
        ex.aerobicDiscipline === "dialed" ? "dialed in" : ex.aerobicDiscipline === "drift" ? "some drift" : "ran hot";
      // Same threshold as the ride-note prompt (AEROBIC_DEADBAND_PCT) — only surface the figure
      // when it's a notable read, not per-ride noise.
      const eff =
        ex.aerobicEffPct != null && ex.aerobicEffPct <= -AEROBIC_DEADBAND_PCT
          ? ` (efficiency ${round1(ex.aerobicEffPct)}% below baseline)`
          : "";
      parts.push(`aerobic discipline: ${label}${eff}`);
    }
    if (parts.length > 0) {
      lines.push(`- Execution (today): ${parts.join(" · ")}${ex.structuralMismatch ? " · ⚠ plan/detection mismatch — duration is unreliable, judge on power" : ""}.`);
    }
  }

  const mc = s.today.morningCheck;
  if (mc) {
    // All three flags and all three decisions rendered honestly — an injury/rest used to fall through
    // to "extreme fatigue → no change (not a quality day)", both halves wrong.
    const flagLabel = mc.flag === "ill" ? "feeling ill" : mc.flag === "injury" ? "injured" : "extreme fatigue";
    const decisionLabel =
      mc.decision === "downgrade"
        ? "downgraded today's quality session"
        : mc.decision === "rest"
          ? "resting today — the planned ride is skipped, treat it as deliberate recovery, not a lapse"
          : "no change";
    lines.push(`- Flagged this morning: ${flagLabel} → ${decisionLabel}.`);
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
  if (s.fuel.fuelingState != null) {
    // fuelingState's source switches (weekly ratio > EA proxy, per the precedence documented on
    // CoachSignals.weeklyBalance), but intakeVsNeed is always the EA figure specifically — so the
    // label and the attached number must only pair up when EA actually owns the verdict, or the
    // line contradicts itself in the disagreement case this precedence rule exists to resolve.
    const label = s.fuel.weekBalance ? "fueling" : "energy availability";
    const detail = !s.fuel.weekBalance && s.fuel.intakeVsNeed != null ? ` (~${s.fuel.intakeVsNeed} kcal/kg, body-weight proxy)` : "";
    fuelParts.push(`${label} ${s.fuel.fuelingState}${detail}`);
  }
  if (s.fuel.weekBalance) {
    const wb = s.fuel.weekBalance;
    fuelParts.push(
      `last week ${wb.balanceIntakeKcal.toLocaleString()} kcal vs ${wb.needKcal.toLocaleString()} needed (ratio ${wb.ratio.toFixed(2)} — ${balanceLevel(wb.ratio)})`
    );
  }
  if (fuelParts.length > 0) lines.push(`- Fuel: ${fuelParts.join(" · ")}.`);

  if (s.state) lines.push(`- Fused state: ${s.state.headline} (${s.state.score}/100, ${s.state.recommendation}).`);
  if (s.ftp) lines.push(`- FTP: ${s.ftp} W.`);
  if (s.ftpRetest) lines.push(`- FTP check: ${s.ftpRetest.evidence}`);
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
  if (s.fuel.fuelingState != null) {
    // Same precedence rule as formatCoachSnapshot's fuel line: fuelingState's source switches
    // (weekly ratio > EA proxy), so the label must track whichever actually owns the verdict.
    const label = s.fuel.weekBalance ? "fueling" : "energy availability";
    parts.push(`${label} ${s.fuel.fuelingState}`);
  }
  if (parts.length === 0) return null;
  return `CURRENT FORM & FUEL (resolved — do not invent): ${parts.join(" · ")}.`;
}
