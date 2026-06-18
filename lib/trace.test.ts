import { describe, expect, it } from "vitest";
import { buildRideTrace } from "./trace";
import type { ExecutedInterval } from "./types";

const work = (startIndex: number, endIndex: number): ExecutedInterval => ({
  type: "WORK",
  durationSec: endIndex - startIndex,
  avgWatts: 300,
  npWatts: 305,
  avgHr: 165,
  startIndex,
  endIndex,
});

describe("buildRideTrace", () => {
  it("returns null for a stream too short to chart", () => {
    expect(buildRideTrace([100], [], [], null)).toBeNull();
  });

  it("smooths spiky power so the trace isn't dominated by a single-second spike (UI-5)", () => {
    // 61 samples at 100 W with one 1000 W spike — the 30 s smoothing should flatten it.
    const power = Array.from({ length: 61 }, (_, i) => (i === 30 ? 1000 : 100));
    const trace = buildRideTrace(power, [], [], null)!;
    expect(Math.max(...trace.power)).toBeLessThan(200); // spike tamed (raw was 1000)
    expect(trace.power.length).toBe(61); // under the 240-point cap → not downsampled
  });

  it("maps WORK intervals to fractional bands and skips untyped/invalid efforts", () => {
    const power = Array.from({ length: 100 }, () => 200);
    const executed = [
      work(10, 30), // → 0.1–0.3
      { ...work(50, 50), durationSec: 0 }, // zero-width → dropped
      { ...work(60, 80), type: "RECOVERY" }, // not WORK → dropped
    ];
    const trace = buildRideTrace(power, [], executed, 250)!;
    expect(trace.bands).toEqual([{ start: 0.1, end: 0.3 }]);
    expect(trace.targetWatts).toBe(250);
  });
});
