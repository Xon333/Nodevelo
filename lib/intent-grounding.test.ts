import { describe, expect, it } from "vitest";
import {
  groundsDuration,
  groundsPctFtp,
  groundsReps,
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
});
