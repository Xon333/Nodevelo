import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActivities, IntervalsApiError, isSuspectEmptySync } from "./intervals-api";
import type { SyncData } from "./types";

const mkSync = (over: Partial<SyncData> = {}): SyncData => ({
  syncedAt: "2026-06-22T00:00:00.000Z",
  activities: [],
  wellness: [],
  powerCurve: [],
  powerCurveAllTime: [],
  fitness: { ctl: null, atl: null, tsb: null },
  ...over,
});

describe("isSuspectEmptySync (CR-C don't wipe good data)", () => {
  const withData = mkSync({
    activities: [{ date: "2026-06-20" } as SyncData["activities"][number]],
  });

  it("flags an empty result when the previous sync had data", () => {
    expect(isSuspectEmptySync(withData, mkSync())).toBe(true);
  });

  it("allows an empty result on the first sync (no prior to protect)", () => {
    expect(isSuspectEmptySync(null, mkSync())).toBe(false);
  });

  it("allows an empty result when the previous sync was also empty (genuinely empty account)", () => {
    expect(isSuspectEmptySync(mkSync(), mkSync())).toBe(false);
  });

  it("allows a normal non-empty sync", () => {
    expect(isSuspectEmptySync(withData, withData)).toBe(false);
  });

  it("treats wellness-only data on either side as data (not a wipe)", () => {
    const wellnessOnly = mkSync({ wellness: [{ date: "2026-06-20" } as SyncData["wellness"][number]] });
    expect(isSuspectEmptySync(wellnessOnly, mkSync())).toBe(true); // had wellness, now nothing → suspect
    expect(isSuspectEmptySync(withData, wellnessOnly)).toBe(false); // still has wellness → fine
  });
});

// These exercise the network-failure mapping in icuFetch (CR-B): a stalled or failed request must
// surface as a clean IntervalsApiError, not a raw DOMException/TypeError leaking out of the client.
describe("intervals-api network failure handling (CR-B)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.INTERVALS_API_KEY = "test-key";
    process.env.INTERVALS_ATHLETE_ID = "i1";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.INTERVALS_API_KEY;
    delete process.env.INTERVALS_ATHLETE_ID;
    vi.restoreAllMocks();
  });

  it("maps an aborted (timed-out) request to a clear IntervalsApiError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError")
    ) as unknown as typeof fetch;
    await expect(fetchActivities("2026-01-01", "2026-06-01")).rejects.toThrow(IntervalsApiError);
    await expect(fetchActivities("2026-01-01", "2026-06-01")).rejects.toThrow(/timed out/i);
  });

  it("maps a generic network failure to an IntervalsApiError (not a raw TypeError)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    await expect(fetchActivities("2026-01-01", "2026-06-01")).rejects.toThrow(IntervalsApiError);
  });

  it("passes an AbortSignal on the outgoing request so a stall can be cancelled", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await fetchActivities("2026-01-01", "2026-06-01");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
