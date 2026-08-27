import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";

// Integration test for /api/generate (CR-8): proves the Track B wiring is actually hooked up — a
// terrain/race goal's RaceSim requirement is enforced into the plan's warnings, and the chosen
// durability template is stamped on the plan. The LLM + data/KB/physiology IO are mocked; the
// requirement derivation, durability selection, validators and stamping run for real.

const h = vi.hoisted(() => ({
  // A schema-valid tool payload with NO RaceSim — so validateSessionRequirements must warn.
  toolInput: {
    overview: "Test build block.",
    weeks: [
      {
        weekNumber: 1,
        theme: "Build",
        days: [
          { date: "2026-06-15", name: "Threshold 3x12", type: "Threshold", durationMin: 36, workout: "Main Set 3x\n- 12m 95%", description: "x" },
          { date: "2026-06-16", name: "Endurance", type: "Z2", durationMin: 90, workout: "- 90m 65%", description: "x" },
        ],
      },
    ],
  },
}));

vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return {
    ...actual,
    isAnthropicConfigured: vi.fn(() => true),
    generateTrainingBlock: vi.fn(async () => ({ toolInput: h.toolInput, raw: "", truncated: false, stopReason: null })),
  };
});
vi.mock("@/lib/generate-cache", () => ({
  generationKey: () => "k",
  dedupeGeneration: vi.fn(async (_k: string, fn: () => Promise<unknown>) => ({ result: await fn() })),
}));
// The publication gate itself runs FOR REAL in these tests (findings must be genuinely populated);
// only the "clean plan" case below overrides evaluatePublicationGate per-case to prove how an
// empty verdict maps onto the response shape.
vi.mock("@/lib/publication-gate", async (orig) => {
  const actual = await orig<typeof import("@/lib/publication-gate")>();
  return {
    ...actual,
    evaluatePublicationGate: vi.fn(actual.evaluatePublicationGate),
  };
});
vi.mock("@/lib/kb-loader", async (orig) => {
  const actual = await orig<typeof import("@/lib/kb-loader")>();
  return {
    ...actual,
    loadKnowledgeBaseContext: vi.fn(async () => "KB"),
    latestRetrospectiveSeeds: vi.fn(async () => []),
  };
});
vi.mock("@/lib/physiology", () => ({
  readPhysiologyWithStatus: vi.fn(async () => ({
    store: {
      current: {
        effectiveFrom: "2026-06-01",
        capturedAt: "2026-06-01T00:00:00.000Z",
        source: "intervals",
        ftp: 280,
        lthr: 165,
        maxHr: 185,
        powerZonePct: [55, 75, 90, 105, 120, 150],
        hrZones: [130, 150, 165, 180],
        hrZonesAreBpm: true,
        powerZoneNames: [],
        hrZoneNames: [],
      },
      history: [],
    },
    corruptFallback: false,
    fileExisted: true,
    liveCorrupt: false,
  })),
  resolvePowerZones: vi.fn(() => []),
  resolveHrZones: vi.fn(() => []),
}));
vi.mock("@/lib/physiology-freshness", async (orig) => {
  const actual = await orig<typeof import("@/lib/physiology-freshness")>();
  return {
    ...actual,
    readPhysiologyStatus: vi.fn(async () => ({
      status: {
        lastAttemptAt: "2026-06-15T00:00:00.000Z",
        lastOutcome: "confirmed",
        lastConfirmedAt: "2026-06-15T00:00:00.000Z",
      },
      corruptFallback: false,
      liveCorrupt: false,
    })),
    assessPhysiologyFreshnessFromReads: vi.fn(() => ({
      state: "fresh",
      confirmedAt: "2026-06-15T00:00:00.000Z",
      effectiveFrom: "2026-06-01",
    })),
  };
});
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readBlockHistory: vi.fn(),
  readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(),
  readInterventionLog: vi.fn(),
  readLastSync: vi.fn(),
  readQuirks: vi.fn(),
  readRollingBaselines: vi.fn(),
  readScoreLog: vi.fn(),
  readIntentOverlays: vi.fn(),
  readSeasonPlan: vi.fn(),
  saveGenerationVerdict: vi.fn(),
  updateSeasonPlan: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as anthropic from "@/lib/anthropic-api";
import * as genCache from "@/lib/generate-cache";
import * as kb from "@/lib/kb-loader";
import * as physiology from "@/lib/physiology";
import * as gate from "@/lib/publication-gate";
import * as fresh from "@/lib/physiology-freshness";
import { GENERATION_MODEL, PROMPT_VERSION } from "@/lib/anthropic-api";
import { POST } from "@/app/api/generate/route";

const profile = {
  performance: { ftp: 280, weightKg: 72, maxHr: 185, thresholdHr: 165, weeklyHoursMin: 8, weeklyHoursMax: 12 },
  nutrition: { baseCalories: 2200, restDayTarget: 2000, buffer: 300, targetWeightKg: 70 },
  goals: [],
  weakpoints: [],
};
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -10 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(sync as never);
  vi.mocked(store.readQuirks).mockResolvedValue({ entries: [], extractedAt: "", engine: "" });
  vi.mocked(store.readRollingBaselines).mockResolvedValue({} as never);
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
  vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "" });
  vi.mocked(store.updateSeasonPlan).mockImplementation(async (mutate) =>
    mutate({ objective: "", events: [], periods: [], updatedAt: "" })
  );
  vi.mocked(store.saveGenerationVerdict).mockResolvedValue(undefined);
  vi.mocked(kb.latestRetrospectiveSeeds).mockResolvedValue([]);
});

const gen = (goal: string) =>
  POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 2, goal, startDate: "2026-06-15", weakpoints: [] }) }));

describe("POST /api/generate — Track B wiring", () => {
  it("enforces the RaceSim requirement for a terrain/race goal and stamps the durability template", async () => {
    const json = await (await gen("Win the hilly KOM road race")).json();
    // Scoped to the GOAL: prefix (validateSessionRequirements' own finding) rather than a bare
    // /RaceSim/ substring. Since the publication gate landed, this lands in findings.preferences,
    // not warnings — the route test proves the gate's preference bucket reaches the plan.
    expect(json.plan.findings.preferences.some((w: string) => /^GOAL:.*RaceSim/.test(w))).toBe(true);
    expect(json.plan.warnings.some((w: string) => /^GOAL:/.test(w))).toBe(false); // never double-bucketed
    expect(json.plan.durabilityTemplate).toBe("A"); // selected (no insights, no prior block) + stamped
  });

  it("does not require a RaceSim for a flat, non-terrain goal", async () => {
    const json = await (await gen("Improve 40k TT power on the flats")).json();
    expect(json.plan.findings.preferences.some((w: string) => /^GOAL:.*RaceSim/.test(w))).toBe(false);
  });

  it("HR-18: a weakpoint recorded only in profile.weakpoints still biases durability template selection", async () => {
    // Before the fix, selectDurabilityTemplate's goalText only joined existingSeason.objective +
    // blockParams.goal -- a stated weakpoint living in the athlete's PROFILE (not retyped into the
    // block-goal textbox or the request's own weakpoints array) had zero influence. "5-second power"
    // matches GOAL_TEMPLATE_PATTERNS' sprint/neuromuscular pattern -> template D.
    vi.mocked(store.readAthleteProfile).mockResolvedValue({ ...profile, weakpoints: [{ weakpoint: "5-second power", detail: "" }] } as never);
    const json = await (await gen("Have fun and stay consistent")).json(); // goal text alone matches nothing
    expect(json.plan.durabilityTemplate).toBe("D");
  });

  it("A2: a block containing a recovery week carves the durability template out of it", async () => {
    // Asserts on the durability line's own EXCEPTION marker specifically. A looser /recovery week/i
    // match would pass on formatRecoveryWeeks' output alone (Task 7) and prove nothing about Task 8.
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    await res.json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("DURABILITY FOCUS THIS BLOCK");
    expect(dynamic).toMatch(/EXCEPTION — in a RECOVERY week this template does not apply/);
  });

  it("A2 inverse: a block with no recovery week omits the EXCEPTION marker", async () => {
    // The route's `recoveryWeekIndices.length > 0` call site is otherwise unpinned in this direction —
    // mutation testing confirmed that hardcoding it to `true` passed the whole suite silently (the A2
    // test above only proves the marker CAN appear, not that it's conditional). `gen` builds a 2-week
    // block; with the mocked empty score log/baselines, realWeeksSinceLastRecovery -> 0 and
    // planRecoveryWeeks(0, 2, ...) -> [] (deload cadence is every 3-4 weeks), so this block has no
    // recovery week and the EXCEPTION clause must be absent.
    const json = await (await gen("Build FTP")).json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(json.plan.durabilityTemplate).toBeTruthy();
    expect(dynamic).toContain("DURABILITY FOCUS THIS BLOCK");
    expect(dynamic).not.toMatch(/EXCEPTION — in a RECOVERY week this template does not apply/);
  });
});

describe("POST /api/generate — season wiring (multi-period blocks)", () => {
  // Base 2026-06-08 → 06-22 (straddles today → preserved verbatim by settleSeasonHistory), then an
  // athlete-owned build override 06-22 → 07-13 (preserved verbatim too). A 2-week block starting
  // 06-15 crosses the base→build boundary on 06-22.
  const seasonPlan = {
    objective: "",
    events: [],
    periods: [
      { focus: "aerobic-base", phase: "base", startDate: "2026-06-08", plannedWeeks: 2, intensitySplit: "90/10", targetWeeklyTss: null, deloadWeek: false, rationale: "Base.", source: "derived", confidence: "medium" },
      { focus: "threshold", phase: "build", startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "Build.", source: "override", confidence: "medium" },
    ],
    updatedAt: "",
  };
  const genWithSeason = () =>
    POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }) }));

  it("does NOT inject the fixed-phase event-arc context (still gated), but DOES inject the rolling BLOCK FOCUS line (P1, 2026-07-24)", async () => {
    // This fixture has no A-event, so it was always routing through the rolling branch — the
    // event-arc assertions below were never testing anything the flag-flip touches (formatSeasonContext
    // only ever fires for aEventForBlock); only the BLOCK FOCUS assertion actually flips here.
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).not.toContain("spans 2 season periods");
    expect(dynamic).not.toContain("focus aerobic-base");
    expect(dynamic).not.toContain("focus threshold");
    expect(dynamic).toContain("BLOCK FOCUS:"); // rolling selector — not the doubted model, always live now
    // Season state must still be tracked underneath even though the event-arc text isn't shown.
    expect(store.updateSeasonPlan).toHaveBeenCalled();
  });

  it("still does NOT push event-anchored Season-fit/focus-match warnings (still gated); rolling block-focus warnings now run", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    const json = await (await genWithSeason()).json();
    // The fixture's mocked days (a Threshold day + a Z2 day) satisfy whichever focus the real,
    // unmocked chooseNextFocus scorer picks for this goal ("Build FTP", no history) — so no
    // "Season fit" warning is expected here either, but for a different reason than before P1:
    // validateBlockFocus now runs for real and simply finds a matching session, not because the
    // whole season-validator family is dark.
    expect(json.plan.findings.preferences.some((w: string) => /^Season fit/.test(w))).toBe(false);
  });

  it("still surfaces a B/C-priority event inside the block range even with phase context disabled (Task 5 stays decoupled)", async () => {
    const withEvent = { ...seasonPlan, events: [{ name: "Areh FTP Test", date: "2026-06-16", priority: "B" }] };
    vi.mocked(store.readSeasonPlan).mockResolvedValue(withEvent as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("Areh FTP Test");
    expect(dynamic).not.toContain("spans 2 season periods"); // phase text still absent
  });

  it("EC-9: an A-priority event does NOT silently disable rolling focus selection", async () => {
    // Before this fix, chooseNextFocus lived only in the else-branch of `if (aEventForBlock)`.
    // With SEASON_SHAPES_GENERATION off, an A-event meant NEITHER the event arc (flag-gated) NOR
    // the rolling focus ran — the prompt lost its BLOCK FOCUS line, two validators went dark, and
    // seasonFocus was never stamped (breaking the next block's variety rule too).
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [{ name: "Nationals", date: "2026-09-05", priority: "A", type: "road-race" }],
      periods: [],
      updatedAt: "",
    } as never);
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("BLOCK FOCUS:");
    expect(json.plan.seasonFocus).toBeTruthy();
  });
});

describe("POST /api/generate — request validation", () => {
  it("400 when Anthropic is not configured, without calling the model", async () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValueOnce(false);
    const res = await gen("Build FTP");
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/connect the ai coach/i);
    expect(error).not.toMatch(/ANTHROPIC_API_KEY|\.env/i); // athlete-facing copy must never name env vars
    expect(anthropic.generateTrainingBlock).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body", async () => {
    const res = await POST(new Request("http://t/api/generate", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body.");
  });

  it("400 on invalid block params, naming the offending field", async () => {
    const post = (body: unknown) =>
      POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify(body) }));
    expect((await (await post({ lengthWeeks: 3, goal: "x", startDate: "2026-06-15" })).json()).error).toMatch(/lengthWeeks/);
    expect((await (await post({ lengthWeeks: 2, goal: "  ", startDate: "2026-06-15" })).json()).error).toMatch(/goal/);
    expect((await (await post({ lengthWeeks: 2, goal: "x", startDate: "15-06-2026" })).json()).error).toMatch(/startDate/);
  });

  // P2a (2026-07-24 block-generation redesign): refuse an impossible settings combination before
  // spending an LLM call on it.
  it("400 when BlockSettings are jointly infeasible, without calling the model", async () => {
    vi.mocked(store.readBlockSettings).mockResolvedValue({
      ...DEFAULT_BLOCK_SETTINGS,
      qualitySessionsPerLoadingWeek: 5,
      restDaysPerWeek: 2,
    });
    const res = await gen("Build FTP");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Settings conflict/);
    expect(anthropic.generateTrainingBlock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { state: "missing" }],
    ["malformed", { state: "malformed", reason: "does not parse" }],
    ["inconsistent", { state: "inconsistent", reason: "FTP -1 is not positive" }],
    ["obsolete", { state: "obsolete", markedObsoleteAt: "2026-08-20T00:00:00.000Z" }],
  ])("400 on %s physiology before any LLM spend", async (_name, freshnessState) => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce(freshnessState as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/physiology/i);
    expect(genCache.dedupeGeneration).not.toHaveBeenCalled();
    expect(anthropic.generateTrainingBlock).not.toHaveBeenCalled();
  });

  it("generates through a temporary physiology sync failure with a visible warning", async () => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce({
      state: "sync-failed",
      lastAttemptAt: "2026-06-15T00:00:00.000Z",
      lastDetail: "timeout",
      lastConfirmedAt: "2026-06-13T00:00:00.000Z",
      lastConfirmedDate: "2026-06-13",
    } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plan.warnings[0]).toContain("last confirmed 2026-06-13");
    expect(genCache.dedupeGeneration).toHaveBeenCalledTimes(1);
    expect(anthropic.generateTrainingBlock).toHaveBeenCalledTimes(1);
  });

  it("generates from a valid backup with a visible recovery warning", async () => {
    const baseline = await physiology.readPhysiologyWithStatus();
    vi.mocked(physiology.readPhysiologyWithStatus).mockResolvedValueOnce({
      ...baseline,
      liveCorrupt: true,
    });

    const res = await gen("Build FTP");

    expect(res.status).toBe(200);
    expect((await res.json()).plan.warnings).toContainEqual(expect.stringMatching(/backup/i));
    expect(anthropic.generateTrainingBlock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/generate — generation outcomes", () => {
  it("502 when the model returns no structured payload", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: null, raw: "prose", truncated: false, stopReason: null } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/did not return a structured plan/);
  });

  it("reports a precise retryable error when a 6-week response hits the token limit", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: null, raw: "", truncated: true, stopReason: "max_tokens" } as never);
    const res = await POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 6, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [] }) }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The generated 6-week plan exceeded the response limit. Please retry; the app will request a larger response.");
  });

  it("502 when the payload fails schema validation", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: { bogus: true }, raw: "", truncated: false, stopReason: null } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/failed structured validation/);
  });

  it("maps a thrown generation failure to 502 with its message", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockRejectedValueOnce(new Error("Anthropic 500"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Anthropic 500");
  });

  it("routes truncation + the day-count shortfall into findings.blockers, never warnings", async () => {
    // The publication gate owns both messages now (STRUCTURE blockers); the old inline
    // warnings.unshift/push versions are gone, and `warnings` stays informational-only.
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: h.toolInput, raw: "", truncated: true, stopReason: "max_tokens" } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.findings.blockers.some((w: string) => /token limit/.test(w))).toBe(true);
    expect(json.plan.findings.blockers).toContain("STRUCTURE: Expected 14 days but the plan carries 2.");
    expect(json.plan.warnings.some((w: string) => /token limit|Expected 14 days/.test(w))).toBe(false);
  });

  it("stamps provenance + the audit trail on the plan", async () => {
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.model).toBe(GENERATION_MODEL);
    expect(json.plan.promptVersion).toBe(PROMPT_VERSION);
    expect(json.plan.raw).toBe(JSON.stringify(h.toolInput, null, 2));
    expect(json.plan.blockParams).toMatchObject({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15" });
  });

  it("a season-replan persistence failure never blocks generation (best-effort)", async () => {
    vi.mocked(store.updateSeasonPlan).mockRejectedValueOnce(new Error("disk full"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBeDefined();
  });

  it("HR-58: never persists the season plan when generation itself fails", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockRejectedValueOnce(new Error("Anthropic 500"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect(store.updateSeasonPlan).not.toHaveBeenCalled();
  });

  it("HR-58: CAS-guards the deferred persist against a concurrent Season-form save", async () => {
    // existingSeason (the early read) carries updatedAt "v1" — simulate a concurrent PUT /api/season
    // landing mid-generation by having the live store return "v2" when updateSeasonPlan's own mutate
    // runs. The route's expectedUpdatedAt guard should refuse to apply the stale mutation.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "v1" });
    let sawExpected: string | undefined;
    vi.mocked(store.updateSeasonPlan).mockImplementation(async (mutate, expected) => {
      sawExpected = expected;
      const live = { objective: "athlete edit", events: [], periods: [], updatedAt: "v2" };
      return expected !== undefined && live.updatedAt !== expected ? live : mutate(live);
    });
    const res = await gen("Build FTP");
    expect(res.status).toBe(200);
    expect(sawExpected).toBe("v1");
  });
});

// P2b (2026-07-24 block-generation redesign): the missing check — nothing validated actual weekly
// hours against anything before this. The shared 2-week fixture's mocked output (126min in week 1,
// nothing in week 2) undershoots any real loading target dramatically.
// P3a (2026-07-24 block-generation redesign): a mismatched kcal figure is auto-corrected in the
// returned plan, not just flagged.
// The shared `h.toolInput` fixture is deliberately incomplete (2 of 14 expected days) for the other
// describe blocks' purposes, so these tests supply their own full 2-week (14-day) fixture.
describe("POST /api/generate — deterministic overview checks", () => {
  const fullToolInput = (overview = "Test build block.") => {
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 15 + i));
      return d.toISOString().slice(0, 10);
    });
    const days = (weekNumber: number, weekDates: string[]) =>
      weekDates.map((date) => ({ date, name: "Easy Z2", type: "Z2" as const, durationMin: 90, workout: "- 90m 65%", description: "x" }));
    return {
      overview,
      weeks: [
        { weekNumber: 1, theme: "Build", days: days(1, dates.slice(0, 7)) },
        { weekNumber: 2, theme: "Build", days: days(2, dates.slice(7, 14)) },
      ],
    };
  };

  it("appends overview contradictions to warnings without rewriting the overview", async () => {
    const overview = "Week 1 is a 16-hour building week.";
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: fullToolInput(overview), raw: "", truncated: false, stopReason: null } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.overview).toBe(overview);
    expect(json.plan.warnings).toContain("Overview says 16h for week 1, but the scheduled total is 10.5h.");
  });

  it("skips overview checks for an incomplete block", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({
      toolInput: { ...h.toolInput, overview: "Week 1 is a 16-hour building week." },
      raw: "",
      truncated: false,
      stopReason: null,
    } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.warnings.some((w: string) => /^Overview says/.test(w))).toBe(false);
  });

  it("skips overview checks for a truncated response with a complete day count", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: fullToolInput("Week 1 is a 16-hour building week."), raw: "", truncated: true, stopReason: "max_tokens" } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.warnings.some((w: string) => /^Overview says/.test(w))).toBe(false);
  });
});

describe("POST /api/generate — nutrition auto-repair (P3a)", () => {
  it("overwrites an invented daily-intake figure in the returned day and notes the correction", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({
      toolInput: {
        overview: "Test build block.",
        weeks: [
          {
            weekNumber: 1,
            theme: "Build",
            days: [
              { date: "2026-06-15", name: "Easy Z2", type: "Z2", durationMin: 90, workout: "- 90m 65%", description: "Intent: aerobic. Daily intake: 9999 kcal." },
            ],
          },
        ],
      },
      raw: "",
      truncated: false,
      stopReason: null,
    } as never);
    const json = await (await gen("Build FTP")).json();
    const day = json.plan.days.find((d: { date: string }) => d.date === "2026-06-15");
    expect(day.description).not.toContain("9999");
    expect(day.description).toMatch(/Daily intake: \d+ kcal\./);
    expect(json.plan.warnings.some((w: string) => /auto-corrected daily intake 9999 kcal/.test(w))).toBe(true);
  });
});

describe("POST /api/generate — week-hours skeleton wiring (P2b)", () => {
  it("flags a week whose actual hours miss its computed target (as a gate BLOCKER now)", async () => {
    const json = await (await gen("Build FTP")).json();
    const hourBlockers = json.plan.findings.blockers.filter((w: string) => /^HOURS:/.test(w));
    expect(hourBlockers.length).toBeGreaterThan(0);
    expect(hourBlockers.some((w: string) => /week 1 \(loading\) totals 2\.1h — under its 12h target/.test(w))).toBe(true);
  });
});

// P2c (2026-07-24 block-generation redesign): the chosen focus injected as a mandatory coverage
// requirement, not just descriptive context, for a rolling-mode block (no upcoming A-event).
describe("POST /api/generate — focus-coverage requirement wiring (P2c)", () => {
  it("injects a REQUIRED COVERAGE line naming the chosen focus's session type", async () => {
    await gen("Build FTP");
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("REQUIRED COVERAGE: this block's focus is threshold");
    expect(dynamic).toContain("include at least 1 Threshold session in EVERY loading week");
  });
});

describe("POST /api/generate — approved retrospective seed injection", () => {
  it("injects PREVIOUS BLOCK PRIORITIES only for approved seeds", async () => {
    const retro = [
      "---",
      'id: "2026-06-15_build-ftp"',
      "seeds_approved: false",
      "next_block_seeds:",
      '  - "Carry threshold progression forward"',
      "---",
      "## Retrospective",
    ].join("\n");

    vi.mocked(kb.latestRetrospectiveSeeds).mockResolvedValueOnce(kb.parseRetroSeeds(retro));
    await gen("Build FTP");
    const withoutApproval = vi.mocked(anthropic.generateTrainingBlock).mock.calls.at(-1)?.[1] ?? "";
    expect(withoutApproval).not.toContain("PREVIOUS BLOCK PRIORITIES");
    expect(withoutApproval).not.toContain("Carry threshold progression forward");

    vi.mocked(kb.latestRetrospectiveSeeds).mockResolvedValueOnce(
      kb.parseRetroSeeds(kb.approveSeedsInMarkdown(retro))
    );
    await gen("Build FTP");
    const withApproval = vi.mocked(anthropic.generateTrainingBlock).mock.calls.at(-1)?.[1] ?? "";
    expect(withApproval).toContain("PREVIOUS BLOCK PRIORITIES");
    expect(withApproval).toContain("- Carry threshold progression forward");
  });
});

// P5a (2026-07-24 block-generation redesign): the shared 2-week fixture's mocked output only covers
// week 1 (a Threshold day) — week 2 has zero generated days, so it's missing the chosen focus
// ("threshold") entirely. Confirms the stricter per-loading-week check actually reaches the route.
describe("POST /api/generate — primary-quality cadence wiring (P5a)", () => {
  it("flags the week missing the primary quality's matching session (as a gate PREFERENCE now)", async () => {
    const json = await (await gen("Build FTP")).json();
    const primaryPreferences = json.plan.findings.preferences.filter((w: string) => /^PRIMARY QUALITY:/.test(w));
    expect(primaryPreferences.some((w: string) => /week 2 \(loading\)/.test(w) && /no Threshold session/.test(w))).toBe(true);
  });
});

// P5b (2026-07-24 block-generation redesign): the sequencing rule reaches the user message, and a
// backwards-ordered week (Threshold before SIT) gets flagged post-generation.
describe("POST /api/generate — within-week sequencing wiring (P5b)", () => {
  it("injects the freshness-priority sequencing rule into the user message", async () => {
    await gen("Build FTP");
    const userMessage = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][2];
    expect(userMessage).toMatch(/Within-week sequencing/);
    expect(userMessage).toContain("place the freshness-dependent one EARLIER in the week");
  });

  it("flags a backwards-ordered week (Threshold before SIT)", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({
      toolInput: {
        overview: "Test build block.",
        weeks: [
          {
            weekNumber: 1,
            theme: "Build",
            days: [
              { date: "2026-06-15", name: "Threshold", type: "Threshold", durationMin: 60, workout: "- 60m 95%", description: "x" },
              { date: "2026-06-17", name: "SIT", type: "SIT", durationMin: 30, workout: "- 30s 160%", description: "x" },
            ],
          },
        ],
      },
      raw: "",
      truncated: false,
      stopReason: null,
    } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.findings.blockers.some((w: string) => /^SEQUENCING: week 1/.test(w))).toBe(true);
  });
});

// CFS-7: chooseNextFocus now runs (and stamps the plan) regardless of SEASON_SHAPES_GENERATION — only
// the prompt/validator opinion is flag-gated, not the tracking. gatherFocusInputs is left UNMOCKED here:
// its own dependencies (readAthleteProfile/readLastSync/readCurrentBlock/readBlockHistory/readScoreLog/
// readSeasonPlan) are already fully covered by this file's @/lib/data-store mock, so running it for real
// is more faithful than hand-rolling a second ChooseNextFocusInput fixture that could drift from it.
// EC-9: it also runs regardless of an upcoming A-priority event — see the second case below, which
// used to assert the opposite (that was the bug this task fixed).
describe("POST /api/generate — seasonFocus stamping (chooseNextFocus wiring)", () => {
  it("stamps plan.seasonFocus/seasonFocusRationale for a rolling-mode block (no upcoming A-event)", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "" } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.seasonFocus).toBeDefined();
    expect(typeof json.plan.seasonFocusRationale).toBe("string");
    expect(json.plan.seasonFocusRationale.length).toBeGreaterThan(0);
  });

  it("EC-9: also stamps plan.seasonFocus/seasonFocusRationale for an event-anchored block (upcoming A-event)", async () => {
    // Before EC-9, chooseNextFocus lived only in the else-branch of `if (aEventForBlock)`, so an
    // upcoming A-priority event silently suppressed seasonFocus stamping too (this test used to
    // assert `toBeUndefined()` here — that was the bug, not a documented design choice). Hoisting
    // the call outside the season try/catch (route.ts) makes it run unconditionally.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [{ name: "A Race", date: "2026-10-01", priority: "A" }],
      periods: [],
      updatedAt: "",
    } as never);
    // Pin today explicitly (matches the "season wiring" describe block's convention above) — this
    // test's A-event lookup (findUpcomingAEvent) depends on today being before 2026-10-01. Without
    // this, `gen`'s request body omits `today` and resolveToday falls back to the real system clock,
    // so the test would silently start failing once the real calendar date passes 2026-10-01.
    const json = await (
      await POST(
        new Request("http://t/api/generate", {
          method: "POST",
          body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
        })
      )
    ).json();
    expect(json.plan.seasonFocus).toBeDefined();
    expect(typeof json.plan.seasonFocusRationale).toBe("string");
    expect(json.plan.seasonFocusRationale.length).toBeGreaterThan(0);
  });
});

describe("POST /api/generate — protocol-violation severity (measurability)", () => {
  it("surfaces quality-session protocol breaches as findings.blockers, not generic warnings", async () => {
    const badSit = {
      overview: "o",
      weeks: [{
        weekNumber: 1,
        theme: "t",
        days: [{ date: "2026-06-15", name: "SIT 5x1min", type: "SIT", durationMin: 25, workout: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "x" }],
      }],
    };
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: badSit, raw: "", truncated: false, stopReason: null } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.protocolViolations).toBeUndefined(); // no longer emitted (Task 5 removes the field)
    // The fixture is structurally incomplete too (1 of 14 days → its own blockers); what matters
    // is that the protocol breach itself landed in blockers and nowhere else.
    expect(json.plan.findings.blockers.some((w: string) => /longer than protocol/.test(w))).toBe(true);
    expect(json.plan.warnings.some((w: string) => /longer than protocol/.test(w))).toBe(false); // not double-reported
  });

  it("omits findings entirely when nothing blocks and nothing prefers (sparse-field convention)", async () => {
    // The default mocked toolInput carries no protocol violations, but it IS structurally
    // incomplete (2 of 14 days), so a bare run still has blockers. Override the gate to its clean
    // verdict to pin the sparse-field mapping: no blockers + no preferences ⇒ no `findings` key.
    vi.mocked(gate.evaluatePublicationGate).mockReturnValueOnce({ blockers: [], preferences: [], advisories: [] });
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.findings).toBeUndefined();
  });

  it("HR-19: reconciles a mismatched durationMin to the real prescribed total instead of just flagging it", async () => {
    const mismatched = {
      overview: "o",
      weeks: [{
        weekNumber: 1,
        theme: "t",
        days: [{ date: "2026-06-15", name: "Z2 ride", type: "Z2", durationMin: 90, workout: "Warmup\n- 10m ramp 50-65%\n\nMain\n- 40m 65%\n\nCooldown\n- 10m 50%", description: "x" }],
      }],
    };
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: mismatched, raw: "", truncated: false, stopReason: null } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.days[0].durationMin).toBe(60); // 10+40+10, not the stated 90
    // Reconciled means real === stated by construction, so the duration-consistency check (which
    // now sees the corrected number) has nothing left to flag.
    expect(json.plan.protocolViolations).toBeUndefined();
    expect(json.plan.warnings.some((w: string) => /prescribed steps/.test(w))).toBe(false);
  });
});

describe("POST /api/generate — season layer degradation (EC-3)", () => {
  it("still plans recovery weeks and surfaces a warning when the season replan throws", async () => {
    // A malformed period date makes addWeeks' Date.parse return NaN, and new Date(NaN).toISOString()
    // throws RangeError inside settleSeasonHistory. Before this fix, recoveryWeekIndices silently
    // stayed [] -> zero recovery weeks in the block, no RECOVERY instruction in the prompt, and
    // validateWeekHours measuring every week against the loading target. Only a server log said so.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [],
      periods: [
        { focus: "threshold", phase: "build", startDate: "not-a-date", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "x", source: "derived", confidence: "medium" },
      ],
      updatedAt: "",
    } as never);
    // weeksSinceRecovery: readRollingBaselines is mocked to {} (see beforeEach above), so
    // baselines.avgTss90d is undefined, avgWeeklyTss is null, and realWeeksSinceLastRecovery returns 0
    // via its own first early-return (avgWeeklyTss === null) — it never reaches the lookback loop.
    // Either way, a 4-week block is guaranteed at least one recovery week (planRecoveryWeeks(n>=0, 4)
    // always fires within 4 weeks), so the outcome asserted below doesn't depend on which path fired.
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const [, dynamic, userMessage] = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0];
    expect(userMessage).toContain("RECOVERY"); // the hour-target table still labels the week
    expect(dynamic).toContain("RECOVERY:"); // and the recovery instruction still reaches the model
    // Fix 3 (2026-07-29 whole-branch review): formatFocusContext/formatFocusCoverageLine used to sit
    // INSIDE the season try — a throw here (this test's malformed period date) skipped them entirely,
    // so the model was told to keep a short recovery-week session of the block's focus type without
    // ever being told what that focus IS, and validateBlockFocus/validatePrimaryQualityCadence never
    // ran (both gated on replannedSeason, which stays null on this path). Hoisted out: this must
    // survive the throw.
    expect(dynamic).toContain("BLOCK FOCUS:");
    expect(json.plan.warnings.some((w: string) => /season/i.test(w))).toBe(true); // athlete-visible
  });

  it("still runs validateBlockFocus/validatePrimaryQualityCadence on the throw path (gate is rollingFocusChoice, not replannedSeason)", async () => {
    // Same malformed-date throw as above, but the generated plan carries ZERO Threshold sessions —
    // this test's default chosen focus (given the cold, empty mocked history) is "threshold" (see the
    // BLOCK FOCUS test above, which shows the SHORT session named is Threshold). Before this fix, both
    // focus validators sat behind the outer `if (replannedSeason)`, which is null on this throw path —
    // so a plan violating the block's own focus requirement passed silently. A plan with no Threshold
    // session at all must now surface a "Season fit" warning even though the season replan threw.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [],
      periods: [
        { focus: "threshold", phase: "build", startDate: "not-a-date", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "x", source: "derived", confidence: "medium" },
      ],
      updatedAt: "",
    } as never);
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({
      toolInput: {
        overview: "Test build block, no Threshold.",
        weeks: [
          {
            weekNumber: 1,
            theme: "Build",
            days: [{ date: "2026-06-15", name: "Endurance", type: "Z2", durationMin: 90, workout: "- 90m 65%", description: "x" }],
          },
        ],
      },
      raw: "",
      truncated: false,
      stopReason: null,
    } as never);
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    expect(json.plan.findings.preferences.some((w: string) => /Season fit:.*focus is threshold.*zero Threshold/.test(w))).toBe(true);
  });
});

// Phase B task 4 (2026-07-29): the deterministic per-day skeleton (lib/block-skeleton.ts) is now
// computed in the route and drives the prompt directly, replacing the single weekly hour figure the
// model previously had to split itself. Conformance runs alongside the existing validators.
describe("POST /api/generate — Phase B: skeleton wiring", () => {
  it("Phase B: the skeleton table reaches the model and conformance runs", async () => {
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const userMessage = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][2];
    expect(userMessage).toContain("WEEK SKELETON (FIXED");
    // The mocked tool payload only returns 2 days for a 14-day block, so conformance must notice.
    expect(json.plan.findings.blockers.some((w: string) => /^SKELETON:/.test(w))).toBe(true);
  });
});

// Publication-gate trust-contract plan, Task 3: ONE evaluatePublicationGate call feeds
// plan.findings; warnings become informational-only; the verdict is persisted server-side
// best-effort. The gate itself runs UNMOCKED here (see the vi.mock above) so these prove real
// classification reaches the response — except where a test pins the empty-verdict mapping.
describe("POST /api/generate — publication-gate wiring", () => {
  it("populates findings from a single gate run on a warning-bearing fixture (blockers AND preferences)", async () => {
    const json = await (await gen("Build FTP")).json();
    // Blockers: structural (2 of 14 days), HOURS undershoot, SKELETON missing days…
    expect(json.plan.findings.blockers).toContain("STRUCTURE: Expected 14 days but the plan carries 2.");
    expect(json.plan.findings.blockers.some((w: string) => /^HOURS:/.test(w))).toBe(true);
    expect(json.plan.findings.blockers.some((w: string) => /^SKELETON:/.test(w))).toBe(true);
    // Preferences: rolling-focus cadence (threshold focus chosen, week 2 has no Threshold day).
    expect(json.plan.findings.preferences.some((w: string) => /^PRIMARY QUALITY:/.test(w))).toBe(true);
    // The same facts must NOT also appear as warnings — one fact, one bucket owner.
    const gated = [...json.plan.findings.blockers, ...json.plan.findings.preferences];
    expect(json.plan.warnings.some((w: string) => gated.includes(w))).toBe(false);
    // And the gate ran exactly once per generation (no double-run for display).
    expect(gate.evaluatePublicationGate).toHaveBeenCalledTimes(1);
  });

  it("clean verdict → no findings key and warnings carry only informational notes", async () => {
    vi.mocked(gate.evaluatePublicationGate).mockReturnValueOnce({ blockers: [], preferences: [], advisories: [] });
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.findings).toBeUndefined();
    // No season throw, no repairs, no advisories, critic silent → nothing informational either.
    expect(json.plan.warnings).toEqual([]);
  });

  it("persists the verdict keyed by the canonical hash over plan.days + plan.blockParams", async () => {
    const json = await (await gen("Build FTP")).json();
    expect(store.saveGenerationVerdict).toHaveBeenCalledTimes(1);
    const record = vi.mocked(store.saveGenerationVerdict).mock.calls[0][0];
    expect(record.verdictHash).toBe(gate.verdictHash(json.plan.days, json.plan.blockParams));
    expect(record.blockers).toEqual(json.plan.findings.blockers);
    expect(record.preferences).toEqual(json.plan.findings.preferences);
    expect(record.model).toBe(GENERATION_MODEL);
    expect(record.promptVersion).toBe(PROMPT_VERSION);
    expect(typeof record.createdAt).toBe("string");
    // Nothing client-facing about the hash: the response body never mentions it.
    expect(JSON.stringify(json)).not.toContain(record.verdictHash);
  });

  it("a verdict-save failure never blocks generation (best-effort) — the store stays stale/absent", async () => {
    vi.mocked(store.saveGenerationVerdict).mockRejectedValueOnce(new Error("disk full"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBeDefined();
    expect(store.saveGenerationVerdict).toHaveBeenCalledTimes(1); // attempted exactly once, failure swallowed
  });

  it("season branch selection still routes through the gate's seasonContext unchanged (rolling)", async () => {
    await gen("Build FTP"); // no A-event → rolling branch
    const args = vi.mocked(gate.evaluatePublicationGate).mock.calls[0][0];
    expect(args.seasonContext?.mode).toBe("rolling");
    if (args.seasonContext?.mode === "rolling") {
      expect(typeof args.seasonContext.focus).toBe("string");
    }
  });

  it("season branch selection: an A-event routes through the gate exactly as the old route flags did", async () => {
    // SEASON_SHAPES_GENERATION is currently false, so — mirroring the pre-gate validator branch
    // (`SEASON_SHAPES_GENERATION && aEventForBlock && replannedSeason`, else rolling) — an
    // upcoming A-event still selects the ROLLING season family today. This pins that parity:
    // the gate must not silently widen or narrow the branch condition.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [{ name: "A Race", date: "2026-10-01", priority: "A" }],
      periods: [],
      updatedAt: "",
    } as never);
    await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const calls = vi.mocked(gate.evaluatePublicationGate).mock.calls;
    const args = calls[calls.length - 1][0];
    expect(args.seasonContext?.mode).toBe("rolling");
    expect(args.events.some((e) => e.name === "A Race")).toBe(true); // events still handed to the gate
  });
});
