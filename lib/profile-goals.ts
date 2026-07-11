import type { SeasonFocus } from "./types";

// Stable display order for goal groups: physiological systems in periodization order, then "all phases".
const FOCUS_ORDER: Array<SeasonFocus | "general"> = [
  "aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen", "general",
];

// Group goals under their focus, in FOCUS_ORDER, skipping empty groups. Pure — for a scannable,
// system-clustered goals view (vs a flat list where every row carried a redundant focus chip).
export function groupGoalsByFocus<T extends { focus: SeasonFocus | "general" }>(
  goals: T[]
): Array<{ focus: SeasonFocus | "general"; goals: T[] }> {
  return FOCUS_ORDER.map((focus) => ({ focus, goals: goals.filter((g) => g.focus === focus) })).filter(
    (grp) => grp.goals.length > 0
  );
}
