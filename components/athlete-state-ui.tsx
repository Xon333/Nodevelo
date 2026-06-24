import type { AthleteState } from "@/lib/types";

// Shared athlete-state rendering bits, so AthleteStateCard (the glance) and StateDriversCard (the full
// "why") can't drift (UI-1). The duplicated effect-color logic previously did — which is how a sub-AA
// neutral arm shipped in both places (A11Y-2). The band→color map, the driver direction glyphs, and the
// signed-effect color now live here once.
export const BAND_COLOR: Record<AthleteState["band"], string> = {
  primed: "text-emerald-600 dark:text-emerald-400",
  ready: "text-green-600 dark:text-green-400",
  steady: "text-zinc-700 dark:text-zinc-200",
  strained: "text-amber-600 dark:text-amber-400",
  depleted: "text-red-600 dark:text-red-400",
};

export const DIR: Record<"up" | "down" | "flat", string> = { up: "↑", down: "↓", flat: "→" };

// Color a signed driver effect: positive = good (emerald), negative = bad (red), neutral = muted. The
// neutral arm is text-zinc-500 dark:text-zinc-400 so it clears AA contrast in light mode (A11Y-2).
export function driverEffectClass(effect: number): string {
  return effect > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : effect < 0
      ? "text-red-600 dark:text-red-400"
      : "text-zinc-500 dark:text-zinc-400";
}
