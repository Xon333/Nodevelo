import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FuelPrompt } from "./fuel-prompt";
import type { ActivitySummary, CurrentBlock, TodayAnalysis } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";

vi.mock("./anthropic-api", async (orig) => {
  const actual = await orig<typeof import("./anthropic-api")>();
  return { ...actual, isAnthropicConfigured: vi.fn(), analyseRide: vi.fn() };
});
vi.mock("./intervals-api", () => ({ createEvent: vi.fn() }));
vi.mock("./data-store", () => ({
  readAthleteProfile: vi.fn(), readBlockSettings: vi.fn(), readCurrentBlock: vi.fn(),
  readIntentOverlays: vi.fn(), readLastSync: vi.fn(), readTodayAnalysis: vi.fn(), writeTodayAnalysis: vi.fn(),
}));

import * as anthropic from "./anthropic-api";
import * as api from "./intervals-api";
import * as store from "./data-store";
import { addCoachNote, formatFuelPromptContext } from "./sync-analysis";

// formatFuelPromptContext is the pure formatting step between the deterministic FuelPrompt
// (lib/fuel-prompt.ts) and the coach-note prompt: numbers only, no new computation — the LLM
// phrases the one sentence, it never invents or recomputes these figures.

describe("formatFuelPromptContext", () => {
  it("formats a log-nudge with hours+minutes duration (matches the plan's example string)", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "long-ride", durationMin: 125 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 2h05 with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats a log-nudge under an hour as plain minutes (no spurious 0h prefix)", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "interval-day", durationMin: 45 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 45m with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats an exact-hour log-nudge with a zero-padded minutes segment", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "long-ride", durationMin: 120 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 2h00 with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats a gap prompt (matches the plan's example string)", () => {
    const prompt: FuelPrompt = { kind: "gap", loggedGPerH: 35, optimumGPerH: 69, deltaGPerH: -34 };
    expect(formatFuelPromptContext(prompt)).toBe("FUEL PROMPT: logged 35 g/h vs derived optimum 69 g/h");
  });
});

const TODAY = "2026-08-11";

const activity = (over: Partial<ActivitySummary> = {}): ActivitySummary =>
  ({
    id: "a1", date: TODAY, type: "Ride", name: "Morning Ride", movingTimeSec: 3600,
    avgWatts: 190, normalizedPower: 192, maxWatts: 400, icuFtp: null, avgHr: 155, maxHr: 172,
    kj: 700, activeBurnKcal: null, trainingLoad: 60, rpe: null, carbsIngestedG: null,
    decoupling: null, efficiencyFactor: null, powerHrZ2: null, powerHrZ2Mins: null,
    description: "solo ride", avgCadence: 88, distanceMeters: 30000, elevationGain: 300,
    powerZoneTimes: null, hrZoneTimes: null, hrrc: null, wPrimeRollingJ: null, wBalDepletionJ: null,
    ...over,
  }) as ActivitySummary;

const analysis = (over: Partial<TodayAnalysis> = {}) =>
  ({
    activityDate: TODAY, coachNote: null, executionScore: 2, activityName: "Morning Ride",
    powerZoneTimes: null, hrZoneTimes: null, intervalComparison: null, powerPRs: null,
    aerobicDiscipline: null, aerobicEffPct: null, fuelPrompt: null,
    ...over,
  }) as never as TodayAnalysis;

const profile = {
  performance: { ftp: 280, maxHr: 190, thresholdHr: 165, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [], weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: null, updatedAt: "",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(analysis());
  vi.mocked(store.readLastSync).mockResolvedValue({ activities: [activity()] } as never);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile);
  vi.mocked(store.readBlockSettings).mockResolvedValue({ ...DEFAULT_BLOCK_SETTINGS, autoPostCoachNote: true });
  vi.mocked(store.writeTodayAnalysis).mockResolvedValue(undefined as never);
  vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
  vi.mocked(anthropic.analyseRide).mockResolvedValue("Solid session, nice work.");
  vi.mocked(api.createEvent).mockResolvedValue(null as never);
});

describe("addCoachNote — score-line posting (external review, 2026-08-12)", () => {
  it("omits the score line when posting for an UNPLANNED ride — the debrief may show a different, overlay-resolved number", async () => {
    await addCoachNote(TODAY, []);
    const [call] = vi.mocked(api.createEvent).mock.calls;
    expect(call[0].description).not.toContain("Execution score:");
  });

  it("still posts the score line for a PRESCRIBED ride — decision #14: a note never displaces a formal session's score", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue({
      goal: "Build", lengthWeeks: 4, startDate: TODAY, endDate: TODAY, overview: "", createdAt: TODAY,
      days: [{ date: TODAY, name: "Endurance", type: "Z2", durationMin: 90 }],
    } as CurrentBlock);
    await addCoachNote(TODAY, []);
    const [call] = vi.mocked(api.createEvent).mock.calls;
    expect(call[0].description).toContain("Execution score: 2/10");
  });

  it("omits the score line when the block schedules Rest — a ride on that date is unplanned", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue({
      goal: "Build", lengthWeeks: 4, startDate: TODAY, endDate: TODAY, overview: "", createdAt: TODAY,
      days: [{ date: TODAY, name: "Rest", type: "Rest", durationMin: 0 }],
    } as CurrentBlock);
    await addCoachNote(TODAY, []);
    expect(anthropic.analyseRide).toHaveBeenCalledWith(expect.objectContaining({ plannedName: null }));
    const [call] = vi.mocked(api.createEvent).mock.calls;
    expect(call[0].description).not.toContain("Execution score:");
  });
});

// NV-1 (2026-08-15): the split-brain debrief. Coach prose used to read the raw note independently of
// the intent parser's own verdict on it, so a note the parser had just rejected could still drive a
// confident intent-execution judgment in the prose — right beside the debrief card's own "Not scored"
// message. SyncProvider now runs intent parsing to completion before this ever fires, so addCoachNote
// can read today's resolved overlay and withhold the note when the parse genuinely failed.
describe("addCoachNote — withholds the raw note from the prose prompt on a parse failure (NV-1)", () => {
  const overlay = (over: Partial<import("./types").IntentOverlay> = {}): import("./types").IntentOverlay => ({
    id: "ov1", activityId: "a1", date: TODAY, noteFingerprint: "fp1",
    status: "active", origin: "unspecified", effectiveExecutionScore: null,
    notScoredReason: "interpreter-failed", interpretation: null, scoringVersion: null,
    schemaVersion: 1, createdAt: TODAY, approvedAt: null, supersededBy: null,
    ...over,
  });

  it("passes activityDescription: null to analyseRide when today's activity's overlay is interpreter-failed", async () => {
    vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [overlay()], updatedAt: "" });
    await addCoachNote(TODAY, []);
    expect(anthropic.analyseRide).toHaveBeenCalledWith(expect.objectContaining({ activityDescription: null }));
  });

  it("still passes the raw note through when there is no overlay for today's activity", async () => {
    vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
    await addCoachNote(TODAY, []);
    expect(anthropic.analyseRide).toHaveBeenCalledWith(expect.objectContaining({ activityDescription: "solo ride" }));
  });

  it("still passes the raw note through when the overlay resolved successfully (not interpreter-failed)", async () => {
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [overlay({ notScoredReason: null, effectiveExecutionScore: 7, scoringVersion: 1, origin: "self-directed" })],
      updatedAt: "",
    });
    await addCoachNote(TODAY, []);
    expect(anthropic.analyseRide).toHaveBeenCalledWith(expect.objectContaining({ activityDescription: "solo ride" }));
  });

  it("ignores a superseded overlay (not the applicable one) and still withholds correctly for the CURRENT overlay", async () => {
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [
        overlay({ id: "stale", supersededBy: "ov1" }), // stale record, must be ignored
        overlay({ id: "ov1", notScoredReason: null, effectiveExecutionScore: 7, scoringVersion: 1, origin: "self-directed" }),
      ],
      updatedAt: "",
    });
    await addCoachNote(TODAY, []);
    expect(anthropic.analyseRide).toHaveBeenCalledWith(expect.objectContaining({ activityDescription: "solo ride" }));
  });
});
