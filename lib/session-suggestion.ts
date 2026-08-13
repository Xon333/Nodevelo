// Phase 3a §9. Readiness/spacing gates run FIRST and read only .level fields — never
// computeLoadRamp's/computeAcwr's .reason text, which carries injury-risk wording the original design's
// §15 non-goal forbids in this app's own voice.
import { FOCUS_LABELS, chooseNextFocus } from "./season";
import { gatherFocusInputs } from "./season-signals";
import type {
  AcwrResult,
  CurrentBlock,
  IntentOverlay,
  LoadRampAlert,
  ReadinessSignal,
  RideScoreEntry,
  SeasonFocus,
  SessionSuggestion,
  WeeklyEnvelope,
} from "./types";

// Coarse duration/structure template per focus — deliberately simple (§9: "a duration/intensity dose
// that fits the weekly envelope" is priority 5 of 5, after the harder gates). Not the block generator's
// job to author real interval content here; this is a suggestion, never a plan.
const FOCUS_SESSION_TEMPLATE: Record<
  SeasonFocus,
  { structure: string; durationRangeMin: [number, number]; ifEstimate: number }
> = {
  "aerobic-base": { structure: "mostly Z2, controlled climbing optional", durationRangeMin: [90, 120], ifEstimate: 0.65 },
  threshold: { structure: "steady threshold intervals", durationRangeMin: [60, 90], ifEstimate: 0.85 },
  vo2max: { structure: "short high-intensity intervals", durationRangeMin: [45, 75], ifEstimate: 0.9 },
  anaerobic: { structure: "short maximal efforts, full recovery between", durationRangeMin: [45, 60], ifEstimate: 0.8 },
  durability: { structure: "long ride with embedded efforts late", durationRangeMin: [150, 210], ifEstimate: 0.7 },
  sharpen: { structure: "race-pace openers", durationRangeMin: [45, 60], ifEstimate: 0.85 },
};

function expectedTss(durationMin: number, ifEstimate: number): number {
  return Math.round((durationMin / 60) * ifEstimate * ifEstimate * 100);
}

// A dedicated low-dose template, used only for the above-range case — never the block generator's job,
// never a full recovery-day plan, just this suggestion's own concrete option.
const RECOVERY_TEMPLATE = {
  structure: "easy spin, conversational pace",
  durationRangeMin: [30, 45] as [number, number],
  ifEstimate: 0.55,
};

export async function suggestSession(
  today: string,
  envelope: WeeklyEnvelope,
  weekToDateTss: number,
  readiness: ReadinessSignal,
  loadRamp: LoadRampAlert,
  acwr: AcwrResult | null,
  // The caller (a sync handler) already has these this request — pass them through so
  // gatherFocusInputs doesn't re-read current-block/score-log/intent-overlays from disk.
  preloaded?: { currentBlock?: CurrentBlock | null; scoreEntries?: RideScoreEntry[]; overlays?: IntentOverlay[] }
): Promise<SessionSuggestion | null> {
  // Gate 1: readiness. Never suggest pushing through a Recover read.
  if (readiness.level === "Recover") return null;

  // Gate 0b: no tolerated week has ever been found, so the envelope has no real range yet (resolves to
  // 0-0 — see resolveWeeklyEnvelope's own "nothing to say yet, not reduce to zero" precedent). Nothing
  // to suggest a session against, and NOT the same as "already at the top of the range."
  if (envelope.range.max === 0) return null;

  // Gate 2: the envelope's own range vs. completed-load-to-date. Design §9: "above range: prefer
  // recovery/low load without calling the week a failure" — a distinct THIRD case, not folded into the
  // Recover gate above and not treated as a normal-dose suggestion either.
  if (weekToDateTss >= envelope.range.max) {
    const t = RECOVERY_TEMPLATE;
    return {
      purpose: "Easy recovery spin",
      structure: t.structure,
      durationRangeMin: t.durationRangeMin,
      expectedTssRange: [
        expectedTss(t.durationRangeMin[0], t.ifEstimate),
        expectedTss(t.durationRangeMin[1], t.ifEstimate),
      ],
      reason: `This week's load is already at the top of the ${envelope.range.min}-${envelope.range.max} range — an easy spin keeps the legs moving without adding to it.`,
    };
  }

  // Gate 3: hard-session spacing. A high load-ramp level or a danger-band ACWR level trims the dose
  // rather than compounding — read levels only, never computeLoadRamp's/computeAcwr's .reason text.
  const spacingCaution = loadRamp.level === "high" || acwr?.level === "danger";

  // today threaded through explicitly — gatherFocusInputs' own fallback (no today) is server UTC, which
  // would silently diverge from the client-supplied sync date this whole call chain is anchored to.
  const inputs = await gatherFocusInputs({ today, preloaded });
  const choice = chooseNextFocus(inputs);
  const template = FOCUS_SESSION_TEMPLATE[choice.focus];

  const [minDur, maxDur] = spacingCaution
    ? [template.durationRangeMin[0], Math.round(template.durationRangeMin[0] * 1.15)]
    : template.durationRangeMin;
  const expectedMin = expectedTss(minDur, template.ifEstimate);
  const expectedMax = expectedTss(maxDur, template.ifEstimate);

  // Below-range (design §9: "never a desperate catch-up ride") needs no special branch — nothing here
  // references how far below range the week is, which is the point.
  const reason = spacingCaution
    ? `Recent load has ramped quickly — ${FOCUS_LABELS[choice.focus]} at a controlled dose fits better than pushing another hard day.`
    : choice.rationale;

  return {
    purpose: FOCUS_LABELS[choice.focus],
    structure: template.structure,
    durationRangeMin: [minDur, maxDur],
    expectedTssRange: [expectedMin, expectedMax],
    reason,
  };
}
