import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActivities, IntervalsApiError, isSuspectEmptySync, resolveAllTimeCurve } from "./intervals-api";
import type { PowerCurvePoint, SyncData } from "./types";

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

describe("resolveAllTimeCurve (CR-H monotonic all-time)", () => {
  const pt = (durationSec: number, watts: number): PowerCurvePoint => ({ durationSec, watts });

  it("uses the fresh fetch when present", () => {
    const fresh = [pt(5, 1000), pt(300, 320)];
    expect(resolveAllTimeCurve(fresh, [pt(5, 900)], [pt(5, 100)])).toEqual(fresh);
  });

  it("never drops below a previously-known all-time best (monotonic merge)", () => {
    const prev = [pt(5, 1100), pt(300, 330)];
    const fresh = [pt(5, 1000), pt(300, 350)]; // 5s regressed (API glitch), 300s is a real PR
    expect(resolveAllTimeCurve(fresh, prev, [])).toEqual([pt(5, 1100), pt(300, 350)]);
  });

  it("carries forward the previous all-time when the fresh fetch is empty (not the 84-day curve)", () => {
    const prev = [pt(5, 1100)];
    const recent84d = [pt(5, 800)];
    expect(resolveAllTimeCurve([], prev, recent84d)).toEqual(prev);
  });

  it("falls back to the recent curve only on the first sync (no prior all-time)", () => {
    const recent84d = [pt(5, 800)];
    expect(resolveAllTimeCurve([], [], recent84d)).toEqual(recent84d);
  });

  it("merges durations that exist on only one side", () => {
    const prev = [pt(60, 400)];
    const fresh = [pt(5, 1000)];
    expect(resolveAllTimeCurve(fresh, prev, [])).toEqual([pt(5, 1000), pt(60, 400)]);
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

  it("maps power metrics off the keys intervals.icu actually returns (NP/decoupling/max)", async () => {
    // Raw shape from a real activity: NP under icu_weighted_avg_watts, decoupling under `decoupling`,
    // max power under icu_pm_p_max — NOT icu_normalized_power / max_watts (which it doesn't send).
    const raw = [{
      id: "i1", start_date_local: "2026-06-23T08:00:00", type: "Ride", name: "Cycling",
      moving_time: 8189, icu_average_watts: 179, icu_weighted_avg_watts: 235, icu_pm_p_max: 591,
      decoupling: 14.6, icu_efficiency_factor: 1.64, average_heartrate: 143, max_heartrate: 190,
      icu_joules: 1472172, icu_training_load: 151, carbs_ingested: 114,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.normalizedPower).toBe(235);
    expect(a.decoupling).toBe(14.6);
    expect(a.maxWatts).toBe(591);
    expect(a.carbsIngestedG).toBe(114);
  });
});
