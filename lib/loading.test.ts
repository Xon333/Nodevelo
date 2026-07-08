import { describe, expect, it } from "vitest";
import { assessLoadingEffect, deriveLoadingPrompt, preLoadTargetG } from "./loading";
import type { CurrentBlock, RideScoreEntry } from "./types";

function block(days: Array<{ date: string; type?: string; durationMin?: number; durabilityTemplate?: string }>): CurrentBlock {
  return {
    goal: "g", lengthWeeks: 4, startDate: days[0]?.date ?? "2026-07-01", endDate: days[days.length - 1]?.date ?? "2026-07-28",
    overview: "", createdAt: "2026-07-01T00:00:00Z",
    days: days.map((d) => ({ date: d.date, name: "Ride", type: (d.type ?? "Z2") as CurrentBlock["days"][number]["type"], durationMin: d.durationMin ?? 180, ...(d.durabilityTemplate ? { durabilityTemplate: d.durabilityTemplate } : {}) })),
  };
}

function entry(over: Partial<RideScoreEntry>): RideScoreEntry {
  return {
    date: "2026-07-01", executionScore: 7, plannedType: "Z2", inferredType: "Z2", planned: true, legacy: false,
    compliancePct: 100, intensityFactor: 0.65, ftpUsed: 300, durationMin: 180, tss: 120, ...over,
  };
}

describe("preLoadTargetG", () => {
  it("is 7 g/kg rounded to 10 g", () => {
    expect(preLoadTargetG(70)).toBe(490);
    expect(preLoadTargetG(72)).toBe(500); // 504 → 500
  });
});

describe("deriveLoadingPrompt", () => {
  const b = block([
    { date: "2026-07-09", type: "Threshold", durationMin: 75 },
    { date: "2026-07-10", durabilityTemplate: "C" },
  ]);

  it("pre-asks the day before a durability day", () => {
    expect(deriveLoadingPrompt(b, "2026-07-09", 70, new Set())).toEqual({
      kind: "pre-ask", rideDate: "2026-07-10", template: "C", targetG: 490,
    });
  });

  it("retro-asks on the durability day itself when unanswered", () => {
    expect(deriveLoadingPrompt(b, "2026-07-10", 70, new Set())).toEqual({
      kind: "retro-ask", rideDate: "2026-07-10", template: "C", targetG: 490,
    });
  });

  it("retro-ask wins when today AND tomorrow are both durability days", () => {
    const b2 = block([{ date: "2026-07-10", durabilityTemplate: "B" }, { date: "2026-07-11", durabilityTemplate: "C" }]);
    expect(deriveLoadingPrompt(b2, "2026-07-10", 70, new Set())?.rideDate).toBe("2026-07-10");
  });

  it("stays silent once the ride date has a response, on a plain day, and with no block", () => {
    expect(deriveLoadingPrompt(b, "2026-07-09", 70, new Set(["2026-07-10"]))).toBeNull();
    expect(deriveLoadingPrompt(b, "2026-07-07", 70, new Set())).toBeNull();
    expect(deriveLoadingPrompt(null, "2026-07-09", 70, new Set())).toBeNull();
  });

  it("ignores a zero-duration durability entry", () => {
    const b3 = block([{ date: "2026-07-10", durabilityTemplate: "C", durationMin: 0 }]);
    expect(deriveLoadingPrompt(b3, "2026-07-09", 70, new Set())).toBeNull();
  });
});

describe("assessLoadingEffect", () => {
  const durEntry = (loaded: boolean, delivered: boolean, i: number, template = "C"): RideScoreEntry =>
    entry({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      durabilityTemplate: template,
      preLoad: { loaded, targetG: 490 },
      durabilityDelivery: { signal: delivered ? 2 : -2 },
    } as Partial<RideScoreEntry>);

  it("is unproven below 3 observations per side", () => {
    const entries = [durEntry(true, true, 0), durEntry(true, true, 1), durEntry(false, false, 2)];
    expect(assessLoadingEffect(entries).verdict).toBe("unproven");
  });

  it("reports helps when loaded delivery rate clears the margin", () => {
    const entries = [
      ...[0, 1, 2].map((i) => durEntry(true, true, i)),
      ...[3, 4, 5].map((i) => durEntry(false, false, i)),
    ];
    const r = assessLoadingEffect(entries);
    expect(r.verdict).toBe("helps");
    expect(r.loadedRate).toBe(1);
    expect(r.unloadedRate).toBe(0);
  });

  it("reports no-effect at n≥5/side with no separation", () => {
    const entries = [
      ...[0, 1, 2, 3, 4].map((i) => durEntry(true, i < 3, i)), // 3/5 delivered
      ...[5, 6, 7, 8, 9].map((i) => durEntry(false, i < 8, i)), // 3/5 delivered
    ];
    expect(assessLoadingEffect(entries).verdict).toBe("no-effect");
  });

  it("excludes template A, compromised, legacy, and unstamped entries", () => {
    const noise = [
      durEntry(true, true, 10, "A"),
      { ...durEntry(true, true, 11), compromised: true },
      { ...durEntry(true, true, 12), legacy: true },
      entry({ date: "2026-06-20", durabilityTemplate: "C" }), // no stamps
    ];
    const r = assessLoadingEffect(noise);
    expect(r.nLoaded).toBe(0);
    expect(r.nUnloaded).toBe(0);
    expect(r.verdict).toBe("unproven");
  });
});
