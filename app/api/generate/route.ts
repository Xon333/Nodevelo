import { NextResponse } from "next/server";
import {
  blockDates,
  buildAthleteDataSection,
  buildSystemPrompt,
  buildUserMessage,
  generateTrainingBlock,
  isAnthropicConfigured,
} from "@/lib/anthropic-api";
import { readAthleteProfile, readBlockSettings, readComplianceMemory, readLastSync, readScoreLog } from "@/lib/data-store";
import { latestRetrospectiveSeeds, loadKnowledgeBaseContext } from "@/lib/kb-loader";
import { readPhysiology, resolveHrZones, resolvePowerZones } from "@/lib/physiology";
import { buildAthleteModel, deriveInsights, insightsToPromptBlock } from "@/lib/athlete-model";
import type { Zone } from "@/lib/zones";
import {
  buildNutritionReferenceRows,
  nutritionTableMarkdown,
  weightTrendFromWellness,
  type AthleteNutritionConfig,
} from "@/lib/nutrition";
import { parsePlan } from "@/lib/plan-parser";
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
    const [profile, sync, kbContext, blockSettings, complianceMemory, retroSeeds, scoreLog, physStore] = await Promise.all([
      readAthleteProfile(),
      readLastSync(),
      loadKnowledgeBaseContext(),
      readBlockSettings(),
      readComplianceMemory(),
      latestRetrospectiveSeeds(),
      readScoreLog(),
      readPhysiology(),
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

    // Compliance annotations for types with ≥3 sessions of history.
    const complianceLines: string[] = [];
    for (const [type, entry] of Object.entries(complianceMemory.byType)) {
      if (!entry || entry.sessions < 3) continue;
      const pct = entry.avgCompliancePct;
      if (pct < 80) complianceLines.push(`- ${type}: ${pct}% avg compliance (${entry.sessions} sessions) — athlete consistently under-delivers; reduce frequency or duration`);
      else if (pct >= 95) complianceLines.push(`- ${type}: ${pct}% avg compliance — athlete executes these well`);
    }
    const complianceContext = complianceLines.length
      ? `\nCOMPLIANCE HISTORY (from logged sessions)\n${complianceLines.join("\n")}`
      : "";

    // Seeds from the latest block retrospective markdown (athlete-editable in the
    // Knowledge Base). Edits to next_block_seeds flow directly into this block.
    const seedsContext = retroSeeds.length
      ? `\nPREVIOUS BLOCK PRIORITIES (carry forward into planning)\n${retroSeeds.map((s) => `- ${s}`).join("\n")}`
      : "";

    // Learned patterns: the athlete model turns the execution history into concrete
    // directives (weak types, declining trends, ready-to-progress) for this block.
    const insightsContext = insightsToPromptBlock(deriveInsights(buildAthleteModel(scoreLog.entries)));

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

    const system = buildSystemPrompt(
      kbContext + complianceContext + seedsContext + insightsContext,
      buildAthleteDataSection(profile, sync, zonesText),
      blockParams
    );
    const userMessage = buildUserMessage(blockParams, weeks, nutritionTable, blockSettings);

    const { raw, truncated } = await generateTrainingBlock(system, userMessage);
    const { overview, days, warnings } = parsePlan(raw, weeks.flat());
    if (truncated) {
      warnings.unshift("The AI response hit the token limit and may be incomplete.");
    }

    const plan: GeneratedPlan = { overview, days, warnings, raw, blockParams };
    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
