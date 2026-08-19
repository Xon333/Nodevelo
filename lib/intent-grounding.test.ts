import { describe, expect, it } from "vitest";
import {
  groundsCadenceRpm,
  groundsDuration,
  groundsHrBpm,
  groundsPctFtp,
  groundsReps,
  groundsTerrain,
  groundsWatts,
  groundsZone,
  maskZoneTokens,
  verifyGrounding,
  ZONE_MASK,
} from "./intent-grounding";

describe("semantic intent grounding", () => {
  it("masks zone tokens with printable digit-free text", () => {
    expect(maskZoneTokens("Z4, zone 5, and z6")).toBe(`${ZONE_MASK}, ${ZONE_MASK}, and ${ZONE_MASK}`);
  });

  it("grounds duration only from duration forms", () => {
    expect(groundsDuration("45 min steady Z2", 45)).toBe(true);
    expect(groundsDuration("45m steady Z2", 45)).toBe(true);
    expect(groundsDuration("9m effort", 9)).toBe(true);
    expect(groundsDuration("1.5 h endurance", 90)).toBe(true);
    expect(groundsDuration("40–50 min", 45)).toBe(true);
    expect(groundsDuration("45 W", 45)).toBe(false);
  });

  it("grounds the apostrophe minute shorthand interval notation uses", () => {
    expect(groundsDuration("45'", 45)).toBe(true);
    expect(groundsDuration("3x5' at threshold", 5)).toBe(true);
    expect(groundsDuration("40-50' steady", 45)).toBe(true); // the `inRanges` call site, same unit const
    expect(groundsDuration("3x5' at threshold", 3)).toBe(false);
  });

  it("does not read speed or distance-rate units as bare-minute durations", () => {
    expect(groundsDuration("45mph", 45)).toBe(false);
    expect(groundsDuration("45m/s", 45)).toBe(false);
  });

  it("does not ground ambiguous colon durations", () => {
    expect(groundsDuration("4:30", 4.5)).toBe(false);
    expect(groundsDuration("4:30", 270)).toBe(false);
    expect(groundsDuration("9:00", 9)).toBe(false);
    expect(groundsDuration("9:00", 540)).toBe(false);
    expect(groundsDuration("4:60", 300)).toBe(false);
  });

  it("grounds watts only from watt forms", () => {
    expect(groundsWatts("9 min around 292 W", 292)).toBe(true);
    expect(groundsWatts("290-300 W", 295)).toBe(true);
    expect(groundsWatts("292%", 292)).toBe(false);
    expect(groundsWatts("45 min steady Z2", 45)).toBe(false);
  });

  it("grounds FTP percentages only from percentage forms", () => {
    expect(groundsPctFtp("9 min at 95% FTP", 95)).toBe(true);
    expect(groundsPctFtp("20 min at 88-92%", 88)).toBe(true);
    expect(groundsPctFtp("20 min at 88-92%", 92)).toBe(true);
    expect(groundsPctFtp("20 min at 88-92%", 90)).toBe(true);
    expect(groundsPctFtp("95 W", 95)).toBe(false);
  });

  it("grounds repetitions only from repetition forms", () => {
    expect(groundsReps("4 x 5 min at 300w", 4)).toBe(true);
    expect(groundsReps("3 sets of efforts", 3)).toBe(true);
    expect(groundsReps("4 min", 4)).toBe(false);
  });

  it("grounds zones from zone tokens and explicit zone words", () => {
    expect(groundsZone("45 min steady Z2", "Z2")).toBe(true);
    expect(groundsZone("1.5 h endurance", "Z2")).toBe(true);
    expect(groundsZone("sweet spot work", "Z3")).toBe(true);
    expect(groundsZone("VO2max efforts", "Z5")).toBe(true);
    expect(groundsZone("45 min", "Z2")).toBe(false);
  });

  // NV-2 (2026-08-15): live-confirmed on a real overlay — the target's zone arrived as a bare "3", and
  // groundsZone required the exact canonical "Z3" string, so an explicitly-stated zone claim was
  // reported as "not grounded in the note" even though the note literally said "z3". Ranges like "3-4"
  // (also seen verbatim in production) were unrepresentable by either side.
  it("grounds a bare-digit zone target the same as its canonical Z-prefixed form (the live bug)", () => {
    expect(groundsZone("Main z3 block, 75 minutes", "3")).toBe(true);
    expect(groundsZone("Main z3 block, 75 minutes", "zone 3")).toBe(true);
    expect(groundsZone("no zone mentioned here", "3")).toBe(false);
  });

  it("grounds a range zone target when the note mentions ANY zone within the range", () => {
    expect(groundsZone("z3 low z4 average on climbs", "3-4")).toBe(true);
    expect(groundsZone("push into z4 on the climbs", "Z3-4")).toBe(true); // only the high end is mentioned
    expect(groundsZone("steady z2 the whole way", "3-4")).toBe(false);
  });

  it("grounds a comma-list zone target the same way", () => {
    expect(groundsZone("z2 on the flats, z3 on climbs", "z2,z3")).toBe(true);
    expect(groundsZone("all z1 recovery", "z2,z3")).toBe(false);
  });

  it("stays false for a genuinely unparseable zone expression, never guesses", () => {
    expect(groundsZone("z3 block", "bogus")).toBe(false);
    expect(groundsZone("z3 block", "z9")).toBe(false);
  });

  it("keeps watts and percentage targets separate", () => {
    expect(groundsDuration("9 min around 292 W", 9)).toBe(true);
    expect(groundsWatts("9 min around 292 W", 292)).toBe(true);
    expect(groundsPctFtp("9 min around 292 W", 292)).toBe(false);
    expect(groundsReps("4 x 5 min at 300w", 4)).toBe(true);
    expect(groundsDuration("4 x 5 min at 300w", 5)).toBe(true);
    expect(groundsWatts("4 x 5 min at 300w", 300)).toBe(true);
    expect(groundsDuration("9 min at 95% FTP", 9)).toBe(true);
    expect(groundsPctFtp("9 min at 95% FTP", 95)).toBe(true);
    expect(groundsWatts("9 min at 95% FTP", 274)).toBe(false);
  });

  it("a digit inside a zone token grounds NOTHING else — the invented-specificity case", () => {
    const note = "some Z4 and Z5 efforts";
    expect(groundsZone(note, "Z4")).toBe(true);
    expect(groundsZone(note, "Z5")).toBe(true);
    expect(groundsReps(note, 4)).toBe(false);
    expect(groundsDuration(note, 5)).toBe(false);
    expect(groundsWatts(note, 4)).toBe(false);
  });

  it("verifyGrounding may only LOWER the model's claim", () => {
    const claimed = { grounded: true, kind: "effort" as const, target: { reps: 4 }, sourceText: "some Z4 efforts" };
    expect(verifyGrounding(claimed, "some Z4 efforts")).toBe(false);
    const honest = { ...claimed, grounded: false, target: { durationMin: 9, watts: 292 } };
    expect(verifyGrounding(honest, "9 min around 292 W")).toBe(false);
  });

  it("does not ground one segment's metric from another segment's source span", () => {
    const objective = {
      grounded: true,
      target: { segmentLabel: "Rolling Terrain", normalizedPowerZone: "Z5" },
      sourceText: "Rolling Terrain segment (Z3 avg, Z4 NP, 20m)",
    };
    const note = `${objective.sourceText} Short Effort segment (Z4 avg, Z5 NP, 6m)`;
    expect(verifyGrounding(objective, note)).toBe(false);
  });
});

describe("Phase 3b grounding — HR, cadence, terrain", () => {
  it("grounds an HR ceiling only from a bpm-unit form", () => {
    expect(groundsHrBpm("if HR goes over 154bpm dial back", 154)).toBe(true);
    expect(groundsHrBpm("30 min effort", 154)).toBe(false); // no bpm unit anywhere — must not invent one
  });

  it("grounds a cadence target only from an rpm-unit form", () => {
    expect(groundsCadenceRpm("high cadence spin, aim for 95rpm", 95)).toBe(true);
    expect(groundsCadenceRpm("30 min effort", 95)).toBe(false);
  });

  it("grounds a terrain claim from climb/descent vocabulary", () => {
    expect(groundsTerrain("did a proper climb today", "climb")).toBe(true);
    expect(groundsTerrain("fast technical descent at the end", "descent")).toBe(true);
    expect(groundsTerrain("steady z2 ride", "climb")).toBe(false);
  });

  it("no longer rejects a terrain-only objective outright — the R1 bug this step fixes", () => {
    const objective = { grounded: true, target: { terrain: "climb" as const } };
    expect(verifyGrounding(objective, "did a proper climb today")).toBe(true);
  });

  it("no longer lets an invented HR value pass on another field's coattails — the other R1 bug", () => {
    const objective = { grounded: true, target: { durationMin: 30, targetHrBpm: 154 } };
    expect(verifyGrounding(objective, "30 min steady endurance ride")).toBe(false); // no bpm anywhere
  });
});
