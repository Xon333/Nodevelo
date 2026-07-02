import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for PUT /api/profile (destructive-route sweep, extends SUB-3). GET is a heavy read-only
// composition (physiology + power-profile + nutrition trend) with no data-integrity risk and is left to
// its own unit-tested modules — this focuses on the one write path onto athlete.json. The risk: PUT
// accepts nutrition/goals/weakpoints independently, so a partial update must not clobber the other two.
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readLastSync: vi.fn(),
  writeAthleteProfile: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { PUT } from "@/app/api/profile/route";
import type { AthleteProfile } from "@/lib/types";

const base = (over: Partial<AthleteProfile> = {}): AthleteProfile => ({
  performance: { ftp: 250, maxHr: 180, thresholdHr: 165, weightKg: 70, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [{ goal: "Finish a fondo", target: "150km", focus: "durability" }],
  weakpoints: [{ weakpoint: "Climbing", detail: "Loses power over 8%" }],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 68 },
  goalsMigratedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const readMock = () => store.readAthleteProfile as ReturnType<typeof vi.fn>;
const writeMock = () => store.writeAthleteProfile as ReturnType<typeof vi.fn>;
const lastWritten = (): AthleteProfile => writeMock().mock.calls.at(-1)![0] as AthleteProfile;
const put = (body: unknown) => PUT(new Request("http://x/api/profile", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/profile — nutrition", () => {
  it("rejects a non-positive baseCalories/restDayTarget/targetWeightKg without writing", async () => {
    readMock().mockResolvedValue(base());
    const res = await put({ nutrition: { baseCalories: 0, restDayTarget: 2600, buffer: 300, targetWeightKg: 68 } });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("rejects a buffer outside 0..600", async () => {
    readMock().mockResolvedValue(base());
    const res = await put({ nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 601, targetWeightKg: 68 } });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("saves a valid nutrition update without touching goals/weakpoints", async () => {
    readMock().mockResolvedValue(base());
    await put({ nutrition: { baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67 } });
    const out = lastWritten();
    expect(out.nutrition).toEqual({ baseCalories: 2200, restDayTarget: 2700, buffer: 350, targetWeightKg: 67 });
    expect(out.goals).toEqual(base().goals);
    expect(out.weakpoints).toEqual(base().weakpoints);
  });
});

describe("PUT /api/profile — goals", () => {
  it("rejects a goal with no text", async () => {
    readMock().mockResolvedValue(base());
    const res = await put({ goals: [{ goal: "", target: "", focus: "general" }] });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("falls back an unrecognised focus to general instead of rejecting", async () => {
    readMock().mockResolvedValue(base());
    await put({ goals: [{ goal: "Race a crit", target: "top 10", focus: "made-up-focus" }] });
    expect(lastWritten().goals).toEqual([{ goal: "Race a crit", target: "top 10", focus: "general" }]);
  });

  it("rejects goals that isn't an array", async () => {
    readMock().mockResolvedValue(base());
    const res = await put({ goals: "not an array" });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });
});

describe("PUT /api/profile — weakpoints", () => {
  it("rejects a weakpoint with no text", async () => {
    readMock().mockResolvedValue(base());
    const res = await put({ weakpoints: [{ weakpoint: "", detail: "x" }] });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("saves valid weakpoints without touching nutrition/goals", async () => {
    readMock().mockResolvedValue(base());
    await put({ weakpoints: [{ weakpoint: "Sprinting", detail: "Fades late" }] });
    const out = lastWritten();
    expect(out.weakpoints).toEqual([{ weakpoint: "Sprinting", detail: "Fades late" }]);
    expect(out.nutrition).toEqual(base().nutrition);
    expect(out.goals).toEqual(base().goals);
  });
});

it("rejects an invalid JSON body", async () => {
  const res = await PUT(new Request("http://x/api/profile", { method: "PUT", body: "{not json" }));
  expect(res.status).toBe(400);
});
