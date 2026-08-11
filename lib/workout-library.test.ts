import { describe, expect, it } from "vitest";
import type { DaySlot } from "./block-skeleton";
import type { WorkoutLibraryEntry } from "./types";
import { applyEvidence, canManuallyPromote, fingerprintWorkout, selectLibraryWorkout } from "./workout-library";

const FTP = 280;
const PROMOTED_AT = "2026-08-02T12:00:00.000Z";
const THRESHOLD = "Warmup\n- 10m 60%\n\nMain Set 2x\n- 20m 95%\n- 8m 50%\n\nCooldown\n- 10m 50%";

function entry(overrides: Partial<WorkoutLibraryEntry> = {}): WorkoutLibraryEntry {
  return {
    id: "base",
    workoutType: "Threshold",
    durationMin: 70,
    workoutText: THRESHOLD,
    status: "candidate",
    evidence: [],
    useCount: 0,
    recentUses: [],
    createdAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function slot(overrides: Partial<DaySlot> = {}): DaySlot {
  return {
    date: "2026-08-03",
    kind: "quality",
    allowedTypes: ["Threshold"],
    duration: { nominalMin: 70, minMin: 60, maxMin: 80 },
    maxIntensityPct: 115,
    locked: true,
    reason: "test",
    ...overrides,
  };
}

describe("fingerprintWorkout", () => {
  it("ignores labels and dates but retains structured workout identity", () => {
    const renamed = "2026-08-10 race prep\n- 10m 60%\n\nWhatever words 2x\n- 20m 95%\n- 8m 50%\n\nDone\n- 10m 50%";
    expect(fingerprintWorkout(THRESHOLD)).toBe(fingerprintWorkout(renamed));
  });

  it("changes when structured step order, repetitions, durations, or targets change", () => {
    const base = fingerprintWorkout(THRESHOLD);
    expect(fingerprintWorkout(THRESHOLD.replace("- 20m 95%\n- 8m 50%", "- 8m 50%\n- 20m 95%"))).not.toBe(base);
    expect(fingerprintWorkout(THRESHOLD.replace("Main Set 2x", "Main Set 3x"))).not.toBe(base);
    expect(fingerprintWorkout(THRESHOLD.replace("20m 95%", "18m 95%"))).not.toBe(base);
    expect(fingerprintWorkout(THRESHOLD.replace("20m 95%", "20m 92%"))).not.toBe(base);
  });

  it("normalizes a ramp target to its upper bound, matching prescription.ts's own convention", () => {
    expect(fingerprintWorkout("Main Set\n- 20m 50-70%")).toBe(fingerprintWorkout("Main Set\n- 20m 70%"));
  });
});

describe("applyEvidence", () => {
  it("de-duplicates evidence dates", () => {
    const once = applyEvidence(entry(), { date: "2026-08-01", executionScore: 6 }, false, PROMOTED_AT);
    const twice = applyEvidence(once, { date: "2026-08-01", executionScore: 9 }, false, PROMOTED_AT);
    expect(twice.evidence).toEqual([{ date: "2026-08-01", executionScore: 6 }]);
  });

  it("activates after one score of 8 or two distinct scores of 6", () => {
    expect(applyEvidence(entry(), { date: "2026-08-01", executionScore: 8 }, false, PROMOTED_AT).status).toBe("active");
    const oneSix = applyEvidence(entry(), { date: "2026-08-01", executionScore: 6 }, false, PROMOTED_AT);
    expect(oneSix.status).toBe("candidate");
    expect(applyEvidence(oneSix, { date: "2026-08-02", executionScore: 6 }, false, PROMOTED_AT).status).toBe("active");
  });

  it("does not count compromised rides and never restores retired entries", () => {
    const compromised = applyEvidence(entry(), { date: "2026-08-01", executionScore: 9 }, true, PROMOTED_AT);
    expect(compromised).toMatchObject({ status: "candidate", evidence: [] });
    const retired = applyEvidence(entry({ status: "retired" }), { date: "2026-08-01", executionScore: 9 }, false, PROMOTED_AT);
    expect(retired.status).toBe("retired");
  });
});

describe("canManuallyPromote", () => {
  it("requires a completed ride and a protocol-safe prescription", () => {
    expect(canManuallyPromote(entry(), false, FTP)).toBe(false);
    expect(canManuallyPromote(entry(), true, FTP)).toBe(true);
    expect(canManuallyPromote(entry({ workoutType: "SIT", workoutText: "Main Set 5x\n- 1m 150%\n- 4m 40%" }), true, FTP)).toBe(false);
  });
});

describe("selectLibraryWorkout", () => {
  it("filters exact type, slot envelope, and protocol-invalid entries", () => {
    const eligible = entry({ id: "eligible", status: "active" });
    const selected = selectLibraryWorkout([
      entry({ id: "wrong-type", status: "active", workoutType: "VO2max", workoutText: "Main Set 4x\n- 4m 110%\n- 4m 50%" }),
      entry({ id: "outside-duration", status: "active", durationMin: 81 }),
      entry({ id: "invalid", status: "active", workoutText: "Main Set 3x\n- 10m 120%\n- 5m 50%" }),
      eligible,
    ], slot(), FTP);
    expect(selected?.id).toBe("eligible");
  });

  it("also matches an event-kind slot (a calendar event forces kind: \"event\", not \"quality\")", () => {
    const eligible = entry({ id: "eligible", status: "active" });
    expect(selectLibraryWorkout([eligible], slot({ kind: "event" }), FTP)?.id).toBe("eligible");
  });

  it("does not match a non-quality, non-event slot kind", () => {
    const active = entry({ id: "active", status: "active" });
    expect(selectLibraryWorkout([active], slot({ kind: "easy" }), FTP)).toBeNull();
  });

  it("ranks eligible entries by evidence, duration distance, recent use, then ID", () => {
    const strong = entry({ id: "strong", status: "active", evidence: [{ date: "2026-08-01", executionScore: 9 }] });
    const close = entry({ id: "close", status: "active", durationMin: 70, evidence: [{ date: "2026-08-01", executionScore: 8 }] });
    const far = entry({ id: "far", status: "active", durationMin: 76, evidence: [{ date: "2026-08-01", executionScore: 8 }] });
    const fresh = entry({ id: "fresh", status: "active", durationMin: 70, evidence: [{ date: "2026-08-01", executionScore: 8 }], recentUses: [] });
    const used = entry({ id: "used", status: "active", durationMin: 70, evidence: [{ date: "2026-08-01", executionScore: 8 }], recentUses: ["2026-07-30"] });
    const alpha = entry({ id: "alpha", status: "active", durationMin: 70, evidence: [{ date: "2026-08-01", executionScore: 8 }] });
    const beta = entry({ id: "beta", status: "active", durationMin: 70, evidence: [{ date: "2026-08-01", executionScore: 8 }] });

    expect(selectLibraryWorkout([close, strong], slot(), FTP)?.id).toBe("strong");
    expect(selectLibraryWorkout([far, close], slot(), FTP)?.id).toBe("close");
    expect(selectLibraryWorkout([used, fresh], slot(), FTP)?.id).toBe("fresh");
    expect(selectLibraryWorkout([beta, alpha], slot(), FTP)?.id).toBe("alpha");
  });

  it("prefers more qualifying evidence at the same best score, before duration distance", () => {
    const onceAt8 = entry({ id: "once", durationMin: 70, status: "active", evidence: [{ date: "2026-08-01", executionScore: 8 }] });
    const twiceAt8 = entry({
      id: "twice",
      durationMin: 76,
      status: "active",
      evidence: [
        { date: "2026-08-01", executionScore: 8 },
        { date: "2026-08-05", executionScore: 8 },
      ],
    });
    expect(selectLibraryWorkout([onceAt8, twiceAt8], slot(), FTP)?.id).toBe("twice");
  });
});
