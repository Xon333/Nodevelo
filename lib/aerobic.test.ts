import { describe, expect, it } from "vitest";
import { AEROBIC_MAX_VI, aerobicEffPct, isSteadyEnduranceRide, qualifyingPwHr, z2PwHrBaselineBefore, type ComparableRide, type PwHrRide } from "./aerobic";

// avgWatts/normalizedPower default to a steady VI (185/180 = 1.028, well under AEROBIC_MAX_VI) so every
// EXISTING test below keeps testing what it always tested — the Z2-minutes floor, outdoor-only gate, and
// baseline window — without the new variability check becoming an accidental, undocumented confound.
// Tests that specifically exercise the VI gate override these two fields explicitly.
const r = (
  date: string,
  powerHrZ2: number | null,
  powerHrZ2Mins = 30,
  type = "Ride",
  avgWatts = 180,
  normalizedPower = 185
): PwHrRide => ({ date, type, powerHrZ2, powerHrZ2Mins, avgWatts, normalizedPower });

describe("qualifyingPwHr", () => {
  it("returns the value only above the Z2-minutes floor", () => {
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30))).toBe(1.5);
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 8))).toBeNull(); // too little Z2
    expect(qualifyingPwHr(r("2026-06-01", null, 60))).toBeNull(); // no reading
  });

  it("excludes indoor/virtual rides — their Z2 Pw:HR is distorted (EC-1, parity with Trends Pw:HR)", () => {
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "VirtualRide"))).toBeNull();
  });
});

describe("qualifyingPwHr — variability gate", () => {
  it("excludes a ride whose Z2 reading came from a structurally mixed ride (high VI)", () => {
    // 241/200 = 1.205, matches the 2026-08-06 screenshot ride's real VI.
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 241))).toBeNull();
  });

  it("keeps a genuinely steady ride's reading (VI at/under the threshold)", () => {
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 224))).toBe(1.5); // VI exactly 1.12
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 225))).toBeNull(); // VI 1.125
  });

  it("fails CLOSED when normalizedPower is absent — cannot rule out a surgy ride, so exclude it", () => {
    expect(qualifyingPwHr({ date: "2026-06-01", type: "Ride", powerHrZ2: 1.5, powerHrZ2Mins: 30, avgWatts: 200, normalizedPower: null })).toBeNull();
  });

  // Deliberately DOES NOT require duration or an IF band — qualifyingPwHr answers "is this ride's Z2
  // reading trustworthy," not "is the whole ride comparable" (that's isSteadyEnduranceRide, a stricter,
  // different question). A short, gentle Recovery ride below IF 0.56 with steady VI is exactly the case
  // an earlier draft of this plan wrongly suppressed by applying isSteadyEnduranceRide's extra
  // duration/IF-band criteria here too — this test guards against reintroducing that mistake.
  it("qualifies a short, low-intensity Recovery ride that isSteadyEnduranceRide would reject", () => {
    const shortEasyRide = r("2026-06-01", 1.5, 20, "Ride", 150, 152); // 20 Z2 min, VI 1.013, well under 45min
    expect(qualifyingPwHr(shortEasyRide)).toBe(1.5);
    expect(isSteadyEnduranceRide({ type: "Ride", movingTimeSec: 20 * 60, avgWatts: 150, normalizedPower: 152 }, 288)).toBe(false); // duration floor
  });
});

describe("z2PwHrBaselineBefore", () => {
  const rides = [
    r("2026-06-01", 1.5),
    r("2026-06-10", 1.6),
    r("2026-06-15", 1.4),
    r("2026-06-20", 9.9), // the ride being scored — must be excluded (strictly-before)
  ];

  it("means qualifying rides strictly before the date, excluding the ride itself", () => {
    expect(z2PwHrBaselineBefore(rides, "2026-06-20")).toBeCloseTo(1.5, 5); // mean(1.5,1.6,1.4), not 9.9
  });

  it("returns null below the min-sample floor", () => {
    expect(z2PwHrBaselineBefore([r("2026-06-01", 1.5), r("2026-06-10", 1.6)], "2026-06-20")).toBeNull();
  });

  it("ignores thin-Z2 rides, indoor rides, and anything outside the 90-day window", () => {
    const withNoise = [
      ...rides,
      r("2026-06-18", 1.9, 5), // <15 min Z2
      r("2026-06-17", 9.9, 30, "VirtualRide"), // indoor — distorted Pw:HR, must be excluded (EC-1)
      r("2026-01-01", 2.0), // >90d back
    ];
    expect(z2PwHrBaselineBefore(withNoise, "2026-06-20")).toBeCloseTo(1.5, 5);
  });
});

describe("z2PwHrBaselineBefore — excludes non-comparable rides from the baseline mean", () => {
  it("drops a high-VI ride from the baseline even though its Z2 reading would otherwise qualify", () => {
    const rides = [
      r("2026-06-01", 1.5), // steady, default VI 1.028
      r("2026-06-05", 1.6), // steady
      r("2026-06-09", 9.9, 30, "Ride", 200, 241), // high-VI (1.205) — must be excluded despite a qualifying Z2 reading
      r("2026-06-12", 1.4), // steady
    ];
    // Without the VI gate, the mean would include 9.9 and be wildly skewed. With it, only 1.5/1.6/1.4 count.
    expect(z2PwHrBaselineBefore(rides, "2026-06-20")).toBeCloseTo((1.5 + 1.6 + 1.4) / 3, 5);
  });
});

describe("aerobicEffPct", () => {
  it("is the signed %Δ vs baseline (positive = above baseline = better)", () => {
    expect(aerobicEffPct(r("2026-06-20", 1.575), 1.5)).toBeCloseTo(5, 5);
    expect(aerobicEffPct(r("2026-06-20", 1.425), 1.5)).toBeCloseTo(-5, 5);
  });

  it("is null when the ride doesn't qualify or there's no baseline", () => {
    expect(aerobicEffPct(r("2026-06-20", 1.5, 8), 1.5)).toBeNull(); // thin Z2
    expect(aerobicEffPct(r("2026-06-20", 1.5), null)).toBeNull(); // no baseline
  });
});

describe("aerobicEffPct — end-to-end through the tightened qualifyingPwHr", () => {
  it("returns null for a high-VI ride even with a valid baseline — this alone is the fix for the aerobic-efficiency penalty", () => {
    const mixedRide = r("2026-08-06", 1.35, 20, "Ride", 200, 241); // VI 1.205, matches the screenshot ride
    expect(aerobicEffPct(mixedRide, 1.5)).toBeNull();
  });

  it("still computes a real percentage for a genuinely steady ride", () => {
    const steadyRide = r("2026-08-06", 1.35, 40, "Ride", 200, 206); // VI 1.03
    expect(aerobicEffPct(steadyRide, 1.5)).toBeCloseTo(-10, 5); // (1.35-1.5)/1.5*100
  });
});

describe("isSteadyEnduranceRide", () => {
  const ride = (over: Partial<ComparableRide> = {}): ComparableRide => ({
    type: "Ride",
    movingTimeSec: 90 * 60,
    avgWatts: 200,
    normalizedPower: 208, // VI 1.04 — steady
    ...over,
  });

  it("accepts an outdoor, long-enough, in-band, low-variability ride", () => {
    expect(isSteadyEnduranceRide(ride(), 280)).toBe(true);
  });

  it("rejects indoor/virtual rides", () => {
    expect(isSteadyEnduranceRide(ride({ type: "VirtualRide" }), 280)).toBe(false);
  });

  it("rejects rides under the 45-minute floor", () => {
    expect(isSteadyEnduranceRide(ride({ movingTimeSec: 44 * 60 }), 280)).toBe(false);
  });

  it("rejects rides outside the 0.56-0.85 endurance band", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 140, avgWatts: 135 }), 280)).toBe(false); // IF 0.50
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 250, avgWatts: 242 }), 280)).toBe(false); // IF 0.89
  });

  it("rejects a surgy ride that would otherwise pass the band — the mixed-terrain case", () => {
    // The 2026-08-06 screenshot ride: 118 min, NP 241, avg 200, FTP 288 -> IF 0.837 (in band), VI 1.205.
    expect(isSteadyEnduranceRide(ride({ movingTimeSec: 118 * 60, normalizedPower: 241, avgWatts: 200 }), 288)).toBe(false);
  });

  it("accepts exactly at the variability threshold and rejects just above it", () => {
    // avgWatts 200 with NP 224 -> VI 1.12; 225 -> VI 1.125. Verified in Node that 224/200 and the literal
    // 1.12 round to the IDENTICAL IEEE-754 double (224/200 === 1.12 evaluates true) — neither is "exactly
    // representable" in an absolute sense (1.12 is a repeating binary fraction, same class as 0.1), but
    // both operands land on the same bit pattern, so this comparison is stable, not a coincidence to avoid.
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 224, avgWatts: 200 }), 280)).toBe(true);
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 225, avgWatts: 200 }), 280)).toBe(false);
    expect(AEROBIC_MAX_VI).toBe(1.12);
  });

  it("fails CLOSED when NP is absent — cannot rule out a surgy ride", () => {
    // Verified against real data (90-day window): 0 of 43 rides that pass duration+band lack
    // normalizedPower, so this costs nothing in practice — it's the safer default, not a tradeoff.
    expect(isSteadyEnduranceRide(ride({ normalizedPower: null, avgWatts: 200 }), 280)).toBe(false);
  });

  it("rejects a ride with no power at all", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: null, avgWatts: null }), 280)).toBe(false);
  });

  it("skips the band check when FTP is unknown, but still applies duration and variability", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 400, avgWatts: 390 }), 0)).toBe(true); // VI 1.026
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 400, avgWatts: 300 }), 0)).toBe(false); // VI 1.33
  });
});
