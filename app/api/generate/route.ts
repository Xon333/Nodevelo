import { NextResponse } from "next/server";
import {
  blockDates,
  buildAthleteDataSection,
  buildSystemPrompt,
  buildUserMessage,
  generateTrainingBlock,
  GENERATION_MODEL,
  isAnthropicConfigured,
  PROMPT_VERSION,
} from "@/lib/anthropic-api";
import { readAthleteProfile, readBlockSettings, readCurrentBlock, readInterventionLog, readLastSync, readRollingBaselines, readScoreLog } from "@/lib/data-store";
import { latestRetrospectiveSeeds, loadKnowledgeBaseContext } from "@/lib/kb-loader";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { summariseValidation } from "@/lib/intervention";
import { synthesizeCoachingDirectives } from "@/lib/synthesis";
import { computeAcwr, computeLoadRamp, computeReadiness } from "@/lib/readiness";
import { resolveAcwrBands } from "@/lib/calibration";
import { buildCoachSnapshot, formatFormFuelLine } from "@/lib/coach-snapshot";
import { athleteStateInputsFrom, computeAthleteState } from "@/lib/athlete-state";
import type { Zone } from "@/lib/zones";
import {
  buildNutritionReferenceRows,
  nutritionTableMarkdown,
  weightTrendFromWellness,
  type AthleteNutritionConfig,
} from "@/lib/nutrition";
import { PlanToolSchema, structuredToPlannedDays } from "@/lib/plan-schema";
import { validatePlanProtocol } from "@/lib/workout-validate";
import { validateSchedule } from "@/lib/schedule-validate";
import { deriveSessionRequirements, formatSessionRequirements, validateSessionRequirements } from "@/lib/session-requirements";
import { formatDurabilityForPrompt, selectDurabilityTemplate } from "@/lib/durability";
import { dedupeGeneration, generationKey } from "@/lib/generate-cache";
import type { BlockParams, GeneratedPlan } from "@/lib/types";

// Generation calls take 1–2 minutes for a 4-week block.
export const maxDuration = 300;

function parseBlockParams(body: unknown): BlockParams | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const b = body as Record<string, unknown>;
  const lengthWeeks = b.lengthWeeks;
  if (lengthWeeks !== 2 && lengthWeeks !== 4) return "lengthWeeks must be 2 or 4.";
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
      { error: "Anthropic API is not configured. Set ANTHROPIC_API_KEY in .env.local." },
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

  try {
    // Knowledge base is read fresh every call so manager edits apply immediately.
    const [profile, sync, kbContext, blockSettings, retroSeeds, scoreLog, physStore, interventionLog, baselines, currentBlock] = await Promise.all([
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
    ]);

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

    // ONE synthesised coaching block: the athlete model's ranked insights (weak/under-
    // delivering/trending types, off-plan drift) folded together with each dimension's
    // validation track record — instead of three overlapping context blocks.
    const athleteModel = buildAthleteModel(scoreLog.entries);
    const insights = deriveInsights(athleteModel); // shared by directives + Track B durability selection
    const directivesContext = synthesizeCoachingDirectives(insights, summariseValidation(interventionLog));

    // Signal fusion (§5): hand the generator the one fused-state read so the block respects current
    // systemic state, not just per-dimension execution history.
    const acwr = sync ? computeAcwr(sync.activities, resolveAcwrBands(blockSettings.acwrBands)) : null;
    const athleteState = computeAthleteState(athleteStateInputsFrom(sync, athleteModel, baselines, acwr));
    const stateContext = athleteState
      ? `\nCURRENT ATHLETE STATE (fused signal read — weight intensity/placement accordingly): ${athleteState.headline} — state ${athleteState.score}/100, recommendation: ${athleteState.recommendation}.`
      : "";

    // Shared CoachSnapshot (ROADMAP #1): hand the planner the same resolved form + fuel numbers
    // Ask-Coach reads, so it can't invent current TSB/ACWR/readiness/fuel. State + directives are
    // already injected above; this adds only the compact resolved form/fuel line (today's single-ride
    // execution is intentionally omitted — generation plans forward).
    const snapshot = buildCoachSnapshot({
      date: new Date().toISOString().slice(0, 10),
      ftp: profile.performance.ftp,
      block: null,
      todaySessionType: null,
      fitness: sync?.fitness ?? null,
      readiness: sync ? computeReadiness(sync.fitness, sync.wellness) : null,
      acwr,
      loadRamp: sync ? computeLoadRamp(sync.activities) : null,
      athleteState,
      todayAnalysis: null,
      weightTrend7dKg: sync ? weightTrendFromWellness(sync.wellness) : null,
      directives: directivesContext,
      disposition: null,
      morningCheck: null,
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
    const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null);
    const durabilityContext = `\n${formatDurabilityForPrompt(durability)}`;

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
      seedsContext + stateContext + directivesContext + formFuelContext + sessionReqContext + durabilityContext,
      buildAthleteDataSection(profile, sync, zonesText),
      blockParams
    );
    const userMessage = buildUserMessage(blockParams, weeks, nutritionTable, blockSettings);

    // Dedupe identical generations in a short window (P4): a double-click or a second request landing
    // mid-generation shares one Claude call instead of paying twice. A considered regenerate minutes
    // later falls outside the window and re-calls, so temperature-0.3 variation is preserved.
    const { result: genResult } = await dedupeGeneration(
      generationKey(cached, dynamic, userMessage),
      () => generateTrainingBlock(cached, dynamic, userMessage)
    );
    const { toolInput, raw, truncated } = genResult;

    // Structured-output path (P2): the generator runs on tool-use, so the plan must arrive as a
    // tool payload validated by the shared zod schema. The legacy regex text-parser fallback was
    // retired once structured output became the proven, sole path — a malformed/absent payload
    // now surfaces as a retryable error instead of silently degrading to text parsing.
    const parsedTool = toolInput != null ? PlanToolSchema.safeParse(toolInput) : null;
    if (!parsedTool?.success) {
      throw new Error(
        toolInput != null
          ? "The generated plan failed structured validation. Please retry."
          : "The model did not return a structured plan. Please retry."
      );
    }
    const { overview, days } = structuredToPlannedDays(parsedTool.data);
    const warnings: string[] = [];
    const expected = weeks.flat();
    if (days.length !== expected.length) {
      warnings.push(`Expected ${expected.length} days, got ${days.length}.`);
    }

    // KB-grounded protocol check: flag any generated workout that contradicts the knowledge
    // base (e.g. SIT prescribed as 1-min efforts, threshold pushed into VO2max territory) so
    // the plan and the live session can't describe different things.
    warnings.push(...validatePlanProtocol(days, profile.performance.ftp));
    // Placement check (P5): the protocol check validates each session in isolation; this flags
    // where they land — back-to-back hard days and any week over the quality budget.
    warnings.push(...validateSchedule(days, blockSettings, profile.performance.ftp));
    // Track B: enforce the goal-driven session requirement (terrain/race goal ⇒ ≥1 RaceSim).
    warnings.push(...validateSessionRequirements(days, requirements));
    if (truncated) {
      warnings.unshift("The AI response hit the token limit and may be incomplete.");
    }

    // Audit trail: store the structured tool JSON when present, else the raw text.
    const rawForAudit = toolInput != null ? JSON.stringify(toolInput, null, 2) : raw;
    const plan: GeneratedPlan = {
      overview,
      days,
      warnings,
      raw: rawForAudit,
      blockParams,
      model: GENERATION_MODEL,
      promptVersion: PROMPT_VERSION,
      durabilityTemplate: durability.id, // Track B: stamp the template for rotation + future scoring
    };
    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
