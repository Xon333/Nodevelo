import { describe, expect, it } from "vitest";
import { gradeDurabilityDelivery } from "./durability-score";
import type { ExecutedInterval } from "./types";

const FTP = 280;
const TOTAL = 9000; // 2.5 h ride, in stream samples (~1 Hz)
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null,
  maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null,
  avgSpeedKph: null,
  ...over,
});
// Ride-end marker: a Z2 cool-down whose end_index reaches the last sample (intervals span warm-up → cool-down
// in real data), so timing fractions resolve against the ride end, not the last work effort. 150 W lands in
// no effort band, so it never enters `inBand`.
const rideEnd = iv({ avgWatts: 150, durationSec: 600, startIndex: TOTAL - 600, endIndex: TOTAL });

describe("gradeDurabilityDelivery", () => {
  it("returns null for template A / unknown / missing data (nothing to detect)", () => {
    expect(gradeDurabilityDelivery("A", [iv({ avgWatts: 180, durationSec: 600 })], FTP, TOTAL)).toBeNull();
    expect(gradeDurabilityDelivery("B", [], FTP, TOTAL)).toBeNull(); // no intervals
    expect(gradeDurabilityDelivery("B", [iv({ avgWatts: 266, durationSec: 600 })], 0, TOTAL)).toBeNull(); // no ftp
  });

  it("B: rewards a late threshold effort, penalises its absence, neutral when mis-placed", () => {
    const lateThreshold = iv({ avgWatts: 266, durationSec: 600, startIndex: 7200 }); // 95% FTP, 10 min, frac 0.8
    expect(gradeDurabilityDelivery("B", [lateThreshold, rideEnd], FTP, TOTAL)?.signal).toBe(2);

    const onlyZ2 = iv({ avgWatts: 180, durationSec: 600, startIndex: 7200 }); // not in the threshold band
    const absent = gradeDurabilityDelivery("B", [onlyZ2, rideEnd], FTP, TOTAL)!;
    expect(absent.signal).toBe(-2);
    expect(absent.delivered).toBe(false);

    const earlyThreshold = iv({ avgWatts: 266, durationSec: 600, startIndex: 600 }); // right effort, frac 0.067 (early)
    expect(gradeDurabilityDelivery("B", [earlyThreshold, rideEnd], FTP, TOTAL)?.signal).toBe(0);
  });

  it("E: rewards surges spread across the ride, neutral when all back-loaded", () => {
    const surge = (startIndex: number) => iv({ avgWatts: 280, durationSec: 60, startIndex }); // ~100% FTP, 1 min
    const spread = gradeDurabilityDelivery("E", [surge(900), surge(4500), surge(8100), rideEnd], FTP, TOTAL)!; // fracs .1/.5/.9
    expect(spread.signal).toBe(2);

    const clustered = gradeDurabilityDelivery("E", [surge(7800), surge(8100), surge(8400), rideEnd], FTP, TOTAL)!; // all late, no spread
    expect(clustered.signal).toBe(0);
  });

  it("timing is sample-index based, so smart-recording / paused time doesn't mis-place an effort (EC-2)", () => {
    // Same late threshold effort, but the stream is half-rate (smart recording): indices are ~half the
    // seconds. start_index/movingTimeSec would read frac ~0.4 (early) → mis-graded; index/maxEndIndex stays 0.8.
    const lateHalfRate = iv({ avgWatts: 266, durationSec: 600, startIndex: 3600 }); // 0.8 of the 4500-sample stream
    const endHalfRate = iv({ avgWatts: 150, durationSec: 600, startIndex: 4200, endIndex: 4500 });
    expect(gradeDurabilityDelivery("B", [lateHalfRate, endHalfRate], FTP, TOTAL)?.signal).toBe(2);
  });
});
