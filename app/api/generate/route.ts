import { NextResponse } from "next/server";
import {
  blockDates,
  buildAthleteDataSection,
  buildSystemPrompt,
  buildUserMessage,
  generateTrainingBlock,
  isAnthropicConfigured,
} from "@/lib/anthropic-api";
import { readAthleteProfile, readBlockSettings, readInterventionLog, readLastSync, readScoreLog } from "@/lib/data-store";
import { latestRetrospectiveSeeds, loadKnowledgeBaseContext } from "@/lib/kb-loader";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { summariseValidation } from "@/lib/intervention";
import { synthesizeCoachingDirectives } from "@/lib/synthesis";
import type { Zone } from "@/lib/zones";
import {
  buildNutritionReferenceRows,
  nutritionTableMarkdown,
  weightTrendFromWellness,
  type AthleteNutritionConfig,
} from "@/lib/nutrition";
import { parsePlan } from "@/lib/plan-parser";
import { PlanToolSchema, structuredToPlannedDays } from "@/lib/plan-schema";
import { validatePlanProtocol } from "@/lib/workout-validate";
import type { BlockParams, GeneratedPlan, PlannedDay } from "@/lib/types";

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
    const [profile, sync, kbContext, blockSettings, retroSeeds, scoreLog, physStore, interventionLog] = await Promise.all([
      readAthleteProfile(),
      readLastSync(),
      loadKnowledgeBaseContext(),
      readBlockSettings(),
      latestRetrospectiveSeeds(),
      readScoreLog(),
      readPhysiology(),
      readInterventionLog(),
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
    const directivesContext = synthesizeCoachingDirectives(
      deriveInsights(buildAthleteModel(scoreLog.entries)),
      summariseValidation(interventionLog)
    );

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
      seedsContext + directivesContext,
      buildAthleteDataSection(profile, sync, zonesText),
      blockParams
    );
    const userMessage = buildUserMessage(blockParams, weeks, nutritionTable, blockSettings);

    const { toolInput, raw, truncated } = await generateTrainingBlock(cached, dynamic, userMessage);

    // Structured-output path (P2): validate Claude's tool payload with the shared zod schema.
    // Fall back to the regex parser on the text only if the tool output is absent/malformed.
    let overview: string;
    let days: PlannedDay[];
    let warnings: string[];
    const parsedTool = toolInput != null ? PlanToolSchema.safeParse(toolInput) : null;
    if (parsedTool?.success) {
      ({ overview, days } = structuredToPlannedDays(parsedTool.data));
      warnings = [];
      const expected = weeks.flat();
      if (days.length !== expected.length) {
        warnings.push(`Expected ${expected.length} days, got ${days.length}.`);
      }
    } else {
      ({ overview, days, warnings } = parsePlan(raw, weeks.flat()));
      if (toolInput != null) warnings.unshift("Structured tool output failed validation — fell back to text parsing.");
    }

    // KB-grounded protocol check: flag any generated workout that contradicts the knowledge
    // base (e.g. SIT prescribed as 1-min efforts, threshold pushed into VO2max territory) so
    // the plan and the live session can't describe different things.
    warnings.push(...validatePlanProtocol(days, profile.performance.ftp));
    if (truncated) {
      warnings.unshift("The AI response hit the token limit and may be incomplete.");
    }

    // Audit trail: store the structured tool JSON when present, else the raw text.
    const rawForAudit = toolInput != null ? JSON.stringify(toolInput, null, 2) : raw;
    const plan: GeneratedPlan = { overview, days, warnings, raw: rawForAudit, blockParams };
    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
