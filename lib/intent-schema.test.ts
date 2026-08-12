import { describe, expect, it } from "vitest";
import { parseIntentToolOutput } from "./intent-schema";

const valid = {
  primaryPurpose: "steady endurance then climbing efforts",
  phases: [
    {
      description: "45 minutes steady Z2",
      kind: "zone-time",
      durationMin: 45,
      zone: "Z2",
      zoneBasis: "unspecified",
    },
  ],
  objectives: [
    {
      description: "45 minutes steady Z2",
      kind: "zone-time",
      zoneBasis: "unspecified",
      target: { durationMin: 45, zone: "Z2" },
      grounded: true,
      sourceText: "45m z2 steady start",
    },
  ],
  confidence: "high",
};

describe("intent tool schema", () => {
  it("parses valid structured intent", () => {
    expect(parseIntentToolOutput(valid)).toEqual(valid);
    expect(parseIntentToolOutput(valid)?.objectives[0].grounded).toBe(true);
  });

  // Responsibility boundary: `verifyGrounding` in lib/intent-grounding.ts is the ONLY place a
  // `grounded: true` claim is re-checked against the note — deliberately not duplicated here. The
  // fixture must therefore be one a re-verifying schema would REJECT (999 W appears nowhere in "just
  // spin easy"); a genuinely-grounded fixture would pass either way and prove nothing.
  it("passes the model's grounding claim through unverified, however unsupported", () => {
    const ungrounded = structuredClone(valid);
    ungrounded.objectives[0].target = { watts: 999 } as never;
    ungrounded.objectives[0].sourceText = "just spin easy";
    ungrounded.objectives[0].grounded = true;

    expect(parseIntentToolOutput(ungrounded)?.objectives[0].grounded).toBe(true);
    expect(parseIntentToolOutput(ungrounded)?.objectives[0].target).toEqual({ watts: 999 });
  });

  it.each(["score", "executionScore", "decoupling"])("rejects the unexpressible field %s", (field) => {
    expect(parseIntentToolOutput({ ...valid, [field]: 8 })).toBeNull();
  });

  it("rejects invented nested fields", () => {
    const withScore = structuredClone(valid);
    Object.assign(withScore.objectives[0], { score: 8 });
    expect(parseIntentToolOutput(withScore)).toBeNull();
  });

  it.each([
    { ...valid, confidence: undefined },
    { ...valid, objectives: "not-an-array" },
    { ...valid, objectives: [{ ...valid.objectives[0], kind: "mystery" }] },
  ])("returns null rather than throwing for malformed output", (input) => {
    expect(() => parseIntentToolOutput(input)).not.toThrow();
    expect(parseIntentToolOutput(input)).toBeNull();
  });

  it("rejects watts and FTP percentage on the same objective", () => {
    const mixedUnits = structuredClone(valid);
    mixedUnits.objectives[0].target = { watts: 292, targetPctFtp: 95 } as never;
    expect(parseIntentToolOutput(mixedUnits)).toBeNull();
  });
});
