import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/disposition (CR-G — first coverage for a mutating route). The data layer is
// mocked but the transactional mutators run for real against in-memory fixtures, so this proves the
// route merges the disposition and re-stamps the ledger through the CR-A updateScoreLog path (not a
// raw read+write), and that mergeDisposition/applyDispositions are wired correctly.
vi.mock("@/lib/data-store", () => ({
  readDispositions: vi.fn(),
  updateDispositions: vi.fn(),
  updateScoreLog: vi.fn(),
}));

import { updateDispositions, updateScoreLog } from "@/lib/data-store";
import { POST } from "@/app/api/disposition/route";
import type { DispositionEntry, RideScoreEntry } from "@/lib/types";

const TODAY = "2026-06-22";

let dispositionEntries: DispositionEntry[];
let scoreEntries: RideScoreEntry[];

beforeEach(() => {
  vi.clearAllMocks();
  dispositionEntries = [];
  scoreEntries = [
    { date: TODAY, executionScore: 8, plannedType: "Threshold", inferredType: "Threshold", planned: true, legacy: false, compliancePct: 100, intensityFactor: 0.88, ftpUsed: 250, durationMin: 60, tss: 75 },
  ];
  // Apply the real mutator against the in-memory fixtures so the transaction's effect is observable.
  vi.mocked(updateDispositions).mockImplementation(async (mutate) => {
    dispositionEntries = mutate(dispositionEntries);
    return { entries: dispositionEntries, updatedAt: "now" };
  });
  vi.mocked(updateScoreLog).mockImplementation(async (mutate) => {
    scoreEntries = mutate(scoreEntries);
    return { entries: scoreEntries, updatedAt: "now" };
  });
});

const post = (body: unknown) =>
  POST(new Request("http://t/api/disposition", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/disposition", () => {
  it("rejects an invalid disposition without touching either store", async () => {
    const res = await post({ date: TODAY, disposition: "nonsense" });
    expect(res.status).toBe(400);
    expect(updateDispositions).not.toHaveBeenCalled();
    expect(updateScoreLog).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid date", async () => {
    expect((await post({ disposition: "completed" })).status).toBe(400);
    expect((await post({ date: "06/22/2026", disposition: "completed" })).status).toBe(400);
  });

  it("records a disposition and re-stamps the ledger transactionally", async () => {
    const res = await post({ date: TODAY, disposition: "compromised", reason: "equipment" });
    expect(res.status).toBe(200);
    const { disposition } = await res.json();
    expect(disposition).toMatchObject({ date: TODAY, disposition: "compromised", reason: "equipment" });

    // Disposition merged...
    expect(updateDispositions).toHaveBeenCalledOnce();
    expect(dispositionEntries).toHaveLength(1);
    // ...and the ledger re-stamped via the CR-A transactional helper, flagging the matching ride.
    expect(updateScoreLog).toHaveBeenCalledOnce();
    expect(scoreEntries.find((e) => e.date === TODAY)?.compromised).toBe(true);
  });

  it("drops a reason for non-compromised dispositions", async () => {
    const res = await post({ date: TODAY, disposition: "completed", reason: "equipment" });
    const { disposition } = await res.json();
    expect(disposition.reason).toBeNull();
  });
});
