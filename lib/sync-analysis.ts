// The one LLM step of a sync, split out so /api/sync can return fast with the deterministic
// analysis (metrics, zones, intervals, PRs, execution score) and the coach note is filled in by a
// follow-up /api/analyze call. Idempotent: only runs when today's analysis has no note yet, so a
// re-sync never wipes a generated note and the auto-post fires exactly once.

import { analyseRide, buildRideAnalysisInput, GENERATION_MODEL, isAnthropicConfigured, PROMPT_VERSION } from "./anthropic-api";
import { createEvent } from "./intervals-api";
import { indexOverlaysByActivity } from "./intent-overlay";
import {
  readAthleteProfile,
  readBlockSettings,
  readCurrentBlock,
  readIntentOverlays,
  readLastSync,
  readTodayAnalysis,
  writeTodayAnalysis,
} from "./data-store";
import type { FuelPrompt } from "./fuel-prompt";
import type { TodayAnalysis } from "./types";

// Format the deterministic fuelPrompt (lib/fuel-prompt.ts) into the one-line context the coach-note
// prompt may mention verbatim — the LLM phrases, it never computes. Numbers only, straight from the
// already-derived FuelPrompt; no new calculation happens here.
export function formatFuelPromptContext(fuelPrompt: FuelPrompt): string {
  if (fuelPrompt.kind === "log-nudge") {
    const h = Math.floor(fuelPrompt.durationMin / 60);
    const m = fuelPrompt.durationMin % 60;
    const duration = h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
    return `FUEL PROMPT: rode ${duration} with no carbs logged — remind to log in-ride carbs in Intervals.icu`;
  }
  return `FUEL PROMPT: logged ${fuelPrompt.loggedGPerH} g/h vs derived optimum ${fuelPrompt.optimumGPerH} g/h`;
}

// `force` re-runs even when a note already exists — used by the manual re-analyse action so an
// athlete can retry after an Anthropic hiccup without waiting for the next full sync. The default
// (false) keeps the sync path idempotent: a re-sync never re-pays for a note it already has.
export async function addCoachNote(
  today: string,
  warnings: string[],
  force = false
): Promise<TodayAnalysis | null> {
  const analysis = await readTodayAnalysis();
  if (!analysis || analysis.activityDate !== today) return analysis ?? null; // nothing to analyse today
  if (analysis.coachNote && !force) return analysis; // already generated — idempotent
  if (!isAnthropicConfigured()) return analysis;

  try {
    const [lastSync, currentBlock, profile, intentOverlays] = await Promise.all([
      readLastSync(),
      readCurrentBlock(),
      readAthleteProfile(),
      readIntentOverlays(),
    ]);
    const todayActivity = lastSync?.activities.find(
      (a) => a.date === today && (a.type === "Ride" || a.type === "VirtualRide")
    );
    if (!todayActivity) return analysis;
    const plannedDay = currentBlock?.days.find((d) => d.date === today && d.durationMin > 0) ?? null;

    // Rebuild the analysis input from the raw activity + the deterministic fields the fast path
    // already computed and stored on `analysis` (zones, interval comparison, PRs).
    const input = buildRideAnalysisInput(
      todayActivity,
      plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
      profile.performance.ftp,
      profile.performance.thresholdHr
    );
    // NV-1 (2026-08-15): the split-brain debrief. Coach prose used to read the raw note independently
    // of the intent parser's own verdict on that same note — so a rejected/unparseable note could
    // still produce a confident, prose-only intent-execution judgment sitting right next to the
    // debrief card's "Not scored — the ride note couldn't be parsed." SyncProvider now runs the intent
    // loop to completion before this ever fires, so today's overlay (if the note needed parsing) is
    // already resolved here. Locked product decision: on a genuine parse failure, withhold the note
    // from the prompt entirely — metric-level commentary only, same as a ride with no note at all. The
    // athlete's raw note text stays visible elsewhere on the page (the debrief's own "Your note" card);
    // this only gates what the PROSE prompt is allowed to read.
    const todayOverlay = indexOverlaysByActivity(intentOverlays.overlays).get(todayActivity.id);
    if (todayOverlay?.notScoredReason === "interpreter-failed") {
      input.activityDescription = null;
    }
    // Truthy-checked, never `!== null`: an overlay JSON written before effectiveExecutionScore existed
    // parses the key back as `undefined`, and `undefined !== null` is true — which would render
    // "DETERMINISTIC INTENT: undefined/10" into the billed prompt (the exact migration-flag trap in
    // AGENTS.md). Safe as a truthy check because buildOverlay clamps every score to 1-10; 0 is
    // unrepresentable (lib/intent-scoring.ts).
    if (todayOverlay?.effectiveExecutionScore && todayOverlay?.interpretation) {
      const evidence = todayOverlay.interpretation.objectives
        .filter((objective) => objective.scored && objective.evidence)
        .map((objective) => objective.evidence)
        .join("; ");
      input.intentContext = `DETERMINISTIC INTENT: ${todayOverlay.effectiveExecutionScore}/10${evidence ? ` — ${evidence}` : ""}`;
    }
    input.powerZoneTimes = analysis.powerZoneTimes;
    input.hrZoneTimes = analysis.hrZoneTimes;
    input.intervalComparison = analysis.intervalComparison;
    input.powerPRs = analysis.powerPRs;
    // The HR-judged easy-ride read the scorer applied (Z2/Recovery, on-plan only) — the note must
    // judge "was it easy" on this, not re-derive a power-based zone-creep verdict. `?? null` because
    // an analysis written before the field existed parses back with the key absent.
    input.aerobicDiscipline = analysis.aerobicDiscipline ?? null;
    // The aerobic-efficiency-vs-baseline figure behind the discipline read above — same `?? null`
    // normalization: an analysis written before this field existed parses back with the key absent.
    input.aerobicEffPct = analysis.aerobicEffPct ?? null;
    // Truthy-checked (never `=== null`): a today-analysis.json written before fuelPrompt existed
    // parses back with the key absent, not null.
    input.fuelPromptContext = analysis.fuelPrompt ? formatFuelPromptContext(analysis.fuelPrompt) : null;

    // NV-8 (2026-08-15): analyseRide used to return a bare string, discarding stop_reason entirely —
    // a token-limit cutoff mid-sentence was indistinguishable from a genuinely finished note. Mirrors
    // the generate route's own truncated/stopReason handling (app/api/generate/route.ts): a transient
    // warning, never a persisted field — the note is still usable (prose degrades gracefully, unlike a
    // truncated JSON tool payload), so this doesn't block writing it.
    const { text: coachNote, truncated } = await analyseRide(input);
    if (truncated) {
      warnings.push("Your coach note hit the token limit and may be incomplete.");
    }
    const updated: TodayAnalysis = {
      ...analysis,
      coachNote,
      analysedAt: new Date().toISOString(),
      // Stamp the note's provenance only when one was actually produced; an empty result leaves
      // the analysis unstamped so the next sync/re-analyse retries cleanly.
      ...(coachNote ? { model: GENERATION_MODEL, promptVersion: PROMPT_VERSION } : {}),
    };
    await writeTodayAnalysis(updated);

    // Auto-post to Intervals.icu once, if opted in. (Runs only on first note generation because of
    // the coachNote-empty guard above, so it can't double-post on a re-sync.)
    if (coachNote) {
      const settings = await readBlockSettings();
      if (settings.autoPostCoachNote) {
        // A prescribed ride's ledger score is never displaced by an overlay (decision #14) — safe to
        // post as-is. An unplanned ride may acquire a different Phase 2b overlay-resolved score after
        // /api/analyze runs, so post nothing rather than a number the in-app debrief may disagree with.
        const scoreLine =
          plannedDay && updated.executionScore !== null ? `\nExecution score: ${updated.executionScore}/10` : "";
        await createEvent({
          category: "NOTE",
          start_date_local: `${today}T00:00:00`,
          name: "Coach analysis",
          description: `[Nodevelo coach] ${updated.activityName}${scoreLine}\n\n${coachNote.trim()}`,
        }).catch(() => {}); // best-effort write-back
      }
    }
    return updated;
  } catch (e) {
    warnings.push(`Coach note generation failed: ${e instanceof Error ? e.message : String(e)}`);
    return analysis;
  }
}
