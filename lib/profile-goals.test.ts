import { describe, expect, it } from "vitest";
import { groupGoalsByFocus } from "./profile-goals";

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
