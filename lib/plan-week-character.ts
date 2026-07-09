// Presentational per-week "character" for the Plan hero's week rows. There is NO per-week phase in the
// data model — CurrentBlock carries a single whole-block seasonPhase, and spreading that one value across
// weeks would misrepresent it (Constitution §5 provenance). Instead we characterise each week purely by
// its planned volume relative to the block: an honest, deterministic read the hero labels as
// volume-derived (same category of client-side derivation as Wave 3's trendDir/halvesDir).
//
// Rule: below-average non-final weeks read "load"; above-average weeks read "build"; the single
// biggest-volume week reads "peak"; the final week reads "taper" only when it is below the block average
// (a real deload). A flat block has no week below average, so its peak defaults to week 0 — acceptable
// given the derivation tip the hero shows alongside it.
export function weekCharacters(weeklyMinutes: number[]): string[] {
  const n = weeklyMinutes.length;
  if (n === 0) return [];
  const avg = weeklyMinutes.reduce((s, m) => s + m, 0) / n;
  let peakIdx = 0;
  for (let i = 1; i < n; i++) if (weeklyMinutes[i] > weeklyMinutes[peakIdx]) peakIdx = i;
  return weeklyMinutes.map((m, i) => {
    if (i === n - 1 && m < avg) return "taper";
    if (i === peakIdx) return "peak";
    return m < avg ? "load" : "build";
  });
}
