import { describe, expect, it } from "vitest";
import { parsePrescription } from "./prescription";

const FTP = 288;

describe("parsePrescription", () => {
  it("captures a repeated work set with reps, duration and resolved watts", () => {
    const wo = "Warmup\n- 15m ramp 50-70%\n\nMain Set 2x\n- 20m 100%\n- 5m 55%\n\nCooldown\n- 10m 50%";
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 2, durationSec: 1200, targetPctFtp: 100, targetWatts: 288 });
    expect(p[0].label).toBe("2×20m @ 288W");
  });

  it("excludes warmup, recovery valves and endurance steps", () => {
    expect(parsePrescription("- 90m 65%", FTP)).toEqual([]);
    expect(parsePrescription("Warmup\n- 15m ramp 50-70%\n- 10m 55%", FTP)).toEqual([]);
  });

  it("handles VO2 over/unders inside one block (two work efforts)", () => {
    const wo = "Main Set 4x\n- 3m 110%\n- 3m 88%\n- 3m 55%";
    const p = parsePrescription(wo, FTP);
    expect(p.map((i) => [i.reps, i.targetPctFtp])).toEqual([
      [4, 110],
      [4, 88],
    ]);
  });

  it("parses seconds and resets reps after a blank line", () => {
    const wo = "Main Set 8x\n- 30s 150%\n- 30s 50%\n\n- 20m 95%";
    const p = parsePrescription(wo, FTP);
    expect(p[0]).toMatchObject({ reps: 8, durationSec: 30, targetWatts: 432 });
    expect(p[0].label).toBe("8×30s @ 432W"); // 30s must NOT round up to "1m"
    expect(p[1]).toMatchObject({ reps: 1, durationSec: 1200 });
  });

  it("labels sub-minute, exact-minute and mixed durations correctly", () => {
    expect(parsePrescription("Main Set 5x\n- 30s 150%", FTP)[0].label).toBe("5×30s @ 432W");
    expect(parsePrescription("Main Set 4x\n- 4m 110%", FTP)[0].label).toBe("4×4m @ 317W");
    expect(parsePrescription("Main Set 3x\n- 90s 120%", FTP)[0].label).toBe("3×1m30s @ 346W");
  });
});
