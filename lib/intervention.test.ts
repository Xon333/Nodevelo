import { describe, expect, it } from "vitest";
import { buildInterventions, physMarkerFor, summariseValidation, validateInterventions } from "./intervention";
import type { AthleteModel, Insight, InterventionLog, InterventionRecord, SyncData } from "./types";

const model = (vo2Exec: number, overall = 6): AthleteModel => ({
  byType: [{ type: "VO2max", n: 5, execEwma: vo2Exec, complianceEwma: 90, trend: "flat" }],
  overallExecEwma: overall,
  overallTrend: "flat",
  sampleSize: 5,
  behaviour: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, unplannedAvgQuality: null, weeklyHours: 8 },
  behaviourAllTime: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, unplannedAvgQuality: null, weeklyHours: 8 },
});

const sync = (watts5min: number): SyncData => ({
  syncedAt: "2026-01-01T00:00:00.000Z",
  activities: [],
  wellness: [],
  powerCurve: [{ durationSec: 300, watts: watts5min }],
  fitness: { ctl: null, atl: null, tsb: null },
});

const insight = (dimension: string, severity: Insight["severity"] = "alert"): Insight => ({
  dimension,
  severity,
  title: `${dimension} nudge`,
  evidence: "",
  suggestion: "",
});

describe("buildInterventions", () => {
  it("records validatable insights with baseline snapshots and skips behaviour nudges", () => {
    const recs = buildInterventions([insight("VO2max"), insight("Structure", "watch")], model(4.5), sync(330), "2026-02-01", "2026-01-15");
    expect(recs).toHaveLength(1); // Structure (behaviour) is not validatable
    expect(recs[0].dimension).toBe("VO2max");
    expect(recs[0].baselineExecEwma).toBe(4.5);
    expect(recs[0].baselinePhys).toBe(330);
    expect(recs[0].physMetric).toBe("5-min power");
    expect(recs[0].outcome).toBeNull();
  });
});

describe("physMarkerFor", () => {
  // PW-2: SIT is a 30s all-out protocol, so its progress marker must be 30-second power,
  // not 1-min — otherwise validation tracks a different effort length than the session trains.
  const curve: SyncData = {
    syncedAt: "2026-01-01T00:00:00.000Z",
    activities: [],
    wellness: [],
    powerCurve: [
      { durationSec: 30, watts: 540 },
      { durationSec: 60, watts: 450 },
      { durationSec: 300, watts: 330 },
      { durationSec: 1200, watts: 290 },
    ],
    fitness: { ctl: null, atl: null, tsb: null },
  };

  it("tracks SIT via 30-second power (not 1-min)", () => {
    expect(physMarkerFor("SIT", curve)).toEqual({ value: 540, metric: "30-sec power" });
  });
  it("tracks VO2max via 5-min and Threshold via 20-min power", () => {
    expect(physMarkerFor("VO2max", curve)).toEqual({ value: 330, metric: "5-min power" });
    expect(physMarkerFor("Threshold", curve)).toEqual({ value: 290, metric: "20-min power" });
  });
});

describe("validateInterventions", () => {
  const recordedLog = (firedAt: string): InterventionLog => ({
    records: buildInterventions([insight("VO2max")], model(4.5), sync(330), "2026-02-01", firedAt),
    updatedAt: "",
  });

  it("leaves immature interventions unevaluated", () => {
    const { changed } = validateInterventions(recordedLog("2026-01-15"), model(7), sync(340), "2026-01-20");
    expect(changed).toBe(false);
  });

  it("validates when execution + power improved past the horizon", () => {
    const { log, changed } = validateInterventions(recordedLog("2026-01-01"), model(7), sync(345), "2026-02-01");
    expect(changed).toBe(true);
    expect(log.records[0].outcome?.verdict).toBe("validated");
  });

  it("refutes when both markers declined", () => {
    const { log } = validateInterventions(recordedLog("2026-01-01"), model(3), sync(300), "2026-02-01");
    expect(log.records[0].outcome?.verdict).toBe("refuted");
  });

  it("is inconclusive when neither marker is available", () => {
    const log: InterventionLog = {
      records: buildInterventions([insight("VO2max")], model(4.5), null, "2026-02-01", "2026-01-01"),
      updatedAt: "",
    };
    // baselinePhys is null (no sync at build); validate with no sync → both deltas null.
    const { log: out } = validateInterventions(log, { ...model(4.5), byType: [] }, null, "2026-02-01");
    expect(out.records[0].outcome?.verdict).toBe("inconclusive");
  });
});

describe("summariseValidation", () => {
  const rec = (dimension: string, verdict: "validated" | "refuted" | "inconclusive"): InterventionRecord => ({
    id: `${dimension}-${verdict}`,
    firedAt: "2026-01-01",
    blockStartDate: "2026-01-01",
    dimension,
    severity: "alert",
    title: "",
    horizonDays: 28,
    baselineExecEwma: 5,
    baselinePhys: 300,
    physMetric: "5-min power",
    outcome: { evaluatedAt: "2026-02-01", execNow: null, physNow: null, execDelta: null, physDelta: null, verdict },
  });

  it("computes hit rate by dimension and counts pending", () => {
    const log: InterventionLog = {
      records: [
        rec("VO2max", "validated"),
        rec("VO2max", "refuted"),
        rec("Threshold", "validated"),
        { ...rec("Z2", "validated"), id: "pending", outcome: null },
      ],
      updatedAt: "",
    };
    const s = summariseValidation(log);
    expect(s.evaluated).toBe(3);
    expect(s.pending).toBe(1);
    expect(s.byDimension.find((d) => d.dimension === "VO2max")?.hitRate).toBe(0.5);
    expect(s.byDimension.find((d) => d.dimension === "Threshold")?.hitRate).toBe(1);
  });
});
