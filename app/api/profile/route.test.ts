import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for PUT /api/profile (destructive-route sweep, extends SUB-3). GET is a heavy read-only
// composition (physiology + power-profile + nutrition trend) with no data-integrity risk and is left to
// its own unit-tested modules — this focuses on the one write path onto athlete.json. The risk: PUT
// accepts nutrition/goals/weakpoints independently, so a partial update must not clobber the other two.
//
// HR-50: the route now mutates the RAW stored profile via updateAthleteProfile's locked
// read-modify-write, not a readAthleteProfile()-then-writeAthleteProfile() pair (which persisted the
// live-overlaid FTP/HR data back into athlete.json and raced a concurrent PUT). These tests mock
// updateAthleteProfile to apply its captured mutate callback against a fixed on-disk profile — the same
// shape a real locked read would hand it — and assert on the route's own JSON response, which is built
// directly from updateAthleteProfile's return value.
//
// Review fix #3: "revert to derived" (`{ nutrition: { neatMultiplier: null } }`) now does one plain,
// unlocked readAthleteProfile()/readLastSync() pair BEFORE the lock, to re-derive via calibrateNeat —
// mirroring /api/sync's own best-effort recalibration block. Every test that exercises the reset path
// must mock those two return values (seedReadsForRevert below); tests that never send `neatMultiplier:
// null` don't need to, since that read is gated on the reset branch specifically.
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readLastSync: vi.fn(),
  updateAthleteProfile: vi.fn(),
}));
vi.mock("@/lib/kb-loader", () => ({ parseAthleteMd: vi.fn(async () => ({ performanceData: {}, trainingZones: [] })) }));
vi.mock("@/lib/physiology", () => ({
  readPhysiology: vi.fn(async () => null),
  resolveHrZones: vi.fn(() => []),
  resolvePowerZones: vi.fn(() => []),
}));

import * as store from "@/lib/data-store";
import { GET, PUT } from "@/app/api/profile/route";
import { DEFAULT_NEAT_MULTIPLIER, NEAT_PLAUSIBLE_MAX, NEAT_PLAUSIBLE_MIN } from "@/lib/nutrition";
import type { AthleteProfile, ActivitySummary, WellnessEntry } from "@/lib/types";

// The route never touches `neat` (it's calibrateNeat's output, adopted on sync — Phase 2), so every
// fixture/expectation below carries this same value through untouched.
const defaultNeat = {
  multiplier: 1.2, confidence: "low" as const, source: "default" as const,
  windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
};

const base = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10, dateOfBirth: null, heightCm: null, sex: null },
  goals: [{ goal: "Finish a fondo", target: "150km", focus: "durability" }],
  weakpoints: [{ weakpoint: "Climbing", detail: "Loses power over 8%" }],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null },
  goalsMigratedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const updateMock = () => store.updateAthleteProfile as ReturnType<typeof vi.fn>;
// Seeds the plain (unlocked) reads the revert path does BEFORE the lock — readAthleteProfile (for the
// RMR inputs + fallback weight) and readLastSync (for calibrateNeat's wellness/activities). Only
// consulted on the `neatMultiplier: null` reset branch.
const seedReadsForRevert = (profile: AthleteProfile, sync: { wellness: WellnessEntry[]; activities: ActivitySummary[] } | null) => {
  (store.readAthleteProfile as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
  (store.readLastSync as ReturnType<typeof vi.fn>).mockResolvedValue(sync);
};
// A flat-weight synthetic athlete whose logged intake is exactly consistent with multiplier `k` at the
// given `rmr` — same construction as lib/nutrition.test.ts's calibrateNeat fixtures, so calibrateNeat
// clears HIGH confidence and derives `k` back out almost exactly.
const synthSync = (k: number, days: number, rmr: number, burnPerDay: number, endDate: string) => {
  const wellness: WellnessEntry[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.parse(`${endDate}T00:00:00.000Z`) - i * 86_400_000).toISOString().slice(0, 10);
    wellness.push({
      date, weightKg: 70, hrv: null, sleepHours: null, sleepQuality: null,
      kcalConsumed: k * rmr + burnPerDay, ctl: null, atl: null,
    });
  }
  const activities: ActivitySummary[] = wellness.map((w) => ({
    id: w.date, date: w.date, type: "Ride", name: "Ride", movingTimeSec: 3600,
    avgWatts: null, normalizedPower: null, maxWatts: null, icuFtp: null, avgHr: null, maxHr: null,
    kj: null, activeBurnKcal: burnPerDay, trainingLoad: null, rpe: null, carbsIngestedG: null,
    decoupling: null, efficiencyFactor: null,
  })) as unknown as ActivitySummary[];
  return { wellness, activities };
};
// Seeds what updateAthleteProfile's mutate callback sees as the current on-disk profile — mirrors the
// real function applying `mutate` inside its lock against whatever's actually stored.
const seedCurrentProfile = (current: AthleteProfile) => {
  updateMock().mockImplementation(async (mutate: (p: AthleteProfile) => AthleteProfile) => mutate(current));
};
const put = (body: unknown) => PUT(new Request("http://x/api/profile", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/profile — RMR floor transparency", () => {
  it("returns the authoritative floored target instead of duplicated UI arithmetic", async () => {
    const derived = {
      ...defaultNeat, multiplier: 1.2, source: "derived" as const, confidence: "high" as const,
      windowDays: 42, loggedDays: 40, weighIns: 20,
    };
    (store.readAthleteProfile as ReturnType<typeof vi.fn>).mockResolvedValue(base({
      performance: {
        ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: "1992-01-01", heightCm: 175, sex: "male",
      },
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 60,
        targetRateKgPerWeek: 0.5, neat: derived, dayTypeNeat: null,
      },
    }));
    (store.readLastSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const json = await (await GET()).json();

    expect(json.derivation.todayPlan.floored).toBe(true);
    expect(json.derivation.todayPlan.dailyTarget).toBe(json.derivation.rmr);
    expect(json.derivation.todayPlan.maintenanceKcal + json.derivation.todayPlan.bufferApplied)
      .toBeLessThan(json.derivation.rmr);
  });

  it("includes today's resolved activity burn in today's target", async () => {
    const derived = {
      ...defaultNeat, multiplier: 1.2, source: "derived" as const, confidence: "high" as const,
      windowDays: 42, loggedDays: 40, weighIns: 20,
    };
    (store.readAthleteProfile as ReturnType<typeof vi.fn>).mockResolvedValue(base({
      performance: {
        ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: "1992-01-01", heightCm: 175, sex: "male",
      },
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 70,
        targetRateKgPerWeek: 0, neat: derived, dayTypeNeat: null,
      },
    }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    try {
      (store.readLastSync as ReturnType<typeof vi.fn>).mockResolvedValue({
        syncedAt: "", wellness: [], powerCurve: [], powerCurveAllTime: [], fitness: null,
        activities: [{ date: "2026-08-02", activeBurnKcal: 500, kj: null }],
      });

      const json = await (await GET()).json();

      expect(json.derivation.todayPlan.dailyTarget).toBe(2450);
    } finally {
      vi.useRealTimers();
    }
  });

  it("withholds today's target when an activity burn is unresolved", async () => {
    (store.readAthleteProfile as ReturnType<typeof vi.fn>).mockResolvedValue(base());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    try {
      (store.readLastSync as ReturnType<typeof vi.fn>).mockResolvedValue({
        syncedAt: "", wellness: [], powerCurve: [], powerCurveAllTime: [], fitness: null,
        activities: [{ date: "2026-08-02", activeBurnKcal: null, kj: null }],
      });

      const json = await (await GET()).json();

      expect(json.derivation.todayPlan).toBeNull();
      expect(json.derivation.todayActiveBurnKcal).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PUT /api/profile — nutrition", () => {
  it("rejects a non-positive baseCalories/restDayTarget/targetWeightKg without writing", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { baseCalories: 0, restDayTarget: 2600, buffer: 300, targetWeightKg: 68 } });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  // buffer-redesign-feedforward Task 2: `buffer` is retired as an athlete-editable field — the route
  // accepts it in the payload without erroring (older cached clients still send it) but no longer
  // validates or persists it, so an out-of-range value can no longer 400 or reach disk.
  it("accepts an out-of-range buffer in the payload without erroring, and leaves the on-disk value untouched", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 601, targetWeightKg: 68 } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nutrition.buffer).toBe(300); // base()'s on-disk value, not the rejected/ignored 601
  });

  it("saves a valid nutrition update without touching goals/weakpoints", async () => {
    seedCurrentProfile(base());
    // `buffer: 350` is sent (an older client still submitting the retired field) but must be ignored —
    // the persisted value stays whatever was already on disk (300, from base()).
    const json = await (await put({ nutrition: { baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67, targetRateKgPerWeek: null } })).json();
    expect(json.nutrition).toEqual({ baseCalories: 2200, restDayTarget: 2700, buffer: 300, targetWeightKg: 67, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null });
    expect(json.goals).toEqual(base().goals);
    expect(json.weakpoints).toEqual(base().weakpoints);
  });
});

describe("PUT /api/profile — neatMultiplier override (Step 5)", () => {
  it("accepts neatMultiplier alone, without the base four nutrition fields", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { neatMultiplier: 1.3 } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nutrition.neat.multiplier).toBe(1.3);
    expect(json.nutrition.neat.source).toBe("override");
    expect(typeof json.nutrition.neat.solvedAt).toBe("string");
    // The base four fields (untouched by this PUT) survive from the on-disk profile.
    expect(json.nutrition.baseCalories).toBe(2000);
    expect(json.nutrition.restDayTarget).toBe(2600);
    expect(json.nutrition.buffer).toBe(300);
    expect(json.nutrition.targetWeightKg).toBe(68);
  });

  it("accepts neatMultiplier alongside the base four fields in one PUT", async () => {
    seedCurrentProfile(base());
    const json = await (
      await put({ nutrition: { baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67, targetRateKgPerWeek: null, neatMultiplier: 1.35 } })
    ).json();
    expect(json.nutrition.baseCalories).toBe(2200);
    expect(json.nutrition.neat.multiplier).toBe(1.35);
    expect(json.nutrition.neat.source).toBe("override");
  });

  it("null resets to the population default when the profile can't be re-derived (legacy, no RMR inputs)", async () => {
    // base()'s performance has dateOfBirth/heightCm/sex all null — resolveNutritionModel resolves
    // "legacy" for it, so there's nothing for calibrateNeat to solve against and the revert correctly
    // falls back to the population default rather than fabricating a solve.
    const overridden = base({
      nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null, neat: { ...defaultNeat, multiplier: 1.4, source: "override", solvedAt: "2026-06-01T00:00:00.000Z" }, dayTypeNeat: null },
    });
    seedCurrentProfile(overridden);
    seedReadsForRevert(overridden, null);
    const json = await (await put({ nutrition: { neatMultiplier: null } })).json();
    expect(json.nutrition.neat.multiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
    expect(json.nutrition.neat.source).toBe("default");
    // Review fix #4: a "default" record must not carry another solve's fields.
    expect(json.nutrition.neat.confidence).toBe("low");
    expect(json.nutrition.neat.windowDays).toBeNull();
    expect(json.nutrition.neat.loggedDays).toBeNull();
    expect(json.nutrition.neat.weighIns).toBeNull();
    expect(json.nutrition.neat.imbalance).toBeNull();
  });

  it("null re-derives a live solve instead of falling back to the population default (review fix #3)", async () => {
    // Unlike the legacy case above, this profile HAS RMR inputs, so resolveNutritionModel resolves
    // "derived" and the revert has something to calibrate against. Real RMR for 70kg/175cm/34yo male:
    // 10*70 + 6.25*175 - 5*34 + 5 = 1631.25 → rounds to 1631.
    const withRmrInputs = base({
      performance: { ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10, dateOfBirth: "1992-01-01", heightCm: 175, sex: "male" },
      nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null, neat: { ...defaultNeat, multiplier: 1.4, source: "override", solvedAt: "2026-06-01T00:00:00.000Z" }, dayTypeNeat: null },
    });
    seedCurrentProfile(withRmrInputs);
    // The route's revert path calls the real localToday() (no client-supplied override on this route,
    // unlike /api/sync) — fake the clock so the fixture's window lines up with "today" deterministically.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    try {
      const { wellness, activities } = synthSync(1.28, 42, 1631, 1000, "2026-07-30");
      seedReadsForRevert(withRmrInputs, { wellness, activities });
      const json = await (await put({ nutrition: { neatMultiplier: null } })).json();
      // Landed on a genuine derived solve close to the synthetic k, not the 1.2 population default —
      // the pre-fix behaviour ("Revert to derived" actually reverting to the default) is what this closes.
      expect(json.nutrition.neat.source).toBe("derived");
      expect(json.nutrition.neat.multiplier).toBeGreaterThan(1.27);
      expect(json.nutrition.neat.multiplier).toBeLessThan(1.29);
      expect(json.nutrition.neat.confidence).toBe("high");
      expect(json.nutrition.neat.windowDays).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fresh override record never carries a previous solve's fields (review fix #4)", async () => {
    // The on-disk record before this PUT is a HIGH-confidence derived solve with a real imbalance
    // finding attached — none of that describes the athlete's own typed-in number.
    const derivedWithImbalance = base({
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null,
        neat: {
          multiplier: 1.55, confidence: "high", source: "derived", windowDays: 42, loggedDays: 39, weighIns: 23,
          solvedAt: "2026-06-01T00:00:00.000Z",
          imbalance: { direction: "intake-above-model", estimatedKcalPerDay: 180, candidates: ["a", "b"], note: "n" },
          stale: false,
        },
        dayTypeNeat: null,
      },
    });
    seedCurrentProfile(derivedWithImbalance);
    const json = await (await put({ nutrition: { neatMultiplier: 1.4 } })).json();
    expect(json.nutrition.neat.multiplier).toBe(1.4);
    expect(json.nutrition.neat.source).toBe("override");
    expect(json.nutrition.neat.confidence).toBe("low");
    expect(json.nutrition.neat.windowDays).toBeNull();
    expect(json.nutrition.neat.loggedDays).toBeNull();
    expect(json.nutrition.neat.weighIns).toBeNull();
    expect(json.nutrition.neat.imbalance).toBeNull();
  });

  it("rejects an out-of-range neatMultiplier, naming the bounds, without writing", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { neatMultiplier: NEAT_PLAUSIBLE_MAX + 0.1 } });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain(String(NEAT_PLAUSIBLE_MIN));
    expect(error).toContain(String(NEAT_PLAUSIBLE_MAX));
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric neatMultiplier without writing", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { neatMultiplier: "1.3" } });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("leaves neat untouched when neatMultiplier is absent (existing base-four-only PUT)", async () => {
    seedCurrentProfile(base());
    const json = await (await put({ nutrition: { baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67, targetRateKgPerWeek: null } })).json();
    expect(json.nutrition.neat).toEqual(defaultNeat);
  });
});

describe("PUT /api/profile — goals", () => {
  it("rejects a goal with no text", async () => {
    seedCurrentProfile(base());
    const res = await put({ goals: [{ goal: "", target: "", focus: "general" }] });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("falls back an unrecognised focus to general instead of rejecting", async () => {
    seedCurrentProfile(base());
    const json = await (await put({ goals: [{ goal: "Race a crit", target: "top 10", focus: "made-up-focus" }] })).json();
    expect(json.goals).toEqual([{ goal: "Race a crit", target: "top 10", focus: "general" }]);
  });

  it("rejects goals that isn't an array", async () => {
    seedCurrentProfile(base());
    const res = await put({ goals: "not an array" });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });
});

describe("PUT /api/profile — weakpoints", () => {
  it("rejects a weakpoint with no text", async () => {
    seedCurrentProfile(base());
    const res = await put({ weakpoints: [{ weakpoint: "", detail: "x" }] });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("saves valid weakpoints without touching nutrition/goals", async () => {
    seedCurrentProfile(base());
    const json = await (await put({ weakpoints: [{ weakpoint: "Sprinting", detail: "Fades late" }] })).json();
    expect(json.weakpoints).toEqual([{ weakpoint: "Sprinting", detail: "Fades late" }]);
    expect(json.nutrition).toEqual({ baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null });
    expect(json.goals).toEqual(base().goals);
  });
});

describe("PUT /api/profile — HR-50 (mutates the raw stored profile, not a stale live-overlaid read)", () => {
  it("saves onto whatever updateAthleteProfile's lock actually hands it, not a value the route captured earlier", async () => {
    // Simulates the real guarantee: the profile inside the lock at mutate-time can differ from
    // anything the route itself might have read before calling updateAthleteProfile (it doesn't
    // read at all anymore) — e.g. a concurrent write already changed nutrition.
    const concurrentlyChanged = base({ nutrition: { baseCalories: 1800, restDayTarget: 2400, buffer: 250, targetWeightKg: 66, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null } });
    seedCurrentProfile(concurrentlyChanged);
    const json = await (await put({ goals: [{ goal: "New goal", target: "", focus: "general" }] })).json();
    // The goals field this PUT touched is updated...
    expect(json.goals).toEqual([{ goal: "New goal", target: "", focus: "general" }]);
    // ...but nutrition reflects the concurrent value the lock actually saw, not a stale snapshot.
    expect(json.nutrition).toEqual({ baseCalories: 1800, restDayTarget: 2400, buffer: 250, targetWeightKg: 66, targetRateKgPerWeek: null, neat: defaultNeat, dayTypeNeat: null });
  });
});

it("rejects an invalid JSON body", async () => {
  const res = await PUT(new Request("http://x/api/profile", { method: "PUT", body: "{not json" }));
  expect(res.status).toBe(400);
});
