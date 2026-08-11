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
  it("parses valid structured intent without re-verifying grounding", () => {
    expect(parseIntentToolOutput(valid)).toEqual(valid);
    expect(parseIntentToolOutput(valid)?.objectives[0].grounded).toBe(true);
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
