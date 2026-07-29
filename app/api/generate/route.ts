import { NextResponse } from "next/server";
import { resolveToday } from "@/lib/date";
import { logError, logWarn } from "@/lib/log";
import {
  blockDates,
  buildAthleteDataSection,
  buildSystemPrompt,
  buildUserMessage,
  critiqueOverview,
  generateTrainingBlock,
  GENERATION_MODEL,
  isAnthropicConfigured,
  PROMPT_VERSION,
} from "@/lib/anthropic-api";
import { extractBlockFacts } from "@/lib/narrative-critic";
import { readAthleteProfile, readBlockHistory, readBlockSettings, readCurrentBlock, readInterventionLog, readLastSync, readQuirks, readRollingBaselines, readScoreLog, readSeasonPlan, updateSeasonPlan } from "@/lib/data-store";
import { latestRetrospectiveSeeds, loadKnowledgeBaseContext } from "@/lib/kb-loader";
import { formatReflectionsForPrompt } from "@/lib/retrospective-schema";
import { formatQuirksForPrompt } from "@/lib/quirks";
import { analyzePowerProfile, formatPowerProfileForPrompt } from "@/lib/power-profile";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { summariseValidation } from "@/lib/intervention";
import { synthesizeCoachingDirectives } from "@/lib/synthesis";
import { buildCoachSnapshot, formatFormFuelLine, resolveCoachSignals } from "@/lib/coach-snapshot";
import { resolveDurabilityInsertEnvelope, resolveTsbEdgesOverride } from "@/lib/calibration";
import type { Zone } from "@/lib/zones";
import {
  buildNutritionReferenceRows,
  nutritionTableMarkdown,
  weightTrendFromWellness,
  type AthleteNutritionConfig,
} from "@/lib/nutrition";
import { PlanToolSchema, structuredToPlannedDays } from "@/lib/plan-schema";
import { reconcileDurationMin } from "@/lib/prescription";
import { splitPlanProtocol } from "@/lib/workout-validate";
import { repairNutrition } from "@/lib/nutrition-validate";
import { validateEventTaper, validateRecoveryWeekDensity, validateSchedule, validateWeekSequencing } from "@/lib/schedule-validate";
import { checkBlockFeasibility, computeWeekTargets, validateWeekHours } from "@/lib/block-skeleton";
import { deriveSessionRequirements, formatSessionRequirements, validateSessionRequirements } from "@/lib/session-requirements";
import { formatDurabilityForPrompt, selectDurabilityTemplate } from "@/lib/durability";
import { dedupeGeneration, generationKey } from "@/lib/generate-cache";
import { achievedTssForPeriod, addWeeks, chooseNextFocus, findUpcomingAEvent, formatFocusContext, formatFocusCoverageLine, formatRecoveryWeeks, formatRetestNote, formatSeasonContext, formatUpcomingEventsForBlock, periodForDate, planRecoveryWeeks, realWeeksSinceLastRecovery, replanEventArc, SEASON_SHAPES_GENERATION, settleSeasonHistory, validateBlockFocus, validateFocusMatch, validatePrimaryQualityCadence, validateSeasonFit } from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
import { latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";
import type { BlockParams, GeneratedPlan } from "@/lib/types";

// Generation calls take 1–2 minutes for a 4-week block.
export const maxDuration = 300;

function parseBlockParams(body: unknown): BlockParams | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const b = body as Record<string, unknown>;
  const lengthWeeks = b.lengthWeeks;
  if (lengthWeeks !== 2 && lengthWeeks !== 4 && lengthWeeks !== 6 && lengthWeeks !== 8) return "lengthWeeks must be 2, 4, 6 or 8.";
  const goal = typeof b.goal === "string" ? b.goal.trim() : "";
  if (!goal) return "goal is required.";
  const startDate = typeof b.startDate === "string" ? b.startDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) {
    return "startDate must be a valid YYYY-MM-DD date.";
  }
  const weakpoints = Array.isArray(b.weakpoints)
    ? b.weakpoints.filter((w): w is string => typeof w === "string" && w.trim() !== "")
    : [];
  return { lengthWeeks, goal, startDate, weakpoints };
}

export async function POST(req: Request) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Connect the AI coach to generate blocks." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const blockParams = parseBlockParams(body);
  if (typeof blockParams === "string") {
    return NextResponse.json({ error: blockParams }, { status: 400 });
  }
  const today = resolveToday((body as Record<string, unknown>)?.today);

  try {
    // Knowledge base is read fresh every call so manager edits apply immediately.
    const [profile, sync, kbContext, blockSettings, retroSeeds, scoreLog, physStore, interventionLog, baselines, currentBlock, blockHistory, quirks, existingSeason] = await Promise.all([
      readAthleteProfile(),
      readLastSync(),
      loadKnowledgeBaseContext(),
      readBlockSettings(),
      latestRetrospectiveSeeds(),
      readScoreLog(),
      readPhysiology(),
      readInterventionLog(),
      readRollingBaselines(),
      readCurrentBlock(),
      readBlockHistory(),
      readQuirks(),
      readSeasonPlan(),
    ]);

    // P2a (2026-07-24 block-generation redesign): verify the configured settings can jointly fit
    // inside a week BEFORE spending an LLM call on an impossible ask.
    const feasibilityConflict = checkBlockFeasibility(blockSettings);
    if (feasibilityConflict) {
      return NextResponse.json({ error: feasibilityConflict }, { status: 400 });
    }

    const weightTrend = (sync ? weightTrendFromWellness(sync.wellness) : null) ?? 0;
    const latestWeight =
      sync?.wellness
        .filter((w) => w.weightKg !== null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ??
      profile.performance.weightKg;

    const nutritionConfig: AthleteNutritionConfig = {
      baseCalories: profile.nutrition.baseCalories,
      restDayTarget: profile.nutrition.restDayTarget,
      buffer: profile.nutrition.buffer,
      weight: latestWeight,
      targetWeight: profile.nutrition.targetWeightKg,
    };
    const nutritionTable = nutritionTableMarkdown(
      buildNutritionReferenceRows(nutritionConfig, profile.performance.ftp, weightTrend)
    );

    const weeks = blockDates(blockParams.startDate, blockParams.lengthWeeks);

    // Seeds from the latest block retrospective markdown (athlete-editable in the
    // Knowledge Base). Edits to next_block_seeds flow directly into this block.
    const seedsContext = retroSeeds.length
      ? `\nPREVIOUS BLOCK PRIORITIES (carry forward into planning)\n${retroSeeds.map((s) => `- ${s}`).join("\n")}`
      : "";

    // Track D: the last block's structured reflections (the coach's own hypothesis→outcome notes,
    // typed on block-history) + recurring quirks mined from ride notes. Both are language-only hints;
    // the math/decisions stay deterministic above.
    // SUB-1: blockHistory is newest-first (appendBlockHistory prepends), but [0] can now be a discarded
    // or superseded block with no reflections — find the most recent entry that actually has them,
    // matching the robust pattern already used for the retrospective GET (app/api/retrospective/route.ts).
    const reflectionsContext = formatReflectionsForPrompt(
      blockHistory.find((h) => h.structuredReflections?.length)?.structuredReflections ?? []
    );
    const quirkContext = formatQuirksForPrompt(quirks.entries);

    // Track A: classify the power-curve shape into a rider type + auto-derived weak point ("easy win"),
    // injected as a hint that complements the manual weakpoints. Deterministic; the LLM only phrases it.
    // All-time best efforts give the truest read of what this rider is built for.
    const powerProfile = analyzePowerProfile(sync?.powerCurveAllTime ?? sync?.powerCurve ?? [], profile.performance.ftp, latestWeight);
    const powerProfileContext = formatPowerProfileForPrompt(powerProfile);

    // ONE synthesised coaching block: the athlete model's ranked insights (weak/under-
    // delivering/trending types, off-plan drift) folded together with each dimension's
    // validation track record — instead of three overlapping context blocks.
    const athleteModel = buildAthleteModel(scoreLog.entries);
    const insights = deriveInsights(athleteModel); // shared by directives + Track B durability selection
    const directivesContext = synthesizeCoachingDirectives(insights, summariseValidation(interventionLog));

    // Signal fusion (§5): hand the generator the one fused-state read so the block respects current
    // systemic state, not just per-dimension execution history.
    // Form/fuel/state signals via the shared resolver, so generation + Ask-Coach can't drift (CR-9);
    // the resolver owns the band resolution (RR-5).
    const signals = resolveCoachSignals(
      sync,
      athleteModel,
      baselines,
      blockSettings.acwrBands,
      blockSettings.athleteStateWeights,
      today,
      scoreLog.entries,
      profile.performance.ftp,
      latestWeeklyBalance(
        weeklyEnergy(sync?.activities ?? [], sync?.wellness ?? [], today, profile.nutrition),
        today
      )
    );
    const stateContext = signals.athleteState
      ? `\nCURRENT ATHLETE STATE (fused signal read — weight intensity/placement accordingly): ${signals.athleteState.headline} — state ${signals.athleteState.score}/100, recommendation: ${signals.athleteState.recommendation}.`
      : "";

    // Shared CoachSnapshot (ROADMAP #1): hand the planner the same resolved form + fuel numbers
    // Ask-Coach reads, so it can't invent current TSB/ACWR/readiness/fuel. State + directives are
    // already injected above; this adds only the compact resolved form/fuel line (today's single-ride
    // execution is intentionally omitted — generation plans forward).
    const snapshot = buildCoachSnapshot({
      date: today,
      ftp: profile.performance.ftp,
      block: null,
      todaySessionType: null,
      ...signals,
      todayAnalysis: null,
      directives: directivesContext,
      disposition: null,
      morningCheck: null,
      tsbModifierEdgesOverride: resolveTsbEdgesOverride(scoreLog.entries, blockSettings.tsbModifierEdges),
    });
    const formFuelLine = formatFormFuelLine(snapshot);
    const formFuelContext = formFuelLine ? `\n${formFuelLine}` : "";

    // Track B — deterministic session selection. A terrain/race goal requires ≥1 RaceSim (the line is
    // injected here and the floor is validated post-generation); durability rotates through templates
    // (limiter-driven from the athlete model, else rotated from the last block's stamp) so the long
    // ride trains a fresh fatigue-resistance mechanism each block.
    const requirements = deriveSessionRequirements(blockParams.goal, blockParams.weakpoints);
    const sessionReqLine = formatSessionRequirements(requirements);
    const sessionReqContext = sessionReqLine ? `\n${sessionReqLine}` : "";
    // HR-18 (still honored): one shared "everything the athlete has said" string, now assembled once
    // by gatherFocusInputs (season-continuous-focus-selection §6/§9) and reused by both durability
    // template selection and season focus selection below — keeps the two from ever drifting apart.
    const focusInputs = await gatherFocusInputs({ blockGoal: blockParams.goal, weakpoints: blockParams.weakpoints, today });
    const combinedGoalText = focusInputs.signals.goalText ?? "";
    const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null, combinedGoalText);
    // Carry-forward (CR-6): quality dropped mid-block with no make-up slot — re-prioritise it here.
    const deferredContext = currentBlock?.deferredQuality?.length
      ? `\nCARRY-FORWARD (quality the athlete had to drop last block with no make-up slot — re-prioritise): ${currentBlock.deferredQuality.join("; ")}.`
      : "";

    // Goals/Weakpoints centralization: the athlete's live, JSON-sourced goals/weakpoints — replaces the
    // now-stripped raw markdown copy (see stripGoalsWeakpointsSections) so generation never sees stale data.
    const goalsContext = profile.goals.length > 0
      ? `\nGOALS\n${profile.goals.map((g) => `- ${g.goal}${g.target ? ` → ${g.target}` : ""}`).join("\n")}`
      : "";
    const weakpointsContext = profile.weakpoints.length > 0
      ? `\nWEAKPOINTS TO ADDRESS\n${profile.weakpoints.map((w) => `- ${w.weakpoint}${w.detail ? `: ${w.detail}` : ""}`).join("\n")}`
      : "";

    // Season (season-continuous-focus-selection): rolling blocks get a fresh, stateless focus choice
    // every call (chooseNextFocus) instead of a drafted period sequence; a future A-event keeps the
    // existing persisted, backward-scheduled build→peak→taper arc. Best-effort — a failure here must
    // never block generation.
    let seasonContext = "";
    let recoveryContext = "";
    let upcomingEventsContext = "";
    let replannedSeason: import("@/lib/types").SeasonPlan | null = null;
    let rollingFocusChoice: import("@/lib/season").FocusChoice | null = null;
    let aEventForBlock: import("@/lib/types").SeasonEvent | null = null;
    // Tracked underneath the flag, same as season-plan.json itself (SEASON_SHAPES_GENERATION only
    // gates the prompt/validator OPINION, never the tracking). This must run unconditionally: it used
    // to sit inside the else of `if (aEventForBlock)` below, so an A-priority event on the calendar
    // silently skipped focus selection entirely — and with the flag off (today's state) that meant the
    // event arc was gated AND the rolling focus never ran, so seasonContext stayed "",
    // validateBlockFocus and validatePrimaryQualityCadence never fired, and GeneratedPlan.seasonFocus
    // was never stamped (degrading the NEXT block's no-back-to-back rule too). The old comment there
    // claimed this "always runs regardless of the flag" — true only of the branch it sat in.
    // Pure, and focusInputs is already resolved above, so it sits outside the season try/catch: a
    // throw here is a real failure worth a 502, not something to degrade past in silence.
    rollingFocusChoice = chooseNextFocus(focusInputs);

    // EC-3 / EC-12: these three computations depend ONLY on the score log, the rolling baselines and
    // this block's own params — never on season-plan.json. They used to live inside the try below, so
    // any throw in the season replan (e.g. a hand-edited malformed date making addWeeks' Date.parse
    // return NaN) silently produced a block with ZERO recovery weeks and no event callout, announced
    // by nothing but a server log. The pre-existing comment above computeWeekTargets claimed that
    // defaulting to [] "degrades safely" — it doesn't; [] is the silent failure. Hoisted so the
    // correct value survives a season-layer failure.
    const avgWeeklyTss = baselines.avgTss90d != null ? baselines.avgTss90d * 7 : null;
    const weeksSinceRecovery = realWeeksSinceLastRecovery(scoreLog.entries, avgWeeklyTss, today);
    const allRecoveryIndices = planRecoveryWeeks(weeksSinceRecovery, blockParams.lengthWeeks, !!(signals.loadRamp?.triggered));
    // Default to the UNFILTERED set: the event-arc branch below narrows it to base/build phases, but
    // if that branch throws we want the plain cadence answer, not none at all.
    let recoveryWeekIndices: number[] = allRecoveryIndices;

    const blockEndDate = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1];
    const upcomingEventsLine = formatUpcomingEventsForBlock(existingSeason.events, { startDate: blockParams.startDate, endDate: blockEndDate });
    if (upcomingEventsLine) upcomingEventsContext = `\n${upcomingEventsLine}`;

    // Athlete-visible record that the season layer degraded — folded into plan.warnings below.
    const seasonDegradedWarnings: string[] = [];

    try {
      const achievedTssFor = (p: import("@/lib/types").FocusPeriod) => achievedTssForPeriod(scoreLog.entries, p);
      aEventForBlock = findUpcomingAEvent(existingSeason.events, today);

      if (aEventForBlock) {
        replannedSeason = replanEventArc(
          existingSeason,
          aEventForBlock,
          {
            objective: existingSeason.objective, events: existingSeason.events,
            ctl: sync?.fitness.ctl ?? null, ftp: profile.performance.ftp,
            recentWeeklyTss: baselines.avgTss90d != null ? Math.round(baselines.avgTss90d * 7) : null,
            limiter: focusInputs.limiter, recentFocuses: [], heavyFatigue: !!(signals.loadRamp?.triggered),
          },
          achievedTssFor,
          today
        );
        // Peak/taper hold their own deliberate load-shaping — never overlay the generic recovery cap there.
        recoveryWeekIndices = allRecoveryIndices.filter((wk) => {
          const weekStart = addWeeks(blockParams.startDate, wk);
          const period = periodForDate(replannedSeason as import("@/lib/types").SeasonPlan, weekStart);
          return period ? period.phase === "build" || period.phase === "base" : true;
        });
      } else {
        replannedSeason = settleSeasonHistory(existingSeason, achievedTssFor, today);
        recoveryWeekIndices = allRecoveryIndices;
      }
      // HR-58: persistence is deferred until generation actually succeeds (see the updateSeasonPlan
      // call near the final return) — this used to write here unconditionally, so a generation that
      // then failed (or whose proposal the athlete never accepted) still left a phantom future-arc
      // redraft on season-plan.json.

      // P1 (2026-07-24 block-generation redesign): the flag now gates ONLY the doubted, event-
      // anchored fixed-phase arc (formatSeasonContext, backwardScheduleFromEvent's periods) — the
      // rolling, state-scored bundle (formatFocusContext/chooseNextFocus, formatRecoveryWeeks,
      // formatRetestNote below) is NOT the doubted model and always runs. See ROADMAP.md "Season
      // engine — known debt" for the full split rationale.
      if (SEASON_SHAPES_GENERATION && aEventForBlock) {
        const line = formatSeasonContext(replannedSeason, today, { startDate: blockParams.startDate, endDate: blockEndDate });
        if (line) seasonContext = `\n${line}`;
      } else if (rollingFocusChoice) {
        seasonContext = `\n${formatFocusContext(rollingFocusChoice, existingSeason.objective)}`;
        // P2c (2026-07-24 block-generation redesign): the chosen focus as a mandatory coverage
        // requirement, not just descriptive context — enforced post-generation by validateBlockFocus.
        const coverageLine = formatFocusCoverageLine(rollingFocusChoice.focus, profile.performance.ftp);
        if (coverageLine) seasonContext += `\n${coverageLine}`;
      }
    } catch (err) {
      logWarn("/api/generate", "season-replan", err instanceof Error ? err.message : String(err)); // best-effort
      seasonDegradedWarnings.push(
        "SEASON: the season layer failed to update for this block — recovery-week placement and the event callout still applied, but season phase tracking did not. Check data/season-plan.json for a malformed date."
      );
    }

    // Rendered after the try/catch, not inside it: by this point recoveryWeekIndices holds the
    // event-arc-filtered set if that branch ran, and the plain cadence set otherwise — including
    // after a throw. Computing it here means a season-plan failure loses the season PHASE text but
    // never the recovery-week instruction itself.
    const recoveryLine = formatRecoveryWeeks(
      recoveryWeekIndices,
      blockParams.lengthWeeks,
      rollingFocusChoice?.focus ?? "aerobic-base",
      profile.performance.ftp
    );
    if (recoveryLine) recoveryContext = `\n${recoveryLine}`;

    // Rendered here rather than beside selectDurabilityTemplate above, because the recovery-week
    // exception needs recoveryWeekIndices — the template is chosen per BLOCK but this line is injected
    // for every week, so without the carve-out template B tells the model to put threshold efforts in
    // the recovery week's long ride, contradicting formatRecoveryWeeks' own long-ride rule.
    const durabilityContext = `\n${formatDurabilityForPrompt(durability, recoveryWeekIndices.length > 0)}`;

    // P2b (2026-07-24 block-generation redesign): one exact hour figure per week — loading weeks
    // target the top of the configured range, recovery weeks (recoveryWeekIndices, computed above)
    // target a figure DERIVED from that loading target, not a fixed absolute band blind to it.
    // Computed outside the season try/catch: recoveryWeekIndices is now hoisted and correct-by-default
    // (EC-3/EC-12) even when the season replan throws, so this never silently sees an empty [].
    const weekTargets = computeWeekTargets(blockParams.lengthWeeks, blockSettings, recoveryWeekIndices);

    // Retest cadence: a stale tested FTP quietly rots zones and TSS math — nudge the generator to place
    // a retest in the next lighter week. Additive to seasonContext. Phase-agnostic (P1): always live.
    if (physStore) {
      const ftpStaleDays = Math.floor((Date.parse(today) - Date.parse(physStore.current.effectiveFrom)) / 86_400_000);
      const retestNote = formatRetestNote(Number.isFinite(ftpStaleDays) ? ftpStaleDays : null, recoveryWeekIndices, blockParams.startDate);
      if (retestNote) seasonContext += `\n${retestNote}`;
    }

    // Live training zones from the physiology store, rendered for the prompt (these used to
    // live in athlete_profile.md but are now synced from Intervals.icu).
    const fmtZoneRange = (z: Zone, unit: string) =>
      z.lo === 0 ? `< ${z.hi}${unit}` : z.hi === null ? `> ${z.lo}${unit}` : `${z.lo}–${z.hi}${unit}`;
    let zonesText = "";
    if (physStore) {
      const pz = resolvePowerZones(physStore.current);
      const hz = resolveHrZones(physStore.current);
      if (pz.length > 0) {
        const rows = pz.map((z, i) => {
          const hr = hz[i] ? `, HR ${fmtZoneRange(hz[i], " bpm")}` : "";
          return `- ${z.name}: ${fmtZoneRange(z, " W")}${hr}`;
        });
        zonesText = `TRAINING ZONES (live, from Intervals.icu — FTP ${physStore.current.ftp} W):\n${rows.join("\n")}`;
      }
    }

    // Split for prompt caching: the reference KB is the stable, cacheable prefix; the
    // per-block carry-forward seeds + synthesised directives go in the dynamic half so they
    // don't invalidate the cached prefix.
    const { cached, dynamic } = buildSystemPrompt(
      kbContext,
      seedsContext + reflectionsContext + stateContext + directivesContext + quirkContext + powerProfileContext + formFuelContext + sessionReqContext + durabilityContext + deferredContext + goalsContext + weakpointsContext + seasonContext + recoveryContext + upcomingEventsContext,
      buildAthleteDataSection(profile, sync, zonesText),
      blockParams
    );
    const userMessage = buildUserMessage(blockParams, weeks, nutritionTable, blockSettings, weekTargets);

    // Dedupe identical generations in a short window (P4): a double-click or a second request landing
    // mid-generation shares one Claude call instead of paying twice. A considered regenerate minutes
    // later falls outside the window and re-calls, so temperature-0.3 variation is preserved.
    const { result: genResult } = await dedupeGeneration(
      generationKey(cached, dynamic, userMessage),
      () => generateTrainingBlock(cached, dynamic, userMessage, blockParams.lengthWeeks)
    );
    const { toolInput, raw, truncated, stopReason } = genResult;

    // Structured-output path (P2): the generator runs on tool-use, so the plan must arrive as a
    // tool payload validated by the shared zod schema. The legacy regex text-parser fallback was
    // retired once structured output became the proven, sole path — a malformed/absent payload
    // now surfaces as a retryable error instead of silently degrading to text parsing.
    const parsedTool = toolInput != null ? PlanToolSchema.safeParse(toolInput) : null;
    if (!parsedTool?.success) {
      // A token-limit cutoff mid tool-call produces no usable toolInput at all — distinguish that
      // from a structurally-malformed-but-complete response so the athlete knows retrying (which
      // requests a length-scaled budget) is the fix, not a prompt/model problem.
      if (stopReason === "max_tokens") {
        throw new Error(
          `The generated ${blockParams.lengthWeeks}-week plan exceeded the response limit. Please retry; the app will request a larger response.`
        );
      }
      throw new Error(
        toolInput != null
          ? "The generated plan failed structured validation. Please retry."
          : "The model did not return a structured plan. Please retry."
      );
    }
    const { overview, days: rawDays } = structuredToPlannedDays(parsedTool.data);
    // HR-19 (2026-07-17 hostile review): make NodeVelo's own durationMin agree with the real
    // step-sum Intervals.icu will display, instead of only warning when they disagree — the
    // mismatch was shipping unchanged to the calendar and every hours total in the app.
    const reconciledDays = reconcileDurationMin(rawDays);
    // P3a (2026-07-24 block-generation redesign): the correct kcal figure is always known
    // (deterministic reference table) — auto-correct a mismatch instead of only flagging it.
    const nutritionRepair = repairNutrition(reconciledDays, nutritionConfig, profile.performance.ftp, weightTrend);
    const days = nutritionRepair.days;
    const warnings: string[] = [...seasonDegradedWarnings, ...nutritionRepair.repairs];
    const expected = weeks.flat();
    if (days.length !== expected.length) {
      warnings.push(`Expected ${expected.length} days, got ${days.length}.`);
    }

    // KB-grounded protocol check: flag any generated workout that contradicts the knowledge base
    // (e.g. SIT prescribed as 1-min efforts). Quality-session breaches are carried as a distinct,
    // higher-severity category (plan.protocolViolations); endurance-day durability-insert findings
    // stay ordinary warnings.
    const protocol = splitPlanProtocol(days, profile.performance.ftp, resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope));
    warnings.push(...protocol.advisories);
    // Placement check (P5): the protocol check validates each session in isolation; this flags
    // where they land — back-to-back hard days and any week over the quality budget.
    warnings.push(...validateSchedule(days, blockSettings, profile.performance.ftp, weekTargets, existingSeason.events));
    // Event taper (P4, 2026-07-24): a lightweight check for priority-B/C events inside this block —
    // no quality session in the final 2 days before the event, and no more than 1 other quality
    // session that week. A-priority events are excluded (they get the full backward-scheduled arc).
    warnings.push(...validateEventTaper(days, existingSeason.events, profile.performance.ftp, blockSettings));
    // Hours check (P2b, 2026-07-24): did each week's actual total land near its exact skeleton
    // target — the check that was missing entirely (only session counts/spacing were validated).
    warnings.push(...validateWeekHours(days, weekTargets));
    // The composition half of the recovery contract — validateWeekHours only checks volume.
    warnings.push(...validateRecoveryWeekDensity(days, weekTargets, blockSettings, profile.performance.ftp, existingSeason.events));
    // Sequencing check (P5b, 2026-07-24): freshness-dependent quality (VO2max/SIT) should land
    // earlier in the week than fatigue-tolerant quality (Threshold/RaceSim).
    warnings.push(...validateWeekSequencing(days));
    // Track B: enforce the goal-driven session requirement (terrain/race goal ⇒ ≥1 RaceSim).
    warnings.push(...validateSessionRequirements(days, requirements));
    // Season fit (event-anchored) / block focus (rolling): flag intensity or focus-label disagreement
    // vs the active season structure. Only when the season re-plan above succeeded. P1 (2026-07-24):
    // the event-anchored pair stays behind the doubted-model flag; block-focus (rolling, state-scored)
    // is not that model and always runs.
    if (replannedSeason) {
      if (SEASON_SHAPES_GENERATION && aEventForBlock) {
        warnings.push(...validateSeasonFit(days, replannedSeason, profile.performance.ftp));
        warnings.push(...validateFocusMatch(days, replannedSeason, profile.performance.ftp));
      } else if (rollingFocusChoice) {
        warnings.push(...validateBlockFocus(days, rollingFocusChoice.focus, profile.performance.ftp));
        // P5a (2026-07-24): stricter than the block-wide floor above — the primary quality must
        // appear in EVERY loading week, not just once somewhere in the block.
        warnings.push(...validatePrimaryQualityCadence(days, rollingFocusChoice.focus, weekTargets, profile.performance.ftp));
      }
    }
    if (truncated) {
      warnings.unshift("The AI response hit the token limit and may be incomplete.");
    }

    // Narrative-coherence critic (P3c, 2026-07-24): a cheap follow-up check that the written overview
    // actually matches the generated schedule (the "escalate SIT" contradiction the reviewed block
    // shipped, and the "4-hour ride" mis-description a live smoke test caught) — only ever corrects
    // the overview string, never the schedule. Skipped for a truncated/incomplete block: there's
    // already a bigger, known problem to fix first. Best-effort — never blocks the response.
    let finalOverview = overview;
    if (!truncated && days.length === expected.length) {
      const critic = await critiqueOverview(overview, extractBlockFacts(days, weekTargets));
      if (critic && !critic.accurate) {
        finalOverview = critic.overview;
        warnings.push("Overview auto-corrected: the written summary didn't match the generated schedule.");
      }
    }

    // Audit trail: store the structured tool JSON when present, else the raw text.
    const rawForAudit = toolInput != null ? JSON.stringify(toolInput, null, 2) : raw;
    const plan: GeneratedPlan = {
      overview: finalOverview,
      days,
      warnings,
      ...(protocol.violations.length > 0 ? { protocolViolations: protocol.violations } : {}),
      raw: rawForAudit,
      blockParams,
      model: GENERATION_MODEL,
      promptVersion: PROMPT_VERSION,
      durabilityTemplate: durability.id, // Track B: stamp the template for rotation + future scoring
      ...(rollingFocusChoice ? { seasonFocus: rollingFocusChoice.focus, seasonFocusRationale: rollingFocusChoice.rationale } : {}),
    };

    // HR-58: persist the season re-plan/settle only now that generation actually succeeded — never
    // for a proposal that failed or was discarded. CAS-guarded on the `updatedAt` this route's own
    // `existingSeason` read saw: if a concurrent Season-form save (PUT /api/season) landed since, the
    // live value has moved on and this stale-derived mutation is skipped rather than silently
    // clobbering it. Best-effort, same as the re-plan computation above — never fails the response.
    const seasonToPersist = replannedSeason;
    if (seasonToPersist) {
      try {
        await updateSeasonPlan(() => seasonToPersist, existingSeason.updatedAt);
      } catch (err) {
        logWarn("/api/generate", "season-persist", err instanceof Error ? err.message : String(err));
      }
    }

    return NextResponse.json({ plan });
  } catch (err) {
    logError("/api/generate", "generate", err);
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
