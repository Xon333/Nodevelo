import { describe, expect, it } from "vitest";
import { validateWorkoutProtocol, splitPlanProtocol } from "./workout-validate";
import type { PlannedDay, WorkoutType } from "./types";

const FTP = 288;

function day(type: WorkoutType, workoutText: string): PlannedDay {
  return {
    date: "2026-06-20",
    weekNumber: 1,
    weekTheme: "test",
    name: `${type} session`,
    type,
    durationMin: 60,
    workoutText,
    description: "x",
  };
}

describe("validateWorkoutProtocol — durability inserts in Z2/Recovery (CR-1)", () => {
  it("passes a Z2 ride whose embedded efforts are valid threshold work", () => {
    expect(validateWorkoutProtocol(day("Z2", "Main Set 3x\n- 12m 95%\n- 6m 60%"), FTP)).toEqual([]);
  });
  it("flags an embedded effort above the durability ceiling (supra-VO2)", () => {
    const w = validateWorkoutProtocol(day("Z2", "- 5m 140%"), FTP);
    expect(w.some((m) => /exceeds the 122% ceiling/.test(m))).toBe(true);
  });
  it("flags an absurdly long embedded effort", () => {
    expect(validateWorkoutProtocol(day("Z2", "- 35m 95%"), FTP).some((m) => /longer than protocol/.test(m))).toBe(true);
  });
  it("ignores pure endurance / tempo (no hard inserts)", () => {
    expect(validateWorkoutProtocol(day("Z2", "- 180m 70%"), FTP)).toEqual([]);
    expect(validateWorkoutProtocol(day("Recovery", "- 60m 84%"), FTP)).toEqual([]);
  });
});

describe("validateWorkoutProtocol — durability envelope override (ROADMAP #2 fold-in)", () => {
  const insert = day("Z2", "- 15m 110%"); // a 15-min, 110% FTP embedded effort

  it("passes under the population default envelope (≤122%, ≤20 min)", () => {
    expect(validateWorkoutProtocol(insert, FTP)).toEqual([]);
  });

  it("a tighter %FTP ceiling override flags an insert the default would pass", () => {
    const w = validateWorkoutProtocol(insert, FTP, { embeddedHardPct: 88, maxIntensityPct: 105, maxEffortMin: 20 });
    expect(w.some((m) => /exceeds the 105% ceiling/.test(m))).toBe(true);
  });

  it("a tighter duration override flags an insert the default would pass", () => {
    const w = validateWorkoutProtocol(insert, FTP, { embeddedHardPct: 88, maxIntensityPct: 122, maxEffortMin: 10 });
    expect(w.some((m) => /longer than protocol/.test(m))).toBe(true);
  });

  it("a higher floor override stops counting a sweet-spot effort as a hard insert", () => {
    const ss = day("Z2", "- 35m 90%"); // long 90% block — flagged at the default 88% floor…
    expect(validateWorkoutProtocol(ss, FTP).some((m) => /longer than protocol/.test(m))).toBe(true);
    // …but below a 95% floor it's no longer an "insert" worth validating.
    expect(validateWorkoutProtocol(ss, FTP, { embeddedHardPct: 95, maxIntensityPct: 122, maxEffortMin: 20 })).toEqual([]);
  });
});

describe("validateWorkoutProtocol — SIT", () => {
  it("flags a SIT effort longer than the 30s protocol (the reported 1-min bug)", () => {
    const w = validateWorkoutProtocol(day("SIT", "Main Set 5x\n- 1m 150%\n- 4m 40%"), FTP);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/longer than protocol/);
    expect(w[0]).toMatch(/training §4/);
  });

  it("passes a correct 30s all-out SIT effort", () => {
    expect(validateWorkoutProtocol(day("SIT", "Main Set 5x\n- 30s 150%\n- 4m 40%"), FTP)).toEqual([]);
  });

  it("flags a SIT effort below the 130% maximal floor", () => {
    const w = validateWorkoutProtocol(day("SIT", "Main Set 5x\n- 30s 110%\n- 4m 40%"), FTP);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/below the 130% floor/);
  });
});

describe("validateWorkoutProtocol — VO2max", () => {
  it("passes a classic 4×4 at 110%", () => {
    expect(validateWorkoutProtocol(day("VO2max", "Main Set 4x\n- 4m 110%\n- 4m 50%"), FTP)).toEqual([]);
  });

  it("flags a VO2max effort below the intensity floor", () => {
    const w = validateWorkoutProtocol(day("VO2max", "Main Set 4x\n- 4m 95%\n- 4m 50%"), FTP);
    expect(w[0]).toMatch(/below the 100% floor/);
  });
});

describe("validateWorkoutProtocol — Threshold", () => {
  it("passes a 2×20 at 95%", () => {
    expect(validateWorkoutProtocol(day("Threshold", "Main Set 2x\n- 20m 95%\n- 10m 50%"), FTP)).toEqual([]);
  });

  it("does not false-flag over-unders (1m at 110% stays under the ceiling)", () => {
    expect(validateWorkoutProtocol(day("Threshold", "Main Set 4x\n- 1m 110%\n- 2m 95%"), FTP)).toEqual([]);
  });

  it("flags a threshold step pushed into VO2max territory", () => {
    const w = validateWorkoutProtocol(day("Threshold", "Main Set 3x\n- 10m 120%\n- 5m 50%"), FTP);
    expect(w[0]).toMatch(/exceeds the 115% ceiling/);
  });
});

describe("validateWorkoutProtocol — warmup/cooldown steps are never validated as work (section fix)", () => {
  it("does not flag a SIT day whose warmup ramps to the work floor (the reported false positive)", () => {
    // Pre-fix: the 80% ramp and 85% primer were misread as SIT reps → "below the 130% floor" /
    // "longer than protocol" warnings for a perfectly normal warmup.
    const wo = "Warmup\n- 15m ramp 50-80%\n- 3m 85%\n\nMain Set 5x\n- 30s 150%\n- 4m 40%\n\nCooldown\n- 10m 50%";
    expect(validateWorkoutProtocol(day("SIT", wo), FTP)).toEqual([]);
  });

  it("does not flag a VO2max day's short cooldown surge", () => {
    const wo = "Main Set 4x\n- 4m 110%\n- 4m 50%\n\nCooldown\n- 30s 150%\n- 5m 50%";
    expect(validateWorkoutProtocol(day("VO2max", wo), FTP)).toEqual([]);
  });

  it("still flags a genuine main-set violation when a warmup is present", () => {
    const wo = "Warmup\n- 15m ramp 50-80%\n\nMain Set 5x\n- 30s 110%\n- 4m 40%";
    const w = validateWorkoutProtocol(day("SIT", wo), FTP);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/below the 130% floor/);
  });
});

describe("validateWorkoutProtocol — untyped / empty", () => {
  it("ignores Z2, Recovery, Strength, Rest (no fixed protocol)", () => {
    expect(validateWorkoutProtocol(day("Z2", "- 2h 65%"), FTP)).toEqual([]);
    expect(validateWorkoutProtocol(day("Recovery", "- 45m 50%"), FTP)).toEqual([]);
    expect(validateWorkoutProtocol(day("Rest", ""), FTP)).toEqual([]);
  });

  it("returns [] when there are no parseable work steps", () => {
    expect(validateWorkoutProtocol(day("SIT", "- 30m 60%"), FTP)).toEqual([]);
  });
});

describe("splitPlanProtocol", () => {
  it("routes quality-session breaches to violations and leaves clean days silent", () => {
    const days = [
      day("SIT", "Main Set 5x\n- 1m 150%\n- 4m 40%"), // 1-min SIT reps — protocol breach
      day("Threshold", "Main Set 2x\n- 20m 95%\n- 10m 50%"), // clean
    ];
    const f = splitPlanProtocol(days, FTP);
    expect(f.violations).toHaveLength(1);
    expect(f.violations[0]).toMatch(/SIT/);
    expect(f.violations[0]).toMatch(/longer than protocol/);
    expect(f.advisories).toEqual([]);
  });

  it("keeps endurance-day durability-insert findings advisory (the existing lighter touch)", () => {
    const f = splitPlanProtocol([day("Z2", "- 5m 140%")], FTP);
    expect(f.violations).toEqual([]);
    expect(f.advisories).toHaveLength(1);
    expect(f.advisories[0]).toMatch(/exceeds the 122% ceiling/);
  });

  it("returns empty findings for a clean plan", () => {
    expect(splitPlanProtocol([day("VO2max", "Main Set 4x\n- 4m 110%\n- 4m 50%")], FTP)).toEqual({
      violations: [],
      advisories: [],
    });
  });
});
