// Synthesises the learned coaching signals into ONE ranked, deduped directive block for block
// generation — instead of piping several overlapping context blocks (insights + validation +
// compliance) that the model has to reconcile. Insights are already severity-ranked and capped;
// here we fold in each dimension's validation track record so the model knows which of its own past
// nudges actually worked — and DEMOTE a directive whose past nudges have a proven-poor track record
// (ROADMAP #4: the validation loop should ACT, not just annotate). Pure + deterministic.

import type { Insight, ValidationSummary } from "./types";

// A directive is demoted only when its dimension has BOTH enough decisive (validated|refuted)
// verdicts to trust the signal AND a hit-rate at/below the floor — one noisy 28-day window must not
// bury a directive. Population defaults now; a ROADMAP #2 per-athlete calibration hook later (taken
// as a defaulted param, same derive-with-fallback shape as FTP_RETEST_DEFAULTS / resolveAcwrBands).
export interface DirectiveDemoteConfig {
  minDecisive: number; // matured validated|refuted verdicts required before a track record can demote
  demoteHitRateMax: number; // hit-rate (validated/decisive) at or below which the directive is demoted
}
export const DIRECTIVE_DEMOTE_DEFAULTS: DirectiveDemoteConfig = {
  minDecisive: 3, // ≥3 decisive blocks — one bad 28-day window isn't proof the nudge is wrong
  demoteHitRateMax: 0.34, // ≤34% ≈ refuted outnumbers validated ~2:1 — a real "this isn't working" signal
};

export function synthesizeCoachingDirectives(
  insights: Insight[],
  validation: ValidationSummary,
  cfg: DirectiveDemoteConfig = DIRECTIVE_DEMOTE_DEFAULTS
): string {
  if (insights.length === 0) return "";

  // Per-dimension track record (hit-rate + decisive count) from matured interventions.
  const track = new Map(validation.byDimension.map((d) => [d.dimension, d]));

  // Classify each insight against its dimension's track record, preserving the incoming severity
  // order. A demoted directive is one the loop has PROVEN unproductive (well-evidenced low hit-rate):
  // it keeps its measured evidence — a real weak point is never hidden (calibrated-honesty pillar) —
  // but its failed suggestion is reframed to "try a different lever" and it sinks below the directives
  // the model can still trust.
  const classified = insights.map((i) => {
    const d = track.get(i.dimension);
    const hitRate = d?.hitRate ?? null;
    const decisive = d ? d.validated + d.refuted : 0;
    const demoted = hitRate !== null && decisive >= cfg.minDecisive && hitRate <= cfg.demoteHitRateMax;
    return { i, hitRate, decisive, demoted };
  });

  const render = (c: (typeof classified)[number]): string => {
    const { i, hitRate, decisive, demoted } = c;
    if (demoted) {
      const pct = Math.round((hitRate as number) * 100);
      return `- ${i.title}: ${i.evidence} → past "${i.suggestion}" nudges have a poor track record here (worked only ${pct}% across ${decisive} blocks); the evidence stands — try a different lever, don't just repeat it.`;
    }
    const conf =
      hitRate !== null
        ? ` (past ${i.dimension} nudges worked ${Math.round(hitRate * 100)}% of the time — weight accordingly)`
        : "";
    return `- ${i.title}: ${i.evidence} → ${i.suggestion}${conf}`;
  };

  // Stable partition: trusted directives first (in their severity order), proven-poor ones last.
  const demoted = classified.filter((c) => c.demoted);
  const lines = [...classified.filter((c) => !c.demoted), ...demoted].map(render);

  const header =
    demoted.length > 0
      ? `\nCOACHING DIRECTIVES (synthesised from execution history, validated against past blocks — act on these, most important first; the last ${demoted.length} have a proven-poor track record and are de-prioritised)`
      : `\nCOACHING DIRECTIVES (synthesised from execution history, validated against past blocks — act on these, most important first)`;

  return `${header}\n${lines.join("\n")}`;
}
