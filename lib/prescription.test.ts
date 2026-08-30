import { describe, expect, it } from "vitest";
import {
  assertPrescriptionValid,
  carriesEmbeddedIntensity,
  formatPrescriptionLabel,
  parseCyclingPrescription,
  parsePrescription,
  prescriptionsEqual,
  reconcileDurationMin,
  renderPrescription,
  totalPrescribedMinutes,
} from "./prescription";
import type { CyclingPrescription } from "./prescription";
import type { PlannedDay, PrescribedInterval } from "./types";

const FTP = 288;

describe("typed prescription round trip", () => {
  it.each<CyclingPrescription>([
    { targetMode: "power", sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 300, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 95, maxPctFtp: 100 }, cue: "Smooth power", hrCeilingBpm: 145 }] }] },
    { targetMode: "power", sections: [{ name: "Warmup", repeats: 1, steps: [{ durationSec: 600, end: "timer", role: "warmup", target: { kind: "power-ramp", fromPctFtp: 50, toPctFtp: 75 }, cue: "Settle in" }] }] },
    { targetMode: "power", sections: [{ name: "Cooldown", repeats: 1, steps: [{ durationSec: 600, end: "timer", role: "cooldown", target: { kind: "power-ramp", fromPctFtp: 75, toPctFtp: 50 }, cue: "Ease down" }] }] },
    { targetMode: "power", sections: [{ name: "Cooldown", repeats: 1, steps: [{ durationSec: 600, end: "timer", role: "cooldown", target: { kind: "power-zone", minZone: 1, maxZone: 2 } }] }] },
    { targetMode: "heartRate", sections: [{ name: "Main Set", repeats: 3, steps: [{ durationSec: 240, end: "timer", role: "active", target: { kind: "hr-percent", basis: "lthr", minPct: 95, maxPct: 100 } }, { durationSec: 120, end: "timer", role: "recovery", target: { kind: "hr-zone", minZone: 1, maxZone: 2 } }] }] },
    { targetMode: "heartRate", sections: [{ name: "Warmup", repeats: 1, steps: [{ durationSec: 600, end: "lapButton", role: "warmup", target: { kind: "hr-zone", minZone: 1, maxZone: 2 }, cue: "When safely positioned" }] }] },
  ])("round-trips %#", (value) => {
    const text = renderPrescription(value, { lapButtonSteps: true });
    expect(prescriptionsEqual(parseCyclingPrescription(text), value)).toBe(true);
  });

  it("renders the canonical token order and duration units", () => {
    const value: CyclingPrescription = {
      targetMode: "power",
      sections: [{
        name: "Main Set",
        repeats: 2,
        steps: [{ durationSec: 3661, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 100, maxPctFtp: 100 }, cue: "Hold steady", hrCeilingBpm: 145 }],
      }],
    };
    expect(renderPrescription(value, { lapButtonSteps: false })).toBe(
      "Main Set 2x\n- Hold steady HR cap 145bpm 1h1m1s 100% intensity=active"
    );
  });

  it("keeps legacy cadence and duration quotes parseable but never renders cadence", () => {
    const parsed = parseCyclingPrescription("Main Set 2x\n- 5'30\" 95%-100% 90-100rpm intensity=active");
    expect(parsed.sections[0].steps[0].durationSec).toBe(330);
    expect(renderPrescription(parsed, { lapButtonSteps: false })).not.toMatch(/rpm|cadence/i);
  });

  it("accepts stored range targets that put the percent sign only at the end", () => {
    expect(parseCyclingPrescription("Warmup\n- 10' ramp 50-75%").sections[0].steps[0].target).toEqual({
      kind: "power-ramp",
      fromPctFtp: 50,
      toPctFtp: 75,
    });
    expect(parseCyclingPrescription("Main Set\n- 5m 95-100% LTHR").sections[0].steps[0].target).toEqual({
      kind: "hr-percent",
      basis: "lthr",
      minPct: 95,
      maxPct: 100,
    });
  });

  it("rejects invalid target families, ramps and lap endings", () => {
    const valid: CyclingPrescription = {
      targetMode: "power",
      sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 60, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 95, maxPctFtp: 100 } }] }],
    };
    expect(() => assertPrescriptionValid({ ...valid, targetMode: "heartRate" }, { lapButtonSteps: false })).toThrow(/target mode/i);
    expect(() => assertPrescriptionValid({ ...valid, sections: [{ ...valid.sections[0], steps: [{ ...valid.sections[0].steps[0], target: { kind: "power-ramp", fromPctFtp: 50, toPctFtp: 75 } }] }] }, { lapButtonSteps: false })).toThrow(/ramp/i);
    expect(() => assertPrescriptionValid({ ...valid, sections: [{ ...valid.sections[0], steps: [{ ...valid.sections[0].steps[0], end: "lapButton", role: "recovery" }] }] }, { lapButtonSteps: false })).toThrow(/capability/i);
    expect(() => assertPrescriptionValid({ ...valid, sections: [{ ...valid.sections[0], steps: [{ ...valid.sections[0].steps[0], end: "lapButton" }] }] }, { lapButtonSteps: true })).toThrow(/warmup or recovery/i);
  });

  it("rejects mixed parsed targets and invalid semantic ranges", () => {
    expect(() => parseCyclingPrescription("Main Set\n- 5m 100% intensity=active\n- 5m Z2 HR intensity=recovery")).toThrow(/mixed target families/i);
    const value: CyclingPrescription = {
      targetMode: "heartRate",
      sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 60, end: "timer", role: "active", target: { kind: "hr-percent", basis: "max", minPct: 100, maxPct: 95 } }] }],
    };
    expect(() => assertPrescriptionValid(value, { lapButtonSteps: false })).toThrow(/ascending order/i);
    expect(() => assertPrescriptionValid({ ...value, sections: [] }, { lapButtonSteps: false })).toThrow(/at least one section/i);
    expect(() => assertPrescriptionValid({ ...value, sections: [{ ...value.sections[0], repeats: 0 }] }, { lapButtonSteps: false })).toThrow(/repeats/i);
    expect(() => assertPrescriptionValid({ ...value, sections: [{ ...value.sections[0], steps: [] }] }, { lapButtonSteps: false })).toThrow(/must not be empty/i);
    expect(() => assertPrescriptionValid({ ...value, sections: [{ ...value.sections[0], steps: [{ ...value.sections[0].steps[0], durationSec: 0 }] }] }, { lapButtonSteps: false })).toThrow(/duration/i);
    expect(() => assertPrescriptionValid({ ...value, sections: [{ ...value.sections[0], steps: [{ ...value.sections[0].steps[0], target: { kind: "hr-zone", minZone: 1, maxZone: 2 }, hrCeilingBpm: 145 }] }] }, { lapButtonSteps: false })).toThrow(/HR-led/i);
  });

  it("rejects noncanonical and nested repeat headers", () => {
    expect(() => parseCyclingPrescription("2x\n- 5m 100% intensity=active")).toThrow(/section header/i);
    expect(() => parseCyclingPrescription("Main Set 2x 3x\n- 5m 100% intensity=active")).toThrow(/section header/i);
  });

  it("infers roles for legacy unlabelled steps", () => {
    const parsed = parseCyclingPrescription("- 5m 70%\n- 5m 95%");
    expect(parsed.sections).toEqual([{ name: "Main Set", repeats: 1, steps: [
      { durationSec: 300, end: "timer", role: "recovery", target: { kind: "power-percent", minPctFtp: 70, maxPctFtp: 70 } },
      { durationSec: 300, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 95, maxPctFtp: 95 } },
    ] }]);
  });

  it("uses rich duration for canonical HR repeats", () => {
    const text = "Warmup\n- 10m Z1-Z2 HR intensity=warmup\n\nMain Set 3x\n- 4m 95%-100% LTHR intensity=active\n- 2m Z1-Z2 HR intensity=recovery";
    expect(totalPrescribedMinutes(text)).toBe(28);
  });

  it.each([
    "Press lap when ready",
    "press LAP when ready",
    "Watch HR cap 145bpm",
    "watch hr CAP 145BPM",
    "",
    "   ",
    " Leading",
    "Trailing ",
    "Two\nlines",
  ])("rejects non-canonical cue %j", (cue) => {
    const value: CyclingPrescription = {
      targetMode: "power",
      sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 300, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 100, maxPctFtp: 100 }, cue }] }],
    };
    expect(() => renderPrescription(value, { lapButtonSteps: false })).toThrow(/cue/i);
  });

  it("rejects a second target instead of silently treating it as a cue", () => {
    expect(() => parseCyclingPrescription("Main Set\n- 5m 80% then 5m 90% intensity=active")).toThrow(/exactly one target/i);
  });

  it("rejects an earlier ramp target instead of silently treating it as a cue", () => {
    expect(() => parseCyclingPrescription("Main Set\n- 5m ramp 50-75% then 2m 95% intensity=active")).toThrow(/exactly one target/i);
  });

  it("preserves ordinary cues that mention a zone", () => {
    const value: CyclingPrescription = {
      targetMode: "power",
      sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 300, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 70, maxPctFtp: 70 }, cue: "Start in Z2" }] }],
    };
    expect(prescriptionsEqual(parseCyclingPrescription(renderPrescription(value, { lapButtonSteps: false })), value)).toBe(true);
  });

  it("routes case-insensitive canonical roles through rich duration parsing", () => {
    expect(totalPrescribedMinutes("Main Set\n- 5m Z2 HR intensity=ACTIVE")).toBe(5);
  });
});

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

  it("HR-16: a single line naming TWO efforts keeps both as separate reps, not just the first (RaceSim compound-move regression)", () => {
    // Real live RaceSim text: "Move 3: Seated climb 2m30s 108%, then standing attack 25s 140%" — a
    // single "- " line describing a climb effort AND a standing attack. Before the fix, parseStep's
    // non-global regex only ever captured the FIRST duration+%FTP pair per line, silently dropping
    // the standing attack entirely — so execution-scoring never checked whether it was ridden.
    const wo = "Main Set\n- Move 1: Seated climb 2m30s 108%, then standing attack 25s 140%";
    const p = parsePrescription(wo, FTP);
    expect(p).toHaveLength(2);
    expect(p.map((i) => ({ durationSec: i.durationSec, targetPctFtp: i.targetPctFtp }))).toEqual([
      { durationSec: 150, targetPctFtp: 108 },
      { durationSec: 25, targetPctFtp: 140 },
    ]);
  });

  it("keeps canonical role/cap cues out of legacy power work and never reads HR percentages as FTP", () => {
    expect(parsePrescription("Main Set\n- HR cap 145bpm 5m 95%-100% intensity=active", FTP)[0]).toMatchObject({
      durationSec: 300,
      targetPctFtp: 100,
    });
    expect(parsePrescription("Main Set\n- 5m 95%-100% LTHR intensity=active", FTP)).toEqual([]);
    expect(parsePrescription("Main Set\n- 5m 95%-100% HR intensity=active", FTP)).toEqual([]);
  });

  it("preserves decimal power targets while still excluding decimal HR ranges", () => {
    expect(parsePrescription("Main Set\n- 5m 95.5% intensity=active", FTP)[0]).toMatchObject({
      durationSec: 300,
      targetPctFtp: 95.5,
      targetWatts: 275,
    });
    expect(parsePrescription("Main Set\n- 5m 95.5%-100.5% LTHR intensity=active", FTP)).toEqual([]);
    expect(parsePrescription("Main Set\n- 5m 95.5%-100.5% HR intensity=active", FTP)).toEqual([]);
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
  it("HR-16: counts BOTH efforts on a compound multi-effort line, not just the first (real RaceSim text)", () => {
    // The exact live text (2026-07-30 RaceSim day) that produced a reported ~59min real total when
    // it should be ~60.25min — the gap was this exact bug, silently dropping the standing attacks.
    const text =
      "Warmup\n- 15m ramp 50-72%\n- 3m 55%\n\nMain Set\n- Move 3: Seated climb 2m30s 108%, then standing attack 25s 140%\n\nCooldown\n- 12m 50%";
    // warmup 15+3=18, move 2.5+25/60=2.91666.., cooldown 12 → 18 + 2.91666.. + 12 = 32.91666..
    expect(totalPrescribedMinutes(text)).toBeCloseTo(18 + 2.5 + 25 / 60 + 12, 5);
  });
  it("falls back to the legacy multi-clause scanner when stored prose also carries role metadata", () => {
    expect(totalPrescribedMinutes("Main Set\n- 2m 100%, then 30s 150% intensity=active")).toBe(2.5);
  });
  it("HR-27: a repeat header on an excluded (warmup/cooldown) section is not multiplied", () => {
    // "Warmup 2x" is malformed prose no real KB workout would intentionally write, but if the model
    // ever does, a 10m warmup step must count once (10m), not 2x (20m) — repeats only apply to work.
    const text = "Warmup 2x\n- 10m ramp 50-65%\n\nMain\n- 20m 90%\n\nCooldown\n- 10m 50%";
    expect(totalPrescribedMinutes(text)).toBe(10 + 20 + 10); // 40, not 50
  });
});

describe("reconcileDurationMin — HR-19: make NodeVelo's own number match what Intervals.icu will show", () => {
  const day = (overrides: Partial<PlannedDay>): PlannedDay => ({
    date: "2026-07-30", weekNumber: 1, weekTheme: "", name: "n", type: "RaceSim", durationMin: 90,
    workoutText: "Warmup\n- 15m ramp 50-70%\n\nMain\n- 30m 100%\n\nCooldown\n- 10m 50%", description: "",
    ...overrides,
  });

  it("overwrites a mismatched durationMin with the real prescribed total, rounded", () => {
    // real = 15+30+10 = 55, stated 90 — should be corrected to 55, not just flagged.
    const [d] = reconcileDurationMin([day({ durationMin: 90 })]);
    expect(d.durationMin).toBe(55);
  });

  it("leaves an already-matching day untouched (same object reference, not just equal value)", () => {
    const input = day({ durationMin: 55 });
    const [d] = reconcileDurationMin([input]);
    expect(d).toBe(input);
  });

  it("leaves Strength days untouched even though their prose text has no parseable steps", () => {
    // Strength gets an explicit moving_time from durationMin directly (lib/plan-parser.ts) — real
    // Intervals.icu duration for a Strength event IS the stated number, never step-parsed. Forcibly
    // reconciling it to totalPrescribedMinutes's ~0 would zero out a real strength session.
    const input = day({ type: "Strength", durationMin: 45, workoutText: "1. Barbell squat 4x6\n2. Deadlift 3x8" });
    const [d] = reconcileDurationMin([input]);
    expect(d.durationMin).toBe(45);
    expect(d).toBe(input);
  });

  it("leaves Rest days (no workoutText) untouched", () => {
    const input = day({ type: "Rest", durationMin: 0, workoutText: "" });
    const [d] = reconcileDurationMin([input]);
    expect(d).toBe(input);
  });

  it("reconciles the real RaceSim day end-to-end: stated 90min corrects to the true 60min (HR-16's fix reflected here too)", () => {
    const text =
      "Warmup\n- 15m ramp 50-72%\n- 3m 55%\n\nMain Set\n- Move 1: Seated climb 2m 102%\n- Easy 3m 55%\n- Move 2: Seated climb 3m 105%\n- Easy 2m 55%\n- Move 3: Seated climb 2m30s 108%, then standing attack 25s 140%\n- Easy 5m 55%\n- Move 4: Seated climb 4m 112%, then standing attack 20s 150%\n- Easy 4m 55%\n- Move 5 (hardest): Seated climb 3m30s 115%, then standing attack 30s 160%\n\nCooldown\n- 12m 50%";
    const [d] = reconcileDurationMin([day({ durationMin: 90, workoutText: text })]);
    expect(d.durationMin).toBe(60); // Math.round(60.25)
  });
});
