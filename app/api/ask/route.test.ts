import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for /api/ask (CR-8): proves the route assembles the CoachSnapshot from the stores
// (#1 wiring) — today's execution, fuel, the disposition guard, ftp — and hands it to the model. The
// data layer + the LLM call are mocked; the snapshot assembly runs for real.
vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readTodayAnalysis: vi.fn(),
  readDispositions: vi.fn(),
  readScoreLog: vi.fn(),
  readRollingBaselines: vi.fn(),
  readInterventionLog: vi.fn(),
  readMorningChecks: vi.fn(),
}));
vi.mock("@/lib/physiology", () => ({ readPhysiology: vi.fn() }));
vi.mock("@/lib/anthropic-api", () => ({
  isAnthropicConfigured: () => true,
  streamAskCoach: vi.fn(async function* () {
    yield "ok";
  }),
}));

import * as store from "@/lib/data-store";
import { readPhysiology } from "@/lib/physiology";
import { streamAskCoach } from "@/lib/anthropic-api";
import { POST } from "@/app/api/ask/route";
import type { SyncData, TodayAnalysis } from "@/lib/types";

const TODAY = "2026-06-20";
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -12 } } as unknown as SyncData;
const todayAnalysis = {
  activityDate: TODAY,
  executionScore: 4,
  intervalComparison: { prescribedLabels: [], reps: [], completed: 2, total: 5, avgAdherencePct: 95, avgDurationPct: 41, effectiveAdherencePct: 39, structuralMismatch: false, extras: [] },
  advisedIntakeKcal: 2800,
  activityKj: 950,
} as unknown as TodayAnalysis;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readLastSync).mockResolvedValue(sync);
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(todayAnalysis);
  vi.mocked(store.readDispositions).mockResolvedValue({ entries: [{ date: TODAY, disposition: "compromised", reason: "equipment", setAt: "" }], updatedAt: "" });
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readRollingBaselines).mockResolvedValue({} as never);
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(readPhysiology).mockResolvedValue({ current: { ftp: 280 } } as never);
});

describe("POST /api/ask", () => {
  it("assembles the CoachSnapshot from the stores and passes it to the model", async () => {
    const res = await POST(new Request("http://t/api/ask", { method: "POST", body: JSON.stringify({ query: "go hard today?", today: TODAY }) }));
    await res.text(); // drive the stream so the (mocked) generator is invoked

    expect(streamAskCoach).toHaveBeenCalledOnce();
    const ctx = vi.mocked(streamAskCoach).mock.calls[0][0];
    expect(ctx.snapshot.today.execution).toMatchObject({ score: 4, completed: 2, total: 5, effectivePct: 39 });
    expect(ctx.snapshot.fuel.todayTargetKcal).toBe(2800);
    expect(ctx.snapshot.ftp).toBe(280);
    // the compromised disposition rides in the snapshot — the §5 anti-pattern guard (#1)
    expect(ctx.snapshot.disposition).toMatchObject({ kind: "compromised", reason: "equipment" });
  });

  it("rejects an empty question (400)", async () => {
    const res = await POST(new Request("http://t/api/ask", { method: "POST", body: JSON.stringify({ query: "  ", today: TODAY }) }));
    expect(res.status).toBe(400);
    expect(streamAskCoach).not.toHaveBeenCalled();
  });
});
