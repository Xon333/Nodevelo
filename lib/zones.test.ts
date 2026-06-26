import { describe, expect, it } from "vitest";
import { bucketZones, ifBandLabel, type Zone } from "./zones";

// Mirrors the md HR zones: Z1 <120, Z2 120-152, Z3 152-170, Z4 170-182, Z5 182-194, Z6 >194.
const ZONES: Zone[] = [
  { name: "Z1", lo: 0, hi: 120 },
  { name: "Z2", lo: 120, hi: 152 },
  { name: "Z3", lo: 152, hi: 170 },
  { name: "Z4", lo: 170, hi: 182 },
  { name: "Z5", lo: 182, hi: 194 },
  { name: "Z6", lo: 194, hi: null },
];

describe("ifBandLabel", () => {
  it("uses the population defaults when no synced zones are given (matches the scorer: Z2 = 0.60–0.74)", () => {
    expect(ifBandLabel(0.50)).toBe("recovery");
    expect(ifBandLabel(0.70)).toBe("endurance"); // a real Z2 ride is NOT "recovery"
    expect(ifBandLabel(0.85)).toBe("tempo");
    expect(ifBandLabel(1.0)).toBe("threshold");
    expect(ifBandLabel(1.1)).toBe("VO2max");
    expect(ifBandLabel(1.3)).toBe("anaerobic");
  });

  it("derives the boundaries from the athlete's synced zone tops (%FTP)", () => {
    // Coggan tops: Z1 55, Z2 75, Z3 90, Z4 105, Z5 120 (%FTP). IF 0.74 < 0.75 → endurance.
    const tops = [55, 75, 90, 105, 120, 150];
    expect(ifBandLabel(0.74, tops)).toBe("endurance");
    expect(ifBandLabel(0.80, tops)).toBe("tempo");
    expect(ifBandLabel(0.50, tops)).toBe("recovery");
    // A higher Z2 ceiling (80% FTP) moves the boundary — 0.78 now reads endurance, not tempo.
    expect(ifBandLabel(0.78, [55, 80, 95, 108, 125, 150])).toBe("endurance");
  });

  it("falls back to defaults for malformed zone tops (too few / non-ascending)", () => {
    expect(ifBandLabel(0.70, [55, 75])).toBe("endurance"); // too few → defaults
    expect(ifBandLabel(0.70, [75, 55, 90, 105, 120])).toBe("endurance"); // non-ascending → defaults
  });
});

describe("bucketZones", () => {
  it("buckets samples into the right zones", () => {
    const samples = [110, 130, 140, 160, 175, 190, 200];
    expect(bucketZones(samples, ZONES)).toEqual([1, 2, 1, 1, 1, 1]);
  });

  it("treats lower bound as inclusive and upper as exclusive", () => {
    // 120 → Z2 (not Z1), 152 → Z3 (not Z2), 194 → Z6 (open top)
    expect(bucketZones([120, 152, 194], ZONES)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("ignores zero and non-finite samples (dropouts)", () => {
    const samples = [0, NaN, 130, 0, Infinity, 130];
    expect(bucketZones(samples, ZONES)).toEqual([0, 2, 0, 0, 0, 0]);
  });

  it("returns all-zero when there are no valid samples", () => {
    expect(bucketZones([], ZONES)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
