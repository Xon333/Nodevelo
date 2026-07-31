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
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readLastSync: vi.fn(),
  updateAthleteProfile: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { PUT } from "@/app/api/profile/route";
import type { AthleteProfile } from "@/lib/types";

const base = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10, dateOfBirth: null, heightCm: null, sex: null },
  goals: [{ goal: "Finish a fondo", target: "150km", focus: "durability" }],
  weakpoints: [{ weakpoint: "Climbing", detail: "Loses power over 8%" }],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null },
  goalsMigratedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const updateMock = () => store.updateAthleteProfile as ReturnType<typeof vi.fn>;
// Seeds what updateAthleteProfile's mutate callback sees as the current on-disk profile — mirrors the
// real function applying `mutate` inside its lock against whatever's actually stored.
const seedCurrentProfile = (current: AthleteProfile) => {
  updateMock().mockImplementation(async (mutate: (p: AthleteProfile) => AthleteProfile) => mutate(current));
};
const put = (body: unknown) => PUT(new Request("http://x/api/profile", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/profile — nutrition", () => {
  it("rejects a non-positive baseCalories/restDayTarget/targetWeightKg without writing", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { baseCalories: 0, restDayTarget: 2600, buffer: 300, targetWeightKg: 68 } });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("rejects a buffer outside 0..600", async () => {
    seedCurrentProfile(base());
    const res = await put({ nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 601, targetWeightKg: 68 } });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("saves a valid nutrition update without touching goals/weakpoints", async () => {
    seedCurrentProfile(base());
    const json = await (await put({ nutrition: { baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67, targetRateKgPerWeek: null } })).json();
    expect(json.nutrition).toEqual({ baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67, targetRateKgPerWeek: null });
    expect(json.goals).toEqual(base().goals);
    expect(json.weakpoints).toEqual(base().weakpoints);
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
    expect(json.nutrition).toEqual({ baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68, targetRateKgPerWeek: null });
    expect(json.goals).toEqual(base().goals);
  });
});

describe("PUT /api/profile — HR-50 (mutates the raw stored profile, not a stale live-overlaid read)", () => {
  it("saves onto whatever updateAthleteProfile's lock actually hands it, not a value the route captured earlier", async () => {
    // Simulates the real guarantee: the profile inside the lock at mutate-time can differ from
    // anything the route itself might have read before calling updateAthleteProfile (it doesn't
    // read at all anymore) — e.g. a concurrent write already changed nutrition.
    const concurrentlyChanged = base({ nutrition: { baseCalories: 1800, restDayTarget: 2400, buffer: 250, targetWeightKg: 66, targetRateKgPerWeek: null } });
    seedCurrentProfile(concurrentlyChanged);
    const json = await (await put({ goals: [{ goal: "New goal", target: "", focus: "general" }] })).json();
    // The goals field this PUT touched is updated...
    expect(json.goals).toEqual([{ goal: "New goal", target: "", focus: "general" }]);
    // ...but nutrition reflects the concurrent value the lock actually saw, not a stale snapshot.
    expect(json.nutrition).toEqual({ baseCalories: 1800, restDayTarget: 2400, buffer: 250, targetWeightKg: 66, targetRateKgPerWeek: null });
  });
});

it("rejects an invalid JSON body", async () => {
  const res = await PUT(new Request("http://x/api/profile", { method: "PUT", body: "{not json" }));
  expect(res.status).toBe(400);
});
