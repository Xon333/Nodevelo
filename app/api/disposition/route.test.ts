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

import { readDispositions, updateDispositions, updateScoreLog } from "@/lib/data-store";
import { GET, POST } from "@/app/api/disposition/route";
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
  vi.mocked(readDispositions).mockImplementation(async () => ({ entries: dispositionEntries, updatedAt: "now" }));
  // Apply the real mutator against the in-memory fixtures so the transaction's effect is observable.
  vi.mocked(updateDispositions).mockImplementation(async (mutate) => {
    dispositionEntries = mutate(dispositionEntries);
    return { entries: dispositionEntries, updatedAt: "now" };
  });
  vi.mocked(updateScoreLog).mockImplementation(async (mutate) => {
    scoreEntries = await mutate(scoreEntries);
    return { entries: scoreEntries, updatedAt: "now" };
  });
});

const post = (body: unknown) =>
  POST(new Request("http://t/api/disposition", { method: "POST", body: JSON.stringify(body) }));
const get = (qs: string) => GET(new Request(`http://t/api/disposition${qs}`));

describe("GET /api/disposition — HR-54(c) date-omitted fallback", () => {
  it("uses the client-supplied ?today when ?date is omitted, not a bare UTC computation", async () => {
    dispositionEntries = [{ date: "2026-06-23", disposition: "completed", reason: null, setAt: "now" }];
    // No ?date at all — falls back to resolveToday(?today), not an inline new Date().toISOString().
    const json = await (await get("?today=2026-06-23")).json();
    expect(json.disposition).toEqual({ date: "2026-06-23", disposition: "completed", reason: null, setAt: "now" });
  });

  it("still honours an explicit ?date over ?today", async () => {
    dispositionEntries = [{ date: "2026-06-20", disposition: "partial", reason: null, setAt: "now" }];
    const json = await (await get("?date=2026-06-20&today=2026-06-23")).json();
    expect(json.disposition?.date).toBe("2026-06-20");
  });
});

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
