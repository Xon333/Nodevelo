// Track C — pre-ride loading loop. Deterministic, pure: prescribe a day-before carb-loading target
// ahead of a long durability ride, and assess whether loading actually improves late-ride effort
// delivery for THIS athlete. Outcome is POWER-ONLY (the Track B delivery grade) — decoupling/Pw:HR is
// deliberately absent, per the demotion rationale documented above deriveCarbsOptimum (calibration.ts).

import { EXPECTS_EMBEDDED_EFFORTS } from "./durability-score";
import type { CurrentBlock, CurrentBlockDay, RideScoreEntry } from "./types";

// Day-before loading target: 7 g/kg — midpoint of the KB's 6–8 g/kg high-fueling-day band for a hard
// training day (NOT the 10–12 g/kg race carb-load; that's 6a's territory). Population default; a
// per-athlete derivation is a later Track C leg once actual grams (not just loaded/skipped) accrue.
export const PRELOAD_G_PER_KG = 7;

export function preLoadTargetG(weightKg: number): number {
  return Math.round((PRELOAD_G_PER_KG * weightKg) / 10) * 10;
}

export interface LoadingPrompt {
  kind: "pre-ask" | "retro-ask";
  rideDate: string;
  template: string;
  targetG: number;
}

// Pure day-math (not "what day is it now") — UTC-anchored arithmetic is fine here per AGENTS.md;
// `today` arrives already resolved to the athlete's local date.
function nextDay(date: string): string {
  return new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
}

function durabilityDayAt(block: CurrentBlock | null, date: string): CurrentBlockDay | null {
  const day = block?.days.find((d) => d.date === date) ?? null;
  return day && day.durabilityTemplate && day.durationMin > 0 ? day : null;
}

// The one prompt the Today page may show. Retro-ask (today IS the durability day, response missing)
// outranks pre-ask (tomorrow is) — attribution for a ride that's happening beats prep for one that isn't
// yet. All templates (A–E) get the prescription — loading before any 3h+ ride is sound practice; only
// B–E feed the learning (template A has no prescribed efforts, so no honest outcome — see assess below).
export function deriveLoadingPrompt(
  block: CurrentBlock | null,
  today: string,
  weightKg: number,
  responded: Set<string>
): LoadingPrompt | null {
  const targetG = preLoadTargetG(weightKg);
  const todayDur = durabilityDayAt(block, today);
  if (todayDur && !responded.has(today)) {
    return { kind: "retro-ask", rideDate: today, template: todayDur.durabilityTemplate as string, targetG };
  }
  const tomorrow = nextDay(today);
  const tomorrowDur = durabilityDayAt(block, tomorrow);
  if (tomorrowDur && !responded.has(tomorrow)) {
    return { kind: "pre-ask", rideDate: tomorrow, template: tomorrowDur.durabilityTemplate as string, targetG };
  }
  return null;
}

export interface LoadingEffect {
  verdict: "unproven" | "helps" | "no-effect";
  nLoaded: number;
  nUnloaded: number;
  loadedRate: number | null; // share of loaded rides where the prescribed efforts were delivered
  unloadedRate: number | null;
}

const MIN_PER_SIDE = 3; // below this, any rate difference is noise
const HELPS_MARGIN = 0.25; // loaded delivery rate must beat unloaded by ≥ this to credit loading
const NO_EFFECT_MIN_PER_SIDE = 5; // don't declare futility on a thin sample
const NO_EFFECT_BAND = 0.1; // at n≥5/side, a diff below this (incl. negative) = loading isn't moving the signal

// ponytail: heuristic delivered-rate comparison, not the correlation engine — loaded/skipped is binary,
// deriveOptimum/deriveExecutionEdge need a continuous signal. Migrate onto a correlation-engine spec
// when actual day-before grams (not just the flag) are logged.
export function assessLoadingEffect(entries: RideScoreEntry[]): LoadingEffect {
  const obs = entries.filter(
    (e) =>
      e.planned &&
      !e.legacy &&
      !e.compromised &&
      e.durabilityTemplate != null &&
      EXPECTS_EMBEDDED_EFFORTS.has(e.durabilityTemplate) &&
      e.preLoad != null &&
      e.durabilityDelivery != null
  );
  const loaded = obs.filter((e) => e.preLoad!.loaded);
  const unloaded = obs.filter((e) => !e.preLoad!.loaded);
  const rate = (xs: RideScoreEntry[]) =>
    xs.length === 0 ? null : xs.filter((e) => e.durabilityDelivery!.signal === 2).length / xs.length;
  const loadedRate = rate(loaded);
  const unloadedRate = rate(unloaded);

  let verdict: LoadingEffect["verdict"] = "unproven";
  if (loaded.length >= MIN_PER_SIDE && unloaded.length >= MIN_PER_SIDE && loadedRate !== null && unloadedRate !== null) {
    const diff = loadedRate - unloadedRate;
    if (diff >= HELPS_MARGIN) verdict = "helps";
    else if (loaded.length >= NO_EFFECT_MIN_PER_SIDE && unloaded.length >= NO_EFFECT_MIN_PER_SIDE && diff < NO_EFFECT_BAND)
      verdict = "no-effect";
  }
  return { verdict, nLoaded: loaded.length, nUnloaded: unloaded.length, loadedRate, unloadedRate };
}
