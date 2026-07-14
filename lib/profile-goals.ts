import type { AthleteProfile, SeasonFocus } from "./types";

type Goal = AthleteProfile["goals"][number];
type Weakpoint = AthleteProfile["weakpoints"][number];

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

// ---------- Block-generator free-text ↔ structured profile round-trip ----------
// The block generator's goal/weakpoints textareas are pre-filled from the profile as plain lines
// (PlanView: `${goal}${target ? " → " + target : ""}` and `${weakpoint}${detail ? ": " + detail : ""}`).
// These parsers invert that exact join so a "save to profile" action can round-trip edits back —
// see mergeGoalsFromBlockText for why goals need a scoped merge and weakpoints don't.

export function parseGoalLines(text: string): Array<{ goal: string; target: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("→");
      return idx === -1
        ? { goal: line, target: "" }
        : { goal: line.slice(0, idx).trim(), target: line.slice(idx + 1).trim() };
    })
    .filter((g) => g.goal.length > 0);
}

export function parseWeakpointLines(text: string): Weakpoint[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      return idx === -1
        ? { weakpoint: line, detail: "" }
        : { weakpoint: line.slice(0, idx).trim(), detail: line.slice(idx + 1).trim() };
    })
    .filter((w) => w.weakpoint.length > 0);
}

// Goals need a scoped merge, unlike weakpoints: the generator's goal textarea is pre-filled from
// `filterGoalsByFocus` — only the goals relevant to the current season period (+ "general") — so it
// can show a *subset* of the full profile list. A blind replace would silently delete every goal
// belonging to another focus. `shown` is the exact subset this box was pre-filled from; anything in
// `existing` outside that subset is untouched. Within the shown subset: a label still present in the
// text keeps its focus and takes the edited target; a label removed from the text is dropped (an
// intentional deletion); a label with no prior match is a new goal, defaulted to "general" (the
// text carries no focus tag to infer one from — same default the profile form's own "+ Add goal" uses).
export function mergeGoalsFromBlockText(existing: Goal[], shown: Goal[], editedText: string): Goal[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const shownLabels = new Set(shown.map((g) => norm(g.goal)));
  const editedByLabel = new Map(parseGoalLines(editedText).map((g) => [norm(g.goal), g]));

  const merged: Goal[] = [];
  for (const g of existing) {
    const key = norm(g.goal);
    if (!shownLabels.has(key)) {
      merged.push(g); // outside this box's scope — never touch it
      continue;
    }
    const edit = editedByLabel.get(key);
    if (edit) {
      merged.push({ ...g, target: edit.target });
      editedByLabel.delete(key);
    }
    // else: was shown, no longer in the text — treated as a deliberate removal
  }
  for (const g of editedByLabel.values()) {
    merged.push({ goal: g.goal, target: g.target, focus: "general" });
  }
  return merged;
}
