import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActivities, fetchIntervals, fetchWellness, IntervalsApiError, isSuspectEmptySync, resolveAllTimeCurve } from "./intervals-api";
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

  it("maps the three newly-added interval fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 237, average_watts: 267, average_gradient: 0.07907035,
      zone: 4, group_id: "237s@267w80rpm",
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.avgGradientPct).toBeCloseTo(7.907, 2);
    expect(interval.zone).toBe(4);
    expect(interval.groupId).toBe("237s@267w80rpm");
  });

  it("maps all three to null when the raw payload omits them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 237, average_watts: 267,
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.avgGradientPct).toBeNull();
    expect(interval.zone).toBeNull();
    expect(interval.groupId).toBeNull();
  });

  it("maps the five Phase 3b interval fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 480, average_watts: 210,
      max_heartrate: 172, average_cadence: 88, Maxgradient: 11.7,
      total_elevation_gain: 42.5, label: "Climb 1",
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.maxHr).toBe(172);
    expect(interval.avgCadenceRpm).toBe(88);
    expect(interval.maxGradientPct).toBeCloseTo(11.7, 1);
    expect(interval.elevationGainM).toBeCloseTo(42.5, 1);
    expect(interval.label).toBe("Climb 1");
  });

  it("maps all five to null when the raw payload omits them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 480, average_watts: 210,
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.maxHr).toBeNull();
    expect(interval.avgCadenceRpm).toBeNull();
    expect(interval.maxGradientPct).toBeNull();
    expect(interval.elevationGainM).toBeNull();
    expect(interval.label).toBeNull();
  });

  // NV-14 (2026-08-15): evidence-only field, live-confirmed present on real payloads
  // (activities i175672010, i175980689 — 13/13 curated intervals populated) before adding this
  // mapping. `average_speed` arrives in m/s; converted to km/h at this one boundary.
  it("maps average_speed (m/s) to avgSpeedKph, converted at the boundary", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 480, average_watts: 210, average_speed: 5.778887, // live-observed value
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.avgSpeedKph).toBeCloseTo(20.804, 2); // 5.778887 * 3.6
  });

  it("maps avgSpeedKph to null when the raw payload omits average_speed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 480, average_watts: 210,
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.avgSpeedKph).toBeNull();
  });

  it("treats an empty-string label as null, not an empty match target", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      type: "WORK", moving_time: 480, average_watts: 210, label: "",
    }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const [interval] = await fetchIntervals("act-1");
    expect(interval.label).toBeNull();
  });

  it("maps power metrics off the keys intervals.icu actually returns (NP/decoupling/max)", async () => {
    // Raw shape from a real activity: NP under icu_weighted_avg_watts, decoupling under `decoupling`,
    // max power under icu_pm_p_max — NOT icu_normalized_power / max_watts (which it doesn't send).
    const raw = [{
      id: "i1", start_date_local: "2026-06-23T08:00:00", type: "Ride", name: "Cycling",
      moving_time: 8189, icu_average_watts: 179, icu_weighted_avg_watts: 235, icu_pm_p_max: 591,
      decoupling: 14.6, icu_efficiency_factor: 1.64, average_heartrate: 143, max_heartrate: 190,
      icu_joules: 1472172, icu_training_load: 151, carbs_ingested: 114, icu_ftp: 268,
      icu_power_hr_z2: 1.5684667, icu_power_hr_z2_mins: 42,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.normalizedPower).toBe(235);
    expect(a.decoupling).toBe(14.6);
    expect(a.maxWatts).toBe(591);
    expect(a.carbsIngestedG).toBe(114);
    expect(a.icuFtp).toBe(268); // RV-5: the FTP intervals.icu applied to this ride
    expect(a.powerHrZ2).toBeCloseTo(1.5685, 3); // Z2-isolated Pw:HR — the athlete-state aerobic signal
    expect(a.powerHrZ2Mins).toBe(42);
  });

  it("treats a present-but-zero weighted-avg power as missing, not a 0 W effort (API-1)", async () => {
    // A sensor dropout can serialise NP as 0; num(0)=0 would short-circuit the ?? and force IF to 0 (a
    // quality ride read as recovery). It must be null so IF falls back to avg watts downstream.
    const raw = [{
      id: "z1", start_date_local: "2026-06-23T08:00:00", type: "Ride", name: "Dropout",
      moving_time: 3600, icu_average_watts: 180, icu_weighted_avg_watts: 0,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.normalizedPower).toBeNull();
    expect(a.avgWatts).toBe(180);
  });

  it("accepts a numeric-string decoupling (some payloads serialise it as a string) (API-2)", async () => {
    const raw = [{
      id: "d1", start_date_local: "2026-06-23T08:00:00", type: "Ride", name: "StringDecoup",
      moving_time: 3600, icu_average_watts: 180, icu_weighted_avg_watts: 190, decoupling: "4.5",
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.decoupling).toBe(4.5);
  });

  it("maps W′ off the ROLLING key and ride depletion off max_wbal, ignoring the per-ride pm_* fits", async () => {
    // Live-verified raw shape (76 rides, 3 months). All four keys ship on the same activity, and picking
    // the wrong one is the eFTP trap again: icu_pm_cp/icu_pm_w_prime re-fit the model to each ride
    // (145–282 W, 11.0–24.8 kJ) while icu_rolling_w_prime holds an athlete-level value steady across a
    // window. This test pins that we read the stable one and never surface a per-ride CP.
    const raw = [{
      id: "w1", start_date_local: "2026-07-30T08:00:00", type: "Ride", name: "Endurance",
      moving_time: 7200, icu_average_watts: 190, icu_weighted_avg_watts: 205,
      icu_rolling_w_prime: 24218.033, icu_max_wbal_depletion: 4155,
      icu_pm_cp: 214, icu_pm_w_prime: 18213, icu_rolling_cp: null,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-07-01", "2026-07-30");
    expect(a.wPrimeRollingJ).toBeCloseTo(24218.033, 3);
    expect(a.wBalDepletionJ).toBe(4155);
    // The volatile per-ride fits must not leak in under either field.
    expect(a.wPrimeRollingJ).not.toBe(18213);
    expect(a.wBalDepletionJ).not.toBe(214);
  });

  it("keeps a zero W′ depletion as a real reading, but treats a zero rolling W′ as absent", async () => {
    // Asymmetry by design: 0 J depletion is a genuine measurement (a steady ride that never dipped into
    // the reserve — observed on a real VirtualRide), whereas a 0 J athlete W′ is physiologically
    // meaningless and can only be a dropout.
    const raw = [{
      id: "w2", start_date_local: "2026-07-29T08:00:00", type: "VirtualRide", name: "Steady",
      moving_time: 3600, icu_average_watts: 150, icu_weighted_avg_watts: 152,
      icu_rolling_w_prime: 0, icu_max_wbal_depletion: 0,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-07-01", "2026-07-30");
    expect(a.wBalDepletionJ).toBe(0);
    expect(a.wPrimeRollingJ).toBeNull();
  });

  it("nulls both W′ fields on an older activity that predates the power model", async () => {
    const raw = [{
      id: "w3", start_date_local: "2026-02-01T08:00:00", type: "Ride", name: "No power model",
      moving_time: 3600, icu_average_watts: 170,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-02-01", "2026-02-01");
    expect(a.wPrimeRollingJ).toBeNull();
    expect(a.wBalDepletionJ).toBeNull();
  });

  it("maps HRRc off the real nested shape (icu_hrr.hrr), live-verified against a real sync", async () => {
    // Real shape from intervals.icu: icu_hrr is an OBJECT, not a flat number — the bpm-drop value is
    // nested at icu_hrr.hrr. (icu_hrrc, the plan's original guess, does not exist in the real payload.)
    const raw = [{
      id: "h1", start_date_local: "2026-06-15T08:00:00", type: "Ride", name: "Threshold — Over-Unders",
      moving_time: 3600, icu_average_watts: 220, icu_weighted_avg_watts: 230,
      icu_hrr: {
        start_index: 3851, end_index: 3911, start_time: 4295, end_time: 4355,
        start_bpm: 181, end_bpm: 120, average_watts: null, hrr: 28,
      },
      average_heartrate: 155, max_heartrate: 178,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.hrrc).toBe(28);
  });

  it("falls back to the flat icu_hrrc key when icu_hrr is absent (dead-fallback safety net)", async () => {
    const raw = [{
      id: "h2", start_date_local: "2026-06-16T08:00:00", type: "Ride", name: "VO2max reps",
      moving_time: 2700, icu_average_watts: 210, icu_weighted_avg_watts: 240,
      icu_hrrc: 24, average_heartrate: 160, max_heartrate: 182,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.hrrc).toBe(24);
  });

  it("is null when icu_hrr is null (real shape for an easy ride with no qualifying hard effort)", async () => {
    const raw = [{
      id: "h3", start_date_local: "2026-06-17T08:00:00", type: "Ride", name: "MyWhoosh - Z2",
      moving_time: 5400, icu_average_watts: 160, icu_weighted_avg_watts: 165,
      icu_hrr: null, average_heartrate: 128, max_heartrate: 140,
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-06-01", "2026-06-23");
    expect(a.hrrc).toBeNull();
  });
});

describe("zoneSecs — overlapping-bucket rejection (NV-9)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.INTERVALS_API_KEY = "test-key";
    process.env.INTERVALS_ATHLETE_ID = "i1";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.INTERVALS_API_KEY;
    delete process.env.INTERVALS_ATHLETE_ID;
  });

  it("drops a trailing overlapping bucket whose own seconds double-count a prior zone (live-confirmed 2026-08-15)", async () => {
    // Live payload: an athlete-defined "Sweet Spot" range appended as an 8th element. Its first 7
    // elements alone sum to the ride's moving_time (5689s); the 8th (1518s) adds another ~25 minutes
    // of double-counted zone time on top.
    const raw = [{
      id: "s1", start_date_local: "2026-08-15T08:00:00", type: "Ride", name: "Cycling",
      moving_time: 5689, icu_average_watts: 224,
      icu_power_zone_times: [551, 1504, 2410, 906, 249, 51, 19, 1518],
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-08-01", "2026-08-15");
    expect(a.powerZoneTimes).toEqual([551, 1504, 2410, 906, 249, 51, 19]);
  });

  it("passes through a well-formed exclusive array unchanged (no false positive on the common case)", async () => {
    const raw = [{
      id: "s2", start_date_local: "2026-08-14T08:00:00", type: "Ride", name: "Cycling",
      moving_time: 7577, icu_average_watts: 210,
      icu_power_zone_times: [2059, 1870, 1781, 1234, 389, 212, 32],
      icu_hr_zone_times: [4177, 2406, 618, 376, 0, 0, 0],
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-08-01", "2026-08-14");
    expect(a.powerZoneTimes).toEqual([2059, 1870, 1781, 1234, 389, 212, 32]);
    expect(a.hrZoneTimes).toEqual([4177, 2406, 618, 376, 0, 0, 0]);
  });

  it("returns null (no evidence) rather than a wrong reading when no prefix reproduces moving time", async () => {
    // No possible prefix sums anywhere near 3600s — a genuinely untrustworthy/corrupt shape.
    const raw = [{
      id: "s3", start_date_local: "2026-08-10T08:00:00", type: "Ride", name: "Corrupt",
      moving_time: 3600, icu_average_watts: 200,
      icu_power_zone_times: [50, 60, 70],
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;
    const [a] = await fetchActivities("2026-08-01", "2026-08-10");
    expect(a.powerZoneTimes).toBeNull();
  });
});

describe("fetchWellness — subjective self-report mapping", () => {
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

  const wellnessResponse = (raw: unknown) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;

  it("maps the objective wellness fields the load model uses (weight/CTL/ATL/sleep/kcal)", async () => {
    globalThis.fetch = wellnessResponse([
      { id: "2026-06-24", weight: 62.2, ctl: 50, atl: 55, sleepSecs: 27000, sleepQuality: 3, kcalConsumed: 2600 },
    ]);
    const [w] = await fetchWellness("2026-06-01", "2026-06-24");
    expect(w).toMatchObject({ weightKg: 62.2, ctl: 50, atl: 55, sleepHours: 7.5, sleepQuality: 3, kcalConsumed: 2600 });
  });

  it("leaves an unlogged objective field null (athlete logged only weight)", async () => {
    globalThis.fetch = wellnessResponse([{ id: "2026-06-24", weight: 62.2 }]);
    const [w] = await fetchWellness("2026-06-01", "2026-06-24");
    expect(w.ctl).toBeNull();
    expect(w.kcalConsumed).toBeNull();
    expect(w.weightKg).toBe(62.2);
  });
});
