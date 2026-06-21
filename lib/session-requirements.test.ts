import { describe, expect, it } from "vitest";
import { deriveSessionRequirements, formatSessionRequirements, validateSessionRequirements } from "./session-requirements";
import type { PlannedDay } from "./types";

const day = (type: PlannedDay["type"]): PlannedDay => ({
  date: "2026-06-15",
  weekNumber: 1,
  weekTheme: "",
  name: `${type} session`,
  type,
  durationMin: type === "Rest" ? 0 : 90,
  workoutText: "",
  description: "",
});

describe("deriveSessionRequirements", () => {
  it("flags terrain/race goals and requires a RaceSim", () => {
    const r = deriveSessionRequirements("Win the hilly KOM road race", []);
    expect(r.terrainRace).toBe(true);
    expect(r.requireRaceSim).toBe(true);
    expect(r.tags).toEqual(expect.arrayContaining(["climbing", "racing"]));
  });

  it("picks up demands from weakpoints too", () => {
    const r = deriveSessionRequirements("Raise FTP", ["poor on punchy attacks"]);
    expect(r.tags).toContain("punchy");
    expect(r.requireRaceSim).toBe(true);
  });

  it("does not require RaceSim for a flat/non-terrain goal", () => {
    const r = deriveSessionRequirements("Improve 40k TT power on the flats", []);
    expect(r.terrainRace).toBe(false);
    expect(r.requireRaceSim).toBe(false);
    expect(r.tags).toEqual([]);
  });

  it("respects negation — 'avoid hills' / 'no racing' don't trigger a requirement (CR-7)", () => {
    expect(deriveSessionRequirements("Base block — avoid hills, no racing this build", []).requireRaceSim).toBe(false);
    expect(deriveSessionRequirements("Build FTP, without climbing", []).tags).not.toContain("climbing");
    // a genuine mention still counts even with a negation elsewhere
    expect(deriveSessionRequirements("No rest weeks — peak for the hilly KOM race", []).requireRaceSim).toBe(true);
  });

  it("scopes negation to its own clause — doesn't reach across into a later tag (RR-4)", () => {
    // "no" negates gym/sprints, not the climbing/racing in the next clause. The old 15-char back-scan
    // wrongly negated these; clause-scoping leaves the tags standing.
    expect(deriveSessionRequirements("no gym, hilly race", []).requireRaceSim).toBe(true);
    expect(deriveSessionRequirements("no sprints but big climbs", []).tags).toContain("climbing");
    // …while a same-clause negation still flips the tag.
    expect(deriveSessionRequirements("no climbing this block", []).tags).not.toContain("climbing");
  });
});

describe("formatSessionRequirements", () => {
  it("returns a prompt line for terrain goals, null otherwise", () => {
    expect(formatSessionRequirements(deriveSessionRequirements("hill climbs", []))).toContain("RaceSim");
    expect(formatSessionRequirements(deriveSessionRequirements("flat TT", []))).toBeNull();
  });
});

describe("validateSessionRequirements", () => {
  const terrain = deriveSessionRequirements("hilly road race", []);

  it("warns when a terrain goal has no RaceSim in the block", () => {
    const w = validateSessionRequirements([day("Threshold"), day("Z2"), day("Rest")], terrain);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/RaceSim/);
  });

  it("passes when a RaceSim is present", () => {
    expect(validateSessionRequirements([day("RaceSim"), day("Z2")], terrain)).toEqual([]);
  });

  it("never warns when no requirement applies", () => {
    expect(validateSessionRequirements([day("Z2")], deriveSessionRequirements("flat TT", []))).toEqual([]);
  });

  it("flags a loading week (≥2 quality, no RaceSim) but not one that has a RaceSim (CR-12)", () => {
    const d = (type: PlannedDay["type"], weekNumber: number): PlannedDay => ({ date: "2026-06-15", weekNumber, weekTheme: "", name: type, type, durationMin: type === "Rest" ? 0 : 90, workoutText: "", description: "" });
    const days = [d("Threshold", 1), d("VO2max", 1), d("RaceSim", 2), d("Threshold", 2)];
    const w = validateSessionRequirements(days, terrain);
    expect(w.some((m) => /week 1/.test(m))).toBe(true);
    expect(w.some((m) => /week 2/.test(m))).toBe(false);
  });

  const wd = (type: PlannedDay["type"], weekNumber: number, weekTheme = ""): PlannedDay => ({ date: "2026-06-15", weekNumber, weekTheme, name: type, type, durationMin: type === "Rest" ? 0 : 90, workoutText: "", description: "" });

  it("consolidates multiple offending loading weeks into ONE warning naming them all (RR-8)", () => {
    // weeks 1 & 3 are loading and RaceSim-less; week 2 carries the RaceSim.
    const days = [wd("Threshold", 1), wd("VO2max", 1), wd("RaceSim", 2), wd("Threshold", 2), wd("Threshold", 3), wd("SIT", 3)];
    const w = validateSessionRequirements(days, terrain);
    expect(w).toHaveLength(1); // one consolidated warning, NOT one per week
    expect(w[0]).toMatch(/weeks 1, 3 are loading weeks/);
  });

  it("does not flag a recovery/deload week even with ≥2 quality (RR-3)", () => {
    const days = [wd("Threshold", 2, "Recovery week"), wd("VO2max", 2, "Recovery week")];
    const w = validateSessionRequirements(days, terrain);
    expect(w).toHaveLength(1); // block-level floor still fires (zero RaceSim in the block)…
    expect(w[0]).not.toMatch(/loading week/); // …but it is NOT the per-week loading-week flag
    expect(w[0]).toMatch(/no RaceSim session was prescribed/);
  });

  it("falls back to the block-level floor when no loading week exists (RR-9)", () => {
    const w = validateSessionRequirements([wd("Threshold", 1), wd("Z2", 1)], terrain); // only 1 quality → not loading
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no RaceSim session was prescribed/);
  });
});
