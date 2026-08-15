// Z2-isolated Pw:HR (intervals.icu `icu_power_hr_z2`) — power per heartbeat over a ride's Z2 samples.
// HIGHER = more power per beat = fresher/fitter (the inverse of decoupling's polarity). It's an
// intent-INDEPENDENT aerobic read: computed over the ride's Z2 samples only, so it doesn't infer intensity
// from a ride's type (which off-plan is itself inferred from intensity → would be circular). Two consumers
// share this module so the "qualifying ride" definition + the %Δ-vs-baseline can't drift: the off-plan
// execution-score signal (the gap decoupling left) and the athlete-state aerobic driver.

const AEROBIC_MIN_Z2_MINS = 15; // trust a ride's Z2 Pw:HR only above this much Z2 (a few warmup mins is noise)
export const AEROBIC_BASELINE_DAYS = 90; // trailing window the baseline is drawn from
export const AEROBIC_MIN_BASELINE = 3; // need a few readings before a baseline is trustworthy
export const AEROBIC_DEADBAND_PCT = 3; // within ±this of baseline = no signal (per-ride Pw:HR is noisy — see the decoupling demotion)

// Derived from the athlete's own 187-activity sync window (2026-08-06), not chosen: 1.12 is the loosest
// threshold that still excludes every ride whose whole-ride decoupling exceeds DECOUPLING_GOOD_BOUNDS.max
// (8% — the repo's own "above this a cutoff is meaningless" line), while keeping the majority of plausible
// steady rides. A PROVISIONAL, athlete-specific value, not a universal physiological constant — treat it
// the way the design spec treats its 30-minute segment threshold: revisit with real data if it stops
// fitting. Shared by qualifyingPwHr (Z2-segment trustworthiness) and isSteadyEnduranceRide (whole-ride
// comparability) below — the ONLY thing the two predicates share; they otherwise test different things.
export const AEROBIC_MAX_VI = 1.12;

// Shared by qualifyingPwHr and isSteadyEnduranceRide — the ONE place the fail-closed variability check
// lives, so the two predicates' shared AEROBIC_MAX_VI threshold can't drift apart from each other. The
// predicates themselves stay independent (different earlier criteria, different callers) — only this
// low-level arithmetic check is common between them.
function withinVariabilityLimit(normalizedPower: number | null, avgWatts: number | null): boolean {
  if (normalizedPower == null || avgWatts == null || avgWatts <= 0) return false; // fail closed
  return normalizedPower / avgWatts <= AEROBIC_MAX_VI;
}

export interface PwHrRide {
  date: string; // YYYY-MM-DD
  type: string; // activity type — only OUTDOOR "Ride" qualifies (see qualifyingPwHr)
  powerHrZ2: number | null;
  powerHrZ2Mins: number | null;
  // Both required (not optional), matching ActivitySummary's own non-optional-but-nullable shape, so a
  // real ActivitySummary satisfies this interface with zero changes. Added 2026-08-06 so qualifyingPwHr
  // can apply the same variability gate isSteadyEnduranceRide does — see AEROBIC_MAX_VI above.
  avgWatts: number | null;
  normalizedPower: number | null;
}

// A ride's Z2 Pw:HR if it's an OUTDOOR ride that clears the Z2-minutes floor AND was steady enough for its
// own Z2 samples to be trustworthy, else null. Outdoor-only (`type === "Ride"`, excluding VirtualRide) for
// parity with the Trends Pw:HR (`isSteadyEnduranceRide`): indoor/virtual rides have no wind cooling →
// cardiac drift, and ERG holds power flat, so their Z2 Pw:HR is distorted.
//
// VARIABILITY GATE (2026-08-06): a ride's Z2-isolated Pw:HR is only trustworthy when the ride as a WHOLE
// was steady — on a structurally mixed ride (Z2 cruising between hard climbs), the Z2-zone power samples
// still carry cardiac drift from the efforts around them (HR doesn't reset the instant power drops back
// into Z2), so "Z2 power" does not mean "undisturbed aerobic HR" on a surgy ride. Measured over the real
// 90-day sync window: 24 of 38 (63%) of the rides that previously qualified for the baseline fell outside
// this gate, 10 of those with implausible (>8%) decoupling — this was NOT a marginal, single-ride effect.
// Fails CLOSED (excludes) when VI can't be computed: verified against real data that 0 of 43 candidate
// rides lack normalizedPower, so this costs nothing in practice.
//
// DELIBERATELY narrower than isSteadyEnduranceRide: no duration floor, no whole-ride IF band. Those
// answer "is the WHOLE ride comparable for a whole-ride metric" (decoupling, EF trend) — a different
// question from "is THIS ride's Z2-isolated reading trustworthy." A short, gentle Recovery ride below the
// 0.56 IF band is a perfectly legitimate Pw:HR reading; conflating the two gates was a real mistake this
// plan corrected before implementation — do not reintroduce it (see aerobic.test.ts's Recovery-ride test).
export function qualifyingPwHr(r: PwHrRide): number | null {
  if (r.type !== "Ride" || r.powerHrZ2 == null || (r.powerHrZ2Mins ?? 0) < AEROBIC_MIN_Z2_MINS) return null;
  if (!withinVariabilityLimit(r.normalizedPower, r.avgWatts)) return null;
  return r.powerHrZ2;
}

// The athlete's aerobic baseline as-of a ride: mean Z2 Pw:HR over qualifying rides STRICTLY BEFORE `date`
// within the trailing window. Excludes the ride itself (no self-reference — same discipline as RV2-4) and
// is as-of correct for scoring a historical entry. Null below the min-sample floor.
// ponytail: O(rides) per call → O(n²) across a full ledger rebuild; n ≤ a sync window of rides, so it's
// fine — switch to a rolling accumulator only if a rebuild ever shows up in a profile.
export function z2PwHrBaselineBefore(rides: PwHrRide[], date: string): number | null {
  const cutoff = new Date(Date.parse(date) - AEROBIC_BASELINE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const vals = rides
    .filter((r) => r.date < date && r.date >= cutoff)
    .map(qualifyingPwHr)
    .filter((v): v is number => v != null);
  if (vals.length < AEROBIC_MIN_BASELINE) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Signed %Δ of a ride's Z2 Pw:HR vs its baseline (positive = above baseline = better aerobic efficiency).
// Null when the ride doesn't qualify or there's no usable baseline → the consumer applies no signal.
export function aerobicEffPct(ride: PwHrRide, baseline: number | null): number | null {
  const v = qualifyingPwHr(ride);
  if (v == null || baseline == null || baseline <= 0) return null;
  return ((v - baseline) / baseline) * 100;
}

// ---------- ride-level aerobic comparability (a DIFFERENT question from qualifyingPwHr above — see the
// module-level note on AEROBIC_MAX_VI) ----------

const ENDURANCE_MIN_SEC = 45 * 60;

// Structural shape, not ActivitySummary — so the predicate stays testable without a 30-field fixture.
// ActivitySummary satisfies it structurally, so real callers pass activities directly with no cast.
export interface ComparableRide {
  type: string;
  movingTimeSec: number;
  avgWatts: number | null;
  normalizedPower: number | null;
}

// The like-for-like gate that makes a WHOLE-RIDE aerobic metric (Intervals.icu's decoupling, the Trends EF
// series) comparable across rides. Moved here from lib/trends.ts (2026-08-06). NOT the same question as
// qualifyingPwHr (Z2-segment trustworthiness, above) — this one needs the WHOLE ride to be steady-endurance
// shaped, because decoupling/EF are whole-ride metrics; qualifyingPwHr only needs the Z2 portion to be
// trustworthy. Do not use one to gate the other's consumer.
//
//   • OUTDOOR only — indoor/virtual rides have no wind cooling (cardiac drift) and ERG flattens power.
//   • >= 45 min — shorter rides don't yield a meaningful whole-ride aerobic signal.
//   • endurance band ~0.56-0.85 FTP — hard/easy days aren't comparable. Skipped when FTP is unknown.
//   • VI <= AEROBIC_MAX_VI, fail CLOSED when uncomputable — a mixed-terrain ride averages into the band
//     but reports 15-46% "drift" that is a ride-structure artifact, not aerobic fade.
export function isSteadyEnduranceRide(a: ComparableRide, ftp: number): boolean {
  if (a.type !== "Ride") return false;
  if (a.movingTimeSec < ENDURANCE_MIN_SEC) return false;
  // Note: when normalizedPower is null, the fail-closed variability check below returns false
  // regardless of this fallback's result — this line only matters if that check is ever relaxed.
  const power = a.normalizedPower ?? a.avgWatts;
  if (power === null) return false;
  if (ftp > 0 && (power / ftp < 0.56 || power / ftp > 0.85)) return false;
  if (!withinVariabilityLimit(a.normalizedPower, a.avgWatts)) return false;
  return true;
}
