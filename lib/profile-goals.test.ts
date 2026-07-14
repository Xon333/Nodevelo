import { describe, expect, it } from "vitest";
import { groupGoalsByFocus, mergeGoalsFromBlockText, parseGoalLines, parseWeakpointLines } from "./profile-goals";

describe("groupGoalsByFocus", () => {
  it("groups goals under their focus in a stable order, skipping empty groups", () => {
    const goals = [
      { goal: "raise FTP", target: "300W", focus: "threshold" as const },
      { goal: "lose 3kg", target: "", focus: "general" as const },
      { goal: "5min power", target: "", focus: "vo2max" as const },
      { goal: "hold threshold longer", target: "", focus: "threshold" as const },
    ];
    const groups = groupGoalsByFocus(goals);
    expect(groups.map((g) => g.focus)).toEqual(["threshold", "vo2max", "general"]);
    expect(groups[0].goals).toHaveLength(2); // two threshold goals together
  });
  it("returns [] for no goals", () => {
    expect(groupGoalsByFocus([])).toEqual([]);
  });
});

describe("parseGoalLines", () => {
  it("splits 'goal → target' lines, trims, and drops blanks", () => {
    expect(parseGoalLines("FTP → 300W\n\n  1-minute power → 600W  \nNo target line")).toEqual([
      { goal: "FTP", target: "300W" },
      { goal: "1-minute power", target: "600W" },
      { goal: "No target line", target: "" },
    ]);
  });
  it("returns [] for blank input", () => {
    expect(parseGoalLines("   \n  ")).toEqual([]);
  });
});

describe("parseWeakpointLines", () => {
  it("splits 'weakpoint: detail' lines and tolerates a bare label", () => {
    expect(parseWeakpointLines("5-second power: 749W, most depressed system\nRecovery")).toEqual([
      { weakpoint: "5-second power", detail: "749W, most depressed system" },
      { weakpoint: "Recovery", detail: "" },
    ]);
  });
});

describe("mergeGoalsFromBlockText", () => {
  const focus = { general: "general" as const, threshold: "threshold" as const };

  it("updates the target of a shown goal that's still present, preserving its focus", () => {
    const existing = [{ goal: "FTP", target: "290W", focus: focus.threshold }];
    const merged = mergeGoalsFromBlockText(existing, existing, "FTP → 300W");
    expect(merged).toEqual([{ goal: "FTP", target: "300W", focus: focus.threshold }]);
  });

  it("drops a shown goal that's been removed from the text (deliberate deletion)", () => {
    const existing = [
      { goal: "FTP", target: "290W", focus: focus.threshold },
      { goal: "5-minute power", target: "", focus: focus.general },
    ];
    const merged = mergeGoalsFromBlockText(existing, existing, "FTP → 300W");
    expect(merged).toEqual([{ goal: "FTP", target: "300W", focus: focus.threshold }]);
  });

  it("adds a new label from the text as a general-focus goal", () => {
    const existing = [{ goal: "FTP", target: "290W", focus: focus.threshold }];
    const merged = mergeGoalsFromBlockText(existing, existing, "FTP → 300W\n5-second power → 1000W");
    expect(merged).toEqual([
      { goal: "FTP", target: "300W", focus: focus.threshold },
      { goal: "5-second power", target: "1000W", focus: focus.general },
    ]);
  });

  it("never touches a goal outside the shown subset, even if the text doesn't mention it", () => {
    const existing = [
      { goal: "FTP", target: "290W", focus: focus.threshold },
      { goal: "VO2max power", target: "", focus: "vo2max" as const }, // not in `shown` — a different focus period
    ];
    const shown = [existing[0]]; // this box was only ever pre-filled with the threshold goal
    const merged = mergeGoalsFromBlockText(existing, shown, "FTP → 300W");
    expect(merged).toEqual(existing.map((g) => (g.goal === "FTP" ? { ...g, target: "300W" } : g)));
  });
});
