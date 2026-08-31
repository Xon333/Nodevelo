import { describe, expect, it } from "vitest";
import { deriveSessionRequirements, validateSessionRequirements } from "./session-requirements";
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

  // P5 (2026-07-24 block-generation redesign): relaxed from "≥1 per loading week" to "≥1 sporadically
  // across the whole block" — structured interval work (the block's primary quality) takes priority
  // over RaceSim for the shared weekly quality-session budget, per athlete direction.
  const wd = (type: PlannedDay["type"], weekNumber: number): PlannedDay => ({ date: "2026-06-15", weekNumber, weekTheme: "", name: type, type, durationMin: type === "Rest" ? 0 : 90, workoutText: "", description: "" });

  it("does not require RaceSim in every week — one RaceSim anywhere in a multi-week block passes", () => {
    // Weeks 1 and 3 have no RaceSim at all; only week 2 does. No longer a violation (P5).
    const days = [wd("Threshold", 1), wd("VO2max", 1), wd("RaceSim", 2), wd("Threshold", 2), wd("Threshold", 3), wd("SIT", 3)];
    expect(validateSessionRequirements(days, terrain)).toEqual([]);
  });

  it("still warns when the whole block ships zero RaceSim across multiple weeks", () => {
    const days = [wd("Threshold", 1), wd("VO2max", 1), wd("Threshold", 2), wd("SIT", 2)];
    const w = validateSessionRequirements(days, terrain);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no RaceSim session was prescribed anywhere in the block/);
  });
});
