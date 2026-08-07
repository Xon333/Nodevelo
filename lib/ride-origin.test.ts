import { describe, expect, it } from "vitest";
import { countsAsDrift, originOf } from "./ride-origin";

describe("originOf — derived from `planned`, never stored", () => {
  it("is prescribed when a block covered the date", () => {
    expect(originOf({ planned: true })).toBe("prescribed");
  });

  it("is unspecified when no block covered the date", () => {
    expect(originOf({ planned: false })).toBe("unspecified");
    expect(originOf({ planned: false })).not.toBe("self-directed");
  });
});

describe("countsAsDrift", () => {
  it("counts an unspecified ride during structured training", () => {
    expect(countsAsDrift("unspecified", false)).toBe(true);
  });

  it("never counts a self-directed ride", () => {
    expect(countsAsDrift("self-directed", false)).toBe(false);
  });

  it("never counts a prescribed ride", () => {
    expect(countsAsDrift("prescribed", false)).toBe(false);
  });

  it("never counts a legacy ride, whatever its origin", () => {
    for (const origin of ["prescribed", "self-directed", "unspecified"] as const) {
      expect(countsAsDrift(origin, true)).toBe(false);
    }
  });
});
