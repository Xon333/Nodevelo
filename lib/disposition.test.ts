import { describe, expect, it } from "vitest";
import { applyDispositions, compromisedDates, mergeDisposition } from "./disposition";
import { buildAthleteModel } from "./athlete-model";
import type { DispositionEntry, RideScoreEntry } from "./types";

const disp = (date: string, disposition: DispositionEntry["disposition"], reason: DispositionEntry["reason"] = null): DispositionEntry => ({
  date,
  disposition,
  reason,
  setAt: "2026-06-16T00:00:00.000Z",
});

const entry = (date: string, executionScore: number): RideScoreEntry => ({
  date,
  executionScore,
  plannedType: "VO2max",
  inferredType: "VO2max",
  planned: true,
  legacy: false,
  compliancePct: 100,
  intensityFactor: 1.0,
  ftpUsed: 274,
  durationMin: 60,
  tss: 80,
});

describe("mergeDisposition", () => {
  it("keeps one per date and lets a re-submission overwrite", () => {
    const merged = mergeDisposition([disp("2026-06-15", "completed")], disp("2026-06-15", "compromised", "equipment"));
    expect(merged).toHaveLength(1);
    expect(merged[0].disposition).toBe("compromised");
    expect(merged[0].reason).toBe("equipment");
  });
});

describe("applyDispositions / compromisedDates", () => {
  it("stamps the compromised flag onto matching ledger entries only", () => {
    const stamped = applyDispositions([entry("2026-06-14", 8), entry("2026-06-15", 1)], [disp("2026-06-15", "compromised", "equipment")]);
    expect(stamped.find((e) => e.date === "2026-06-14")?.compromised).toBe(false);
    expect(stamped.find((e) => e.date === "2026-06-15")?.compromised).toBe(true);
    expect(compromisedDates([disp("2026-06-15", "compromised"), disp("2026-06-14", "completed")])).toEqual(new Set(["2026-06-15"]));
  });
});

describe("athlete model excludes compromised rides from execution", () => {
  it("a compromised 1/10 ride does not drag the VO2max execution EWMA", () => {
    const clean = buildAthleteModel([entry("2026-06-10", 8), entry("2026-06-12", 8), entry("2026-06-14", 8)]);
    const withFluke = buildAthleteModel(
      applyDispositions(
        [entry("2026-06-10", 8), entry("2026-06-12", 8), entry("2026-06-14", 8), entry("2026-06-15", 1)],
        [disp("2026-06-15", "compromised", "equipment")]
      )
    );
    const cleanVo2 = clean.byType.find((t) => t.type === "VO2max")!;
    const flukeVo2 = withFluke.byType.find((t) => t.type === "VO2max")!;
    // the compromised ride is excluded → same n, same EWMA as without it
    expect(flukeVo2.n).toBe(cleanVo2.n);
    expect(flukeVo2.execEwma).toBe(cleanVo2.execEwma);
  });
});
