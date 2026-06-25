import { describe, expect, it } from "vitest";
import { carriesEmbeddedIntensity, parsePrescription } from "./prescription";

const FTP = 288;

describe("carriesEmbeddedIntensity", () => {
  it("flags a durability ride with a real dose of threshold/VO2 work", () => {
    expect(carriesEmbeddedIntensity("Main Set 3x\n- 12m 95%\n- 6m 60%", FTP)).toBe(true);
  });
  it("ignores pure endurance and sweet-spot/tempo (below the threshold floor)", () => {
    expect(carriesEmbeddedIntensity("- 180m 70%", FTP)).toBe(false);
    expect(carriesEmbeddedIntensity("- 60m 84%", FTP)).toBe(false);
  });
  it("ignores a token hard surge below the dose floor", () => {
    expect(carriesEmbeddedIntensity("- 2m 110%", FTP)).toBe(false); // 2 min < 5 min dose
  });
  it("returns false with no workout", () => {
    expect(carriesEmbeddedIntensity(undefined, FTP)).toBe(false);
  });
  it("honours an overridden hard-effort floor (ROADMAP #2 fold-in)", () => {
    // A 10-min 90% block clears the default 88% floor…
    expect(carriesEmbeddedIntensity("- 10m 90%", FTP)).toBe(true);
    // …but not a raised 95% floor, so it no longer counts as embedded intensity.
    expect(carriesEmbeddedIntensity("- 10m 90%", FTP, 95)).toBe(false);
  });
});

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

  it("expands a multi-step block in EXECUTION ORDER, not per-step (interval-order fix)", () => {
    // "4x { 3m@110, 3m@88 }" is ridden over,under,over,under… — the prescription must alternate to
    // match. The old parser produced [4×110, 4×88], which the order-based matcher then compared against
    // the wrong executed reps (deflating the unders, inflating the overs, inventing "cut short" reps).
    const wo = "Main Set 4x\n- 3m 110%\n- 3m 88%\n- 3m 55%"; // 55% recovery dropped (< work floor)
    const p = parsePrescription(wo, FTP);
    expect(p.map((i) => i.targetPctFtp)).toEqual([110, 88, 110, 88, 110, 88, 110, 88]);
    expect(p.every((i) => i.reps === 1)).toBe(true); // varied block → one entry per rep, in order
  });

  it("repeats a real over-under SET in order — the reported 3×(4×1m/2m) session (regression)", () => {
    const wo = [
      "Warmup",
      "- 35m ramp 50-75%",
      "",
      "Main Set 3x",
      "- 1m 110%",
      "- 2m 95%",
      "- 1m 110%",
      "- 2m 95%",
      "- 1m 110%",
      "- 2m 95%",
      "- 1m 110%",
      "- 3m 95%",
      "- 6m 55%",
    ].join("\n");
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(24); // 8 work steps × 3 sets, warmup + 55% recovery dropped
    // Each set alternates over (1m @ 110%) / under (2m @ 95%), not grouped:
    expect(p.slice(0, 8).map((i) => i.targetPctFtp)).toEqual([110, 95, 110, 95, 110, 95, 110, 95]);
    expect(p.slice(0, 8).map((i) => i.durationSec)).toEqual([60, 120, 60, 120, 60, 120, 60, 180]);
  });

  it("collapses a single repeated work step (no recovery between) to a compact reps>1 label", () => {
    // 5×5min VO2 with recovery valleys → the work steps are consecutive-identical → "5×5m", one chip.
    const p = parsePrescription("Main Set 5x\n- 5m 110%\n- 5m 55%", FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 5, durationSec: 300, targetPctFtp: 110 });
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
