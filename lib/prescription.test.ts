import { describe, expect, it } from "vitest";
import { carriesEmbeddedIntensity, formatPrescriptionLabel, parsePrescription, totalPrescribedMinutes } from "./prescription";
import type { PrescribedInterval } from "./types";

const FTP = 288;

describe("formatPrescriptionLabel", () => {
  // Derives the chip from structural fields so a stale stored `label` (pre-3801d6b blocks showed 30s as
  // "1m") is never trusted at the point of use.
  it("formats sub-minute reps as seconds, not a rounded-up minute", () => {
    expect(formatPrescriptionLabel({ reps: 6, durationSec: 30, targetWatts: 432 })).toBe("6×30s @ 432W");
  });
  it("drops the reps prefix for a single effort and handles exact/mixed minutes", () => {
    expect(formatPrescriptionLabel({ reps: 1, durationSec: 1200, targetWatts: 288 })).toBe("20m @ 288W");
    expect(formatPrescriptionLabel({ reps: 3, durationSec: 90, targetWatts: 346 })).toBe("3×1m30s @ 346W");
  });
  it("ignores a stale stored label — it reads only the structural fields", () => {
    const stale: PrescribedInterval = { reps: 6, durationSec: 30, targetWatts: 432, targetPctFtp: 150, label: "6×1m @ 432W" };
    expect(formatPrescriptionLabel(stale)).toBe("6×30s @ 432W");
  });
});

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
  it("does not count a hard warmup priming step as embedded intensity (section fix)", () => {
    // Same 10m 90% dose that trips the floor above — but under a Warmup label it's prep, not
    // an embedded insert, so the ride stays "easy" for spacing/protocol purposes.
    expect(carriesEmbeddedIntensity("Warmup\n- 10m 90%\n\n- 60m 65%", FTP)).toBe(false);
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

  it("parses a repeat-block and its explicit enumeration to the same structure (session-level stability)", () => {
    // The sessionLevel stamp (lib/session-level.ts) relies on structurally-equal prescriptions for
    // equivalent workouts, however the LLM happened to phrase the repeat.
    const collapsed = parsePrescription("Main Set 5x\n- 5m 110%\n- 5m 55%", FTP);
    const explicit = parsePrescription("- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%", FTP);
    expect(explicit).toEqual(collapsed);
  });
});

describe("parsePrescription — warmup/cooldown sections never count as work (section fix)", () => {
  it("excludes a warmup priming step at/above the 80% work floor, regardless of duration", () => {
    // The confirmed false-positive vector: a SIT day's warmup ramping to 80% + a short 85% primer
    // used to be flattened into the work stream and validated as malformed sprint reps.
    const wo = "Warmup\n- 15m ramp 50-80%\n- 5m 85%\n\nMain Set 5x\n- 30s 150%\n- 4m 50%\n\nCooldown\n- 10m 50%";
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 5, durationSec: 30, targetPctFtp: 150 });
  });

  it("keeps a Main Set step at the same intensity a warmup would drop", () => {
    const p = parsePrescription("Main Set 2x\n- 10m 85%\n- 5m 50%", FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 2, durationSec: 600, targetPctFtp: 85 });
  });

  it("excludes a high-intensity cooldown fast-finish", () => {
    const wo = "Main Set 2x\n- 20m 95%\n- 5m 55%\n\nCooldown\n- 2m 110%\n- 8m 50%";
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 2, durationSec: 1200, targetPctFtp: 95 });
  });

  it("a workout with no section labels at all is unchanged", () => {
    const p = parsePrescription("- 20m 95%", FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 1, durationSec: 1200, targetPctFtp: 95 });
  });

  it("an unlabeled group after a blank line leaves the warmup (real Z2/durability format)", () => {
    // Generated Z2/durability rides carry their main work as an UNLABELED group between blank
    // lines ("Warmup\n- ramp\n\n- 70m 62%\n\nCooldown"), so a blank line must end the excluded
    // section — only steps lexically contiguous under the Warmup/Cooldown label are dropped.
    const wo = "Warmup\n- 10m ramp 50-60%\n\n- 12m 95%\n\nCooldown\n- 10m 50%";
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 1, durationSec: 720, targetPctFtp: 95 });
  });

  it("recognises spelling variants: Warm-up / Warm up / COOL DOWN", () => {
    expect(parsePrescription("Warm-up\n- 10m 85%", FTP)).toEqual([]);
    expect(parsePrescription("Warm up\n- 10m 85%", FTP)).toEqual([]);
    const p = parsePrescription("Main Set 2x\n- 20m 95%\n- 5m 55%\n\nCOOL DOWN\n- 5m 110%", FTP);
    expect(p).toHaveLength(1);
    expect(p[0].targetPctFtp).toBe(95);
  });

  it("a custom section label still counts as work — only warmup/cooldown are excluded", () => {
    const p = parsePrescription("Openers 3x\n- 1m 100%\n- 2m 50%", FTP);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ reps: 3, durationSec: 60, targetPctFtp: 100 });
  });
});

describe("totalPrescribedMinutes — the REAL duration Intervals.icu's own step-parser computes", () => {
  it("sums every step regardless of section or intensity (warmup + main + cooldown)", () => {
    const text = "Warmup\n- 15m ramp 50-65%\n\nMain\n- 3h 60-70%\n\nCooldown\n- 15m 55%";
    expect(totalPrescribedMinutes(text)).toBe(15 + 180 + 15); // 210 — matches a real long-ride day
  });
  it("applies the repeat-block multiplier to every step inside it, matching parsePrescription's own repeat semantics", () => {
    const text = "Warmup\n- 10m ramp 50-65%\n- 5m 65%\n\nMain Set 5x\n- Seated all-out 30s 150%\n- Easy spin 4m 50%\n\nCooldown\n- 10m 50%";
    // warmup 15 + 5x(0.5+4) + cooldown 10 = 15 + 22.5 + 10 = 47.5
    expect(totalPrescribedMinutes(text)).toBeCloseTo(47.5, 5);
  });
  it("returns 0 for an empty or Rest workout text", () => {
    expect(totalPrescribedMinutes("")).toBe(0);
  });
  it("counts steps below the work floor and inside warmup/cooldown sections — the opposite of parsePrescription's exclusions", () => {
    // parsePrescription would return [] for this (all sub-80% / inside Warmup/Cooldown); the total-
    // duration view must still count it, because Intervals.icu counts it too.
    const text = "Warmup\n- 10m ramp 50-60%\n\nMain\n- 70m 62%\n\nCooldown\n- 10m 50%";
    expect(totalPrescribedMinutes(text)).toBe(90);
  });
});
