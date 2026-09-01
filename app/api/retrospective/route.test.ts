import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReflectionInterventionInput, RetrospectiveInput } from "@/lib/anthropic-api";
import { approveSeedsInMarkdown, parseRetroSeeds } from "@/lib/kb-loader";
import type { StructuredReflection } from "@/lib/types";

// Route test for /api/retrospective — this route runs for the first time ever around 2026-07-12,
// when the current training block completes. It builds the very first BlockHistoryEntry ever written
// to block-history.json and destructively clears the active block, so its IO ordering and
// failure-tolerance around the LLM calls need characterization coverage before it ships live.

const h = vi.hoisted(() => ({
  isAnthropicConfigured: vi.fn(() => true),
  generateRetrospective: vi.fn<(input: RetrospectiveInput) => Promise<string>>(async () => "Solid block overall."),
  generateStructuredRetrospective: vi.fn<
    (input: RetrospectiveInput & { interventions: ReflectionInterventionInput[] }) => Promise<StructuredReflection[]>
  >(async () => []),
  writeRetrospective: vi.fn<(name: string, content: string) => Promise<void>>(async () => {}),
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readInterventionLog: vi.fn(),
  readAthleteProfile: vi.fn(),
  readScoreLog: vi.fn(),
  appendBlockHistory: vi.fn(async () => {}),
  updateCurrentBlock: vi.fn(async (mutate: (cur: null) => unknown) => mutate(null)),
  readBlockHistory: vi.fn(async () => []),
}));

vi.mock("@/lib/anthropic-api", () => ({
  GENERATION_MODEL: "active-retrospective-model",
  PROMPT_VERSION: 91,
  isAnthropicConfigured: h.isAnthropicConfigured,
  generateRetrospective: h.generateRetrospective,
  generateStructuredRetrospective: h.generateStructuredRetrospective,
}));

vi.mock("@/lib/kb-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kb-loader")>()),
  writeRetrospective: h.writeRetrospective,
}));

vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: h.readCurrentBlock,
  readLastSync: h.readLastSync,
  readInterventionLog: h.readInterventionLog,
  readAthleteProfile: h.readAthleteProfile,
  readScoreLog: h.readScoreLog,
  appendBlockHistory: h.appendBlockHistory,
  updateCurrentBlock: h.updateCurrentBlock,
  readBlockHistory: h.readBlockHistory,
}));

import * as store from "@/lib/data-store";
import { GENERATION_MODEL, PROMPT_VERSION } from "@/lib/anthropic-api";
import { POST, yamlDoubleQuoted } from "@/app/api/retrospective/route";

// post() sends { today: "2026-06-29" }; post(obj) without `today` merges that fixed date in, so
// no call site depends on the real system clock. Objects already carrying `today` pass through
// untouched. post(null) is the escape hatch: it sends a truly empty body, exercising the route's
// UTC-fallback semantics (used by the fake-timer HR-32 test below).
const post = (body?: unknown) => {
  const payload =
    body === null
      ? null
      : typeof body === "object" && !("today" in body)
        ? { ...(body as Record<string, unknown>), today: "2026-06-29" }
        : (body ?? { today: "2026-06-29" });
  return POST(
    new Request("http://localhost/api/retrospective", {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    })
  );
};

const day = (date: string, type: string, durationMin: number) => ({
  date,
  name: `${type} day`,
  type,
  durationMin,
});

const block = {
  goal: "Build FTP",
  lengthWeeks: 2,
  startDate: "2026-06-15",
  endDate: "2026-06-28",
  overview: "Two-week threshold build.",
  createdAt: "2026-06-14T08:00:00.000Z",
  days: [
    day("2026-06-15", "Z2", 90),
    day("2026-06-17", "Threshold", 60),
    day("2026-06-20", "Z2", 120),
    day("2026-06-22", "SIT", 45),
    day("2026-06-28", "Z2", 60),
  ],
  model: "claude-sonnet-4-6",
  promptVersion: 3,
};

const sync = {
  syncedAt: "2026-06-28T12:00:00.000Z",
  activities: [
    {
      id: "a1",
      date: "2026-06-15",
      type: "Ride",
      name: "Z2 ride",
      movingTimeSec: 5400,
      avgWatts: 180,
      normalizedPower: 185,
      maxWatts: 400,
      icuFtp: 250,
      trainingLoad: 60,
      decoupling: 3.2,
    },
    {
      id: "a2",
      date: "2026-06-17",
      type: "Ride",
      name: "Threshold ride",
      movingTimeSec: 3600,
      avgWatts: 220,
      normalizedPower: 230,
      maxWatts: 450,
      icuFtp: 250,
      trainingLoad: 80,
      decoupling: 2.1,
    },
  ],
  wellness: [
    { date: "2026-06-15", weightKg: 74, hrv: 60, sleepHours: 7, sleepQuality: 4, kcalConsumed: 2600, ctl: 50, atl: 55 },
    { date: "2026-06-28", weightKg: 73.5, hrv: 62, sleepHours: 7.5, sleepQuality: 4, kcalConsumed: 2700, ctl: 58, atl: 50 },
  ],
  powerCurve: [],
  fitness: { ctl: 58, atl: 50, tsb: 8 },
};

const athleteProfile = {
  performance: { ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 74, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 73 },
  goalsMigratedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const emptyInterventionLog = { records: [], updatedAt: new Date(0).toISOString() };

const maturedIntervention = {
  id: "int-1",
  firedAt: "2026-06-14",
  blockStartDate: "2026-06-15",
  dimension: "Threshold",
  severity: "watch" as const,
  title: "Threshold compliance watch",
  horizonDays: 14,
  baselineExecEwma: 0.8,
  baselinePhys: 250,
  physMetric: "5-min power",
  outcome: {
    evaluatedAt: "2026-06-28T00:00:00.000Z",
    execNow: 0.9,
    physNow: 260,
    execDelta: 0.1,
    physDelta: 10,
    verdict: "validated" as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.isAnthropicConfigured.mockReturnValue(true);
  h.generateRetrospective.mockResolvedValue("Solid block overall.");
  h.generateStructuredRetrospective.mockResolvedValue([]);
  h.writeRetrospective.mockResolvedValue(undefined);
  h.readCurrentBlock.mockResolvedValue(block);
  h.readLastSync.mockResolvedValue(sync);
  h.readInterventionLog.mockResolvedValue(emptyInterventionLog);
  h.readAthleteProfile.mockResolvedValue(athleteProfile);
  // Default ledger consistent with the fixture activities: same dates, capped compliance 100,
  // execution 7. Individual cases override via mockResolvedValue after this runs.
  h.readScoreLog.mockReset();
  h.readScoreLog.mockResolvedValue({
    entries: [
      { date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "a1" },
      { date: "2026-06-17", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Threshold", activityId: "a2" },
    ],
  });
  h.appendBlockHistory.mockResolvedValue(undefined);
  h.updateCurrentBlock.mockImplementation(async (mutate: (cur: null) => unknown) => mutate(null));
});

describe("/api/retrospective POST", () => {
  it("builds a BlockHistoryEntry carrying every required field", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(entry.id).toBe(block.createdAt);
    expect(entry.goal).toBe(block.goal);
    expect(entry.startDate).toBe(block.startDate);
    expect(entry.endDate).toBe(block.endDate);
    expect(entry.lengthWeeks).toBe(block.lengthWeeks);
    expect(entry.overview).toBe(block.overview);
    expect(entry.createdAt).toBe(block.createdAt);
    expect(entry.complianceByType).toBeDefined();
    expect(typeof entry.complianceByType).toBe("object");
    expect(entry.nextBlockSeeds).toBeDefined();
    expect(Array.isArray(entry.nextBlockSeeds)).toBe(true);
    expect(entry.retrospective).toBe("Solid block overall.");
    expect(entry.structuredReflections).toEqual([]);
    expect(entry.model).toBe(GENERATION_MODEL);
    expect(entry.promptVersion).toBe(PROMPT_VERSION);
    // SUB-1: every day in this fixture is on/before the block's own endDate, which is in the past
    // relative to any realistic "today" — truncateBlockDays should keep them all.
    expect(entry.days).toHaveLength(block.days.length);
    expect(entry.days.map((d: { date: string }) => d.date)).toEqual(block.days.map((d) => d.date));
  });

  it("records retrospective AI provenance when the deterministic block has none", async () => {
    const { model: _model, promptVersion: _promptVersion, ...deterministicBlock } = block;
    h.readCurrentBlock.mockResolvedValueOnce(deterministicBlock);

    await post();

    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.model).toBe(GENERATION_MODEL);
    expect(entry.promptVersion).toBe(PROMPT_VERSION);
    expect(deterministicBlock).not.toHaveProperty("model");
    expect(deterministicBlock).not.toHaveProperty("promptVersion");
  });

  it("averages decoupling only across whole-ride-comparable endurance rides", async () => {
    const steady = sync.activities[0];
    const mixed = (id: string, date: string, decoupling: number) => ({
      ...steady,
      id,
      date,
      name: "Mixed climbing ride",
      normalizedPower: 230,
      avgWatts: 180,
      decoupling,
    });

    h.readLastSync.mockResolvedValueOnce({
      ...sync,
      activities: [steady, mixed("a2", "2026-06-17", 8), mixed("a3", "2026-06-20", 10)],
    });
    await post();
    expect(h.generateRetrospective.mock.calls[0][0].avgDecoupling).toBe(3.2);

    h.readLastSync.mockResolvedValueOnce({
      ...sync,
      activities: [mixed("a2", "2026-06-17", 8), mixed("a3", "2026-06-20", 10)],
    });
    await post();
    expect(h.generateRetrospective.mock.calls[1][0].avgDecoupling).toBeNull();
  });

  it("carries block.seasonFocus forward onto the archived BlockHistoryEntry (CFS-8)", async () => {
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, seasonFocus: "threshold", seasonPhase: "build" });
    await post();
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.seasonFocus).toBe("threshold");
  });

  describe("version guard (HR-33)", () => {
    it("rejects with 409 and archives nothing when expectedBlockCreatedAt is stale", async () => {
      const res = await post({ expectedBlockCreatedAt: "2020-01-01T00:00:00Z" });
      expect(res.status).toBe(409);
      expect(store.appendBlockHistory).not.toHaveBeenCalled();
    });

    it("proceeds when expectedBlockCreatedAt matches the real block", async () => {
      const res = await post({ expectedBlockCreatedAt: block.createdAt });
      expect(res.status).toBe(200);
    });

    it("skips the check entirely when the caller sends no expectedBlockCreatedAt at all", async () => {
      const res = await post();
      expect(res.status).toBe(200);
    });

    it("HR-35: 409s (but keeps the already-saved retrospective in the response) when the block changed between the guard and the actual clear", async () => {
      // The guard above only runs once, before the live LLM call(s) — the widest window of any
      // block-mutating route. updateCurrentBlock's own CAS is what actually re-checks createdAt at
      // write time; simulate it rejecting, as it would if a concurrent write won the race.
      h.updateCurrentBlock.mockImplementation(async () => ({ ...block, createdAt: "2026-06-20T00:00:00.000Z" }));
      const res = await post({ expectedBlockCreatedAt: block.createdAt });
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(store.appendBlockHistory).toHaveBeenCalled(); // already saved — not rolled back
      expect(json.retrospective).toBe("Solid block overall.");
    });
  });

  describe("archive-truncation uses the client's local today (HR-32)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z")); // utcToday() === "2026-06-28"
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("archives a day already lived local-side even though the server's UTC date hasn't rolled over yet", async () => {
      h.readCurrentBlock.mockResolvedValueOnce({
        ...block,
        endDate: "2026-06-30",
        days: [...block.days, day("2026-06-29", "Z2", 60)], // rode it this morning, local
      });
      await post({ today: "2026-06-29", endedEarly: true, endReason: "Recovery reset" });
      const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.days.map((d: { date: string }) => d.date)).toContain("2026-06-29"); // not silently dropped
    });

    it("falls back to UTC when no today is sent in the body", async () => {
      // endDate shifted one day earlier so the Phase 1 gate (today > endDate, with UTC-fallback
      // today = 2026-06-28) sees a finished block — the truncation assertions are unchanged.
      h.readCurrentBlock.mockResolvedValueOnce({
        ...block,
        endDate: "2026-06-27",
        days: [...block.days, day("2026-06-29", "Z2", 60)],
      });
      await post(null); // truly empty body → UTC fallback
      const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.days.map((d: { date: string }) => d.date)).not.toContain("2026-06-29");
    });
  });

  it("omits seasonFocus on the archived entry when the block never had one (pre-upgrade block)", async () => {
    // Shared `block` fixture carries no seasonFocus at all — the pre-CFS-7 case.
    await post();
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.seasonFocus).toBeUndefined();
  });

  it("appends history before clearing the current block, and 502s without clearing if the append fails", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("disk full"));
    const res = await post();
    expect(res.status).toBe(502);
    expect(store.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("calls appendBlockHistory before updateCurrentBlock on the success path", async () => {
    const order: string[] = [];
    (store.appendBlockHistory as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push("append");
    });
    (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mockImplementationOnce(async (mutate: (cur: null) => unknown) => {
      order.push("clear");
      return mutate(null);
    });
    await post();
    expect(order).toEqual(["append", "clear"]);
    const mutateFn = (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mutateFn(null)).toBe(null);
  });

  it("tolerates a failing structured-reflections call, still succeeding with structuredReflections: []", async () => {
    h.readInterventionLog.mockResolvedValueOnce({ records: [maturedIntervention], updatedAt: "2026-06-28T00:00:00.000Z" });
    h.generateStructuredRetrospective.mockRejectedValueOnce(new Error("LLM 500"));

    const res = await post();
    expect(res.status).toBe(200);
    expect(h.generateStructuredRetrospective).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.structuredReflections).toEqual([]);

    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.structuredReflections).toEqual([]);
  });

  it("fires the structured call when a matured intervention matches the block's startDate", async () => {
    h.readInterventionLog.mockResolvedValueOnce({ records: [maturedIntervention], updatedAt: "2026-06-28T00:00:00.000Z" });
    h.generateStructuredRetrospective.mockResolvedValueOnce([
      { dimension: "Threshold", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" },
    ]);

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.structuredReflections).toHaveLength(1);
    const callArg = h.generateStructuredRetrospective.mock.calls[0][0];
    expect(callArg.interventions).toHaveLength(1);
    expect(callArg.interventions[0].dimension).toBe("Threshold");
    const content = h.writeRetrospective.mock.calls[0][1] as string;
    expect(content).toContain("Coach reflections (UNACKNOWLEDGED — history record only)");
    expect(content).not.toMatch(/reach the next block/i);
  });

  it("tolerates an empty/missing intervention log — no crash, empty structuredReflections, structured call skipped", async () => {
    // Exactly the real default shape readInterventionLog() resolves to for a genuinely-missing file.
    h.readInterventionLog.mockResolvedValueOnce({ records: [], updatedAt: new Date(0).toISOString() });

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.structuredReflections).toEqual([]);
    expect(h.generateStructuredRetrospective).not.toHaveBeenCalled();
  });

  it("writes the retro file with the retroFileId filename and execution frontmatter", async () => {
    await post();
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1); // sanity: reached the end of the handler
    expect(h.writeRetrospective).toHaveBeenCalledTimes(1);
    const [filename, content] = h.writeRetrospective.mock.calls[0];
    // retroFileId(): lowercase, non [a-z0-9] runs -> '-', trim leading/trailing '-', cap at 40 chars.
    expect(filename).toBe("2026-06-15_build-ftp.md");
    expect(content).toContain('id: "2026-06-15_build-ftp"');
    expect(content).toContain("next_block_seeds:");
    expect(content).toContain("execution_scored: 2/5");
    expect(content).toContain("seeds_approved: false");
  });

  it("round-trips legacy seeds through the acknowledged history record", async () => {
    // Stored-history compatibility: acknowledgement exposes the legacy list to its parser, but
    // deterministic generation has no consumer for the parsed value.
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.writeRetrospective).toHaveBeenCalledTimes(1);
    const md = h.writeRetrospective.mock.calls[0][1] as string;
    expect(md).toContain("next_block_seeds:");
    expect(parseRetroSeeds(md)).toEqual([]); // gated while unapproved
    const adopted = approveSeedsInMarkdown(md);
    const seeds = parseRetroSeeds(adopted);
    expect(seeds.length).toBeGreaterThan(0);
    expect(body.seeds).toEqual(seeds); // file list == response seeds
  });

  describe("live Anthropic call failure (HR-57, Phase 1 trust contract)", () => {
    it("degrades to a deterministic closeout (200, retrospective null) when generateRetrospective rejects", async () => {
      h.generateRetrospective.mockRejectedValueOnce(new Error("529 overloaded"));
      const res = await post();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.retrospective).toBeNull();
      expect(json.narrativeDegraded).toBe(true);
    });

    it("still archives and clears the block when generateRetrospective fails", async () => {
      h.generateRetrospective.mockRejectedValueOnce(new Error("network blip"));
      const res = await post();
      expect(res.status).toBe(200);
      expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
      expect(store.updateCurrentBlock).toHaveBeenCalled();
    });
  });

  it("closes out deterministically when Anthropic is not configured — no preflight 400 (Phase 1)", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(200);
    expect(store.readCurrentBlock).toHaveBeenCalled();
    const json = await res.json();
    expect(json.retrospective).toBeNull();
    expect(json.narrativeDegraded).toBe(true);
    expect(h.generateRetrospective).not.toHaveBeenCalled();
  });

  it("404s when there is no active block", async () => {
    h.readCurrentBlock.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(404);
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("400s when there is no sync data", async () => {
    h.readLastSync.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(400);
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("closes out an unfinished block given an explicit early-end decision (was: archived freely — now gated)", async () => {
    // The Phase 1 gate replaced the old no-guard characterization: an unfinished block can only
    // complete via endedEarly + reason, which then runs the full closeout end to end.
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, endDate: "2027-06-28" });

    const res = await post({ endedEarly: true, endReason: "Race prep pivot" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fileId).toBe("2026-06-15_build-ftp");
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
    expect(store.updateCurrentBlock).toHaveBeenCalled();
    const mutateFn = (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mutateFn(null)).toBe(null);
  });
});

describe("Phase 1 trust contract", () => {
  const unfinished = { ...block, endDate: "2099-01-01" };

  it("yamlDoubleQuoted preserves leading/trailing spaces while still flattening CRLF runs", () => {
    expect(yamlDoubleQuoted("  keep me  \r\n")).toBe('"  keep me   "');
  });

  it("409s an unfinished block with no explicit early-end decision — and writes NOTHING", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post();
    expect(res.status).toBe(409);
    expect(h.writeRetrospective).not.toHaveBeenCalled();
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("proceeds on an explicit early-end decision and records it on the history entry", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "Race prep pivot" });
    expect(res.status).toBe(200);
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeTruthy();
    expect(arg.endedEarlyReason).toBe("Race prep pivot");
  });

  it("escapes quotes and flattens newlines in ended_early_reason frontmatter without corrupting the history entry", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const reason = 'Pivot: rider said "stop"\nmid-block';
    const res = await post({ endedEarly: true, endReason: reason });
    expect(res.status).toBe(200);
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.endedEarlyReason).toBe(reason); // history entry round-trips the original verbatim
    const content = h.writeRetrospective.mock.calls[0][1] as string;
    const reasonLine = content.split("\n").find((line) => line.startsWith("ended_early_reason:"));
    // Exactly one single-line frontmatter value: the quote ESCAPED (not substituted), newline
    // collapsed — so no raw newline can sit between the quotes and break the YAML.
    expect(reasonLine).toBe(`ended_early_reason: "Pivot: rider said \\"stop\\" mid-block"`);
  });

  it("escapes (never substitutes) quotes and flattens newlines in the goal frontmatter value", async () => {
    // Goals can be multi-line (the Plan page splits them on \n) and may carry quotes — the raw
    // interpolation previously broke strict YAML; quote substitution corrupted the text.
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, goal: 'Build "big" FTP\nfor racing' });
    const res = await post();
    expect(res.status).toBe(200);
    const content = h.writeRetrospective.mock.calls[0][1] as string;
    const goalLine = content.split("\n").find((line) => line.startsWith("goal:"));
    expect(goalLine).toBe('goal: "Build \\"big\\" FTP for racing"');
  });

  it("a seed containing a double quote and a newline survives the markdown channel intact", () => {
    // The route's seeds are templated today, but the channel must be loss-proof for any text:
    // writer escapes, approval flips the stamp, parser unescapes back to the original.
    const seed = 'Progress "threshold" focus\nnext block';
    const doc = [
      "---",
      'id: "2026-06-15_build-ftp"',
      "seeds_approved: false",
      "next_block_seeds:",
      `  - ${yamlDoubleQuoted(seed)}`,
      "---",
      "## Retrospective",
    ].join("\n");
    expect(doc).toContain('\\"');
    expect(doc).not.toContain("'threshold'");
    expect(parseRetroSeeds(doc)).toEqual([]); // gated while unapproved
    // Quotes survive byte-exact; CR/LF runs are deliberately flattened to one space by the
    // single-line frontmatter format (same contract as ended_early_reason).
    expect(parseRetroSeeds(approveSeedsInMarkdown(doc))).toEqual(['Progress "threshold" focus next block']);
  });

  it("409s an early-end decision with a blank reason", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "   " });
    expect(res.status).toBe(409);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("closes out a normally finished block without any endedEarly fields", async () => {
    h.readCurrentBlock.mockResolvedValue(block); // endDate 2026-06-28 < today fixture usage below
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
  });

  it("completes the whole closeout when Anthropic is NOT configured", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retrospective).toBeNull();
    expect(body.narrativeDegraded).toBe(true);
    expect(h.generateRetrospective).not.toHaveBeenCalled();
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.retrospective).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
    expect(arg.nextBlockSeeds.length).toBeGreaterThan(0);
    expect(h.updateCurrentBlock).toHaveBeenCalled(); // the clear STILL happened
  });

  it("degrades gracefully when the narrative call THROWS (no 502, closeout completes)", async () => {
    h.generateRetrospective.mockRejectedValueOnce(new Error("429 overload"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    expect((await res.json()).retrospective).toBeNull();
    expect(h.appendBlockHistory).toHaveBeenCalledTimes(1);
  });

  it("a markdown-write failure leaves history and the active block untouched", async () => {
    h.writeRetrospective.mockRejectedValueOnce(new Error("disk full"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("a history-append failure leaves the active block uncleared", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("lock poisoned"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("persists closeout evidence built from CAPPED ledger values, and no approval stamp", async () => {
    h.readCurrentBlock.mockResolvedValue(block);
    h.readScoreLog.mockResolvedValue({
      entries: [
        { date: "2026-06-17", planned: true, executionScore: 3, compliancePct: 54, plannedType: "Threshold", activityId: "a2" },
      ],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    const threshold = body.closeout.perType.find((t: { type: string }) => t.type === "Threshold");
    expect(threshold.meanCompliancePct).toBe(54); // capped ledger value…
    expect(threshold.meanCompliancePct).not.toBe(100); // …not the raw 60/60 ratio
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.reflectionsApprovedAt).toBeUndefined();
  });

  it("flags overshoot against the ride the ledger scored when a shorter ride sorts first", async () => {
    const twoRides = {
      ...sync,
      activities: [
        { ...sync.activities[0], id: "short", movingTimeSec: 20 * 60 }, // first on 06-15
        { ...sync.activities[0], id: "long", movingTimeSec: 120 * 60 }, // actual primary
      ],
    };
    h.readLastSync.mockResolvedValue(twoRides);
    h.readCurrentBlock.mockResolvedValue(block);
    h.readScoreLog.mockResolvedValue({
      entries: [{ date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "long" }],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    expect(body.closeout.overshootSessions).toBe(1); // 120min vs 90 planned > 1.25× — judged on "long"
  });

  it("early ends count only lived days as missed", async () => {
    const early = { ...unfinished, days: [day("2026-06-16", "Z2", 60), day("2098-12-31", "SIT", 45)] };
    h.readCurrentBlock.mockResolvedValue(early);
    h.readScoreLog.mockResolvedValue({ entries: [] });
    const res = await post({ today: "2026-06-20", endedEarly: true, endReason: "injury" });
    const body = await res.json();
    expect(body.closeout.plannedSessions).toBe(1); // the 2098 day excluded entirely
    expect(body.closeout.missedSessions).toBe(1);
  });

  it("FR-13: early end gives both AI calls and history only the lived window", async () => {
    const earlyBlock = {
      ...block,
      startDate: "2026-08-31",
      endDate: "2026-09-13",
      createdAt: "2026-08-30T08:00:00.000Z",
      days: [
        day("2026-09-01", "Threshold", 60),
        day("2026-09-03", "SIT", 45),
      ],
    };
    const futureRide = {
      ...sync.activities[0],
      id: "future",
      date: "2026-09-03",
      name: "Future sentinel",
      movingTimeSec: 2 * 3600,
      trainingLoad: 200,
      decoupling: 1,
    };
    h.readCurrentBlock.mockResolvedValue(earlyBlock);
    h.readLastSync.mockResolvedValue({
      ...sync,
      activities: [futureRide],
      wellness: [
        { ...sync.wellness[0], date: "2026-08-31", ctl: 50 },
        { ...sync.wellness[1], date: "2026-09-01", ctl: 51 },
        { ...sync.wellness[1], date: "2026-09-13", ctl: 99 },
      ],
    });
    h.readScoreLog.mockResolvedValue({ entries: [] });
    h.readInterventionLog.mockResolvedValue({
      records: [{ ...maturedIntervention, blockStartDate: earlyBlock.startDate }],
      updatedAt: new Date(0).toISOString(),
    });

    const res = await post({
      today: "2026-09-01",
      endedEarly: true,
      endReason: "Recovery reset",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.closeout).toMatchObject({
      plannedSessions: 1,
      scoredSessions: 0,
      missedSessions: 1,
    });

    for (const input of [
      h.generateRetrospective.mock.calls[0][0],
      h.generateStructuredRetrospective.mock.calls[0][0],
    ]) {
      expect(input).toMatchObject({
        startDate: "2026-08-31",
        endDate: "2026-09-13",
        effectiveCloseoutDate: "2026-09-01",
        endedEarly: true,
        plannedHours: 1,
        actualHours: 0,
        ctlEnd: 51,
        topSessions: [],
        avgDecoupling: null,
      });
    }

    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry).toMatchObject({
      startDate: "2026-08-31",
      endDate: "2026-09-13",
      lengthWeeks: 2,
      plannedHours: 1,
      actualHours: 0,
    });
    expect(entry.days.map((d: { date: string }) => d.date)).toEqual(["2026-09-01"]);
  });

  it("FR-13: early-end CTL ignores a nearer post-closeout wellness row", async () => {
    const earlyBlock = {
      ...block,
      startDate: "2026-08-25",
      endDate: "2026-09-13",
      days: [day("2026-08-28", "Z2", 60), day("2026-09-03", "SIT", 45)],
    };
    h.readCurrentBlock.mockResolvedValue(earlyBlock);
    h.readLastSync.mockResolvedValue({
      ...sync,
      activities: [],
      wellness: [
        { ...sync.wellness[0], date: "2026-08-25", ctl: 50 },
        { ...sync.wellness[1], date: "2026-08-28", ctl: 54 },
        { ...sync.wellness[1], date: "2026-09-02", ctl: 99 },
      ],
    });
    h.readScoreLog.mockResolvedValue({ entries: [] });

    const res = await post({
      today: "2026-09-01",
      endedEarly: true,
      endReason: "Recovery reset",
    });

    expect(res.status).toBe(200);
    expect(h.generateRetrospective.mock.calls[0][0]).toMatchObject({
      effectiveCloseoutDate: "2026-09-01",
      ctlStart: 50,
      ctlEnd: 54,
    });
    expect((store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ctlGain: 4,
    });
  });

  it("FR-13: normal completion keeps the full scheduled and actual window", async () => {
    await post({ today: "2026-06-29" });

    expect(h.generateRetrospective.mock.calls[0][0]).toMatchObject({
      effectiveCloseoutDate: "2026-06-28",
      endedEarly: false,
      plannedHours: 6.25,
      actualHours: 2.5,
      ctlEnd: 58,
    });
    expect((store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      plannedHours: 6.3,
      actualHours: 2.5,
    });
  });

  it("FR-13: a finished block ignores an early-end request flag", async () => {
    const res = await post({
      today: "2026-06-29",
      endedEarly: true,
      endReason: "Stale client decision",
    });

    expect(res.status).toBe(200);
    expect(h.generateRetrospective.mock.calls[0][0]).toMatchObject({
      effectiveCloseoutDate: "2026-06-28",
      endedEarly: false,
    });
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry).not.toHaveProperty("endedEarlyAt");
    expect(entry).not.toHaveProperty("endedEarlyReason");
  });
});
