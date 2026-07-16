import { describe, expect, it } from "vitest";
import { computeSessionLevel } from "./session-level";
import { parsePrescription } from "./prescription";

const FTP = 288;

describe("computeSessionLevel — cross-block comparability", () => {
  it("scores two SIT sessions with different rep counts identically per unit of work time", () => {
    const a = computeSessionLevel("SIT", parsePrescription("Main Set 4x\n- 30s 150%\n- 4m 40%", FTP))!;
    const b = computeSessionLevel("SIT", parsePrescription("Main Set 6x\n- 30s 150%\n- 4m 40%", FTP))!;
    expect(a.avgPctFtp).toBe(150);
    expect(b.avgPctFtp).toBe(150);
    expect(a.bandPosition).toBe(b.bandPosition); // same identity within the SIT band…
    expect(b.score / b.workMin).toBeCloseTo(a.score / a.workMin, 5); // …same intensity per work-minute
    expect(b.score).toBeGreaterThan(a.score); // more reps = more total dose
  });

  it("scores a session at the top of its protocol band higher than one at the bottom", () => {
    const bottom = computeSessionLevel("Threshold", parsePrescription("Main Set 2x\n- 20m 95%\n- 5m 55%", FTP))!;
    const top = computeSessionLevel("Threshold", parsePrescription("Main Set 2x\n- 20m 110%\n- 5m 55%", FTP))!;
    // 2×20m @ 95%: 40 work-min × 0.95 = 38; band (95−80)/(115−80) = 0.43.
    expect(bottom).toEqual({ score: 38, workMin: 40, avgPctFtp: 95, bandPosition: 0.43 });
    expect(top.score).toBe(44);
    expect(top.bandPosition).toBe(0.86);
  });

  it("duration-weights mixed efforts (over-unders) into one average intensity", () => {
    // 4×(1m @ 110% + 2m @ 95%): 12 work-min, weighted avg = (60·110 + 120·95)/180 = 100%.
    const level = computeSessionLevel("Threshold", parsePrescription("Main Set 4x\n- 1m 110%\n- 2m 95%", FTP))!;
    expect(level).toEqual({ score: 12, workMin: 12, avgPctFtp: 100, bandPosition: 0.57 });
  });

  it("normalises SIT against the KB 130–200% band (the protocol table pins only the floor)", () => {
    const level = computeSessionLevel("SIT", parsePrescription("Main Set 5x\n- 30s 150%", FTP))!;
    expect(level.bandPosition).toBe(0.29); // (150 − 130) / (200 − 130)
  });

  it("computes a score but no band position for types without a protocol band (RaceSim)", () => {
    const level = computeSessionLevel("RaceSim", parsePrescription("Main Set 3x\n- 4m 105%\n- 5m 55%", FTP))!;
    expect(level.workMin).toBe(12);
    expect(level.avgPctFtp).toBe(105);
    expect(level.bandPosition).toBeNull();
  });

  it("returns null when the day has no parsed work efforts (Rest, pure endurance)", () => {
    expect(computeSessionLevel("Rest", [])).toBeNull();
    expect(computeSessionLevel("Z2", parsePrescription("- 180m 65%", FTP))).toBeNull();
  });

  it("is identical for a repeat-block and its explicit enumeration (stability across LLM phrasings)", () => {
    const collapsed = computeSessionLevel("VO2max", parsePrescription("Main Set 5x\n- 5m 110%\n- 5m 55%", FTP));
    const explicit = computeSessionLevel(
      "VO2max",
      parsePrescription("- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%", FTP)
    );
    expect(explicit).toEqual(collapsed);
    expect(collapsed!.score).toBe(27.5); // 25 work-min × 1.10
  });
});
