import { describe, expect, it } from "vitest";
import { AEROBIC_DRIFT_NOT_MEASURABLE, confidenceCaption, formatIntentUsed, notScoredMessage } from "./intent-display";
import type { NotScoredReason, StructuredIntent } from "./types";

describe("formatIntentUsed", () => {
  it("joins ordered phase descriptions with an arrow, matching design §12.2's example", () => {
    const intent: StructuredIntent = {
      primaryPurpose: "mixed endurance",
      phases: [
        { description: "45 min steady Z2", kind: "zone-time" },
        { description: "variable climbing", kind: "qualitative" },
        { description: "9 min around 292 W", kind: "effort" },
        { description: "descending practice", kind: "qualitative" },
      ],
    };
    expect(formatIntentUsed(intent)).toBe(
      "45 min steady Z2 → variable climbing → 9 min around 292 W → descending practice"
    );
  });

  it("returns just the primary purpose when there are no phases", () => {
    const intent: StructuredIntent = { primaryPurpose: "easy spin", phases: [] };
    expect(formatIntentUsed(intent)).toBe("easy spin");
  });
});

describe("notScoredMessage", () => {
  it.each<[NotScoredReason, string]>([
    ["no-intent-found", "Not scored — no intent found"],
    ["intent-unreliable", "Not scored — intent could not be determined reliably"],
    ["interpreter-failed", "Not scored — the ride note couldn't be parsed"],
    ["no-measurable-objectives", "Not scored — nothing measurable to verify"],
  ])("maps %s to its design-specified or plan-authored string", (reason, expected) => {
    expect(notScoredMessage(reason)).toBe(expected);
  });
});

describe("confidenceCaption", () => {
  it("returns the limited-basis caption for medium confidence", () => {
    expect(confidenceCaption("medium")).toBe(
      "Limited basis — only objectives directly supported by the note and data were scored."
    );
  });

  it("returns null for high and low confidence", () => {
    expect(confidenceCaption("high")).toBeNull();
    expect(confidenceCaption("low")).toBeNull();
  });
});

describe("AEROBIC_DRIFT_NOT_MEASURABLE", () => {
  it("matches design §7 step 5 verbatim", () => {
    expect(AEROBIC_DRIFT_NOT_MEASURABLE).toBe("Aerobic drift not measurable — no sufficiently steady aerobic segment");
  });
});
