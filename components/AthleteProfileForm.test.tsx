// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AthleteProfileForm from "./AthleteProfileForm";
import type { PhysiologyFreshness } from "@/lib/types";

const h = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/client-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/client-api")>();
  return { ...actual, api: h.api };
});
vi.mock("./PowerCurveChart", () => ({ default: () => null }));
vi.mock("./IfBandOffsets", () => ({ default: () => null }));

function profileResponse(freshness: PhysiologyFreshness) {
  return {
    nutrition: {
      baseCalories: 2200,
      restDayTarget: 2400,
      buffer: 0,
      targetWeightKg: 75,
      targetRateKgPerWeek: null,
    },
    nutritionModel: {
      kind: "legacy",
      baseCalories: 2200,
      restDayTarget: 2400,
      weightKg: 75,
      targetWeightKg: 75,
      buffer: 0,
    },
    performance: { dateOfBirth: null, heightCm: null, sex: null },
    ftpStaleDays: null,
    physiologyFreshness: freshness,
    physiologyChange: null,
    physiologySource: "intervals",
    athleteMd: {
      performanceData: {},
      trainingZones: [],
      powerProfile: [],
    },
    autoSync: {
      syncedAt: null,
      latestWeightKg: null,
      latestWeightDate: null,
      weightTrend7Day: null,
      avgRpe7Day: null,
      lastKcalConsumed: null,
      lastKcalDate: null,
    },
    bufferStatus: {
      mode: "goal-rate",
      goalSurplusKcal: 0,
      servoDeltaKcal: 0,
      bufferApplied: 0,
      stepClipped: false,
      capped: false,
      reason: "holding steady",
    },
    derivation: {
      rmr: null,
      neat: {
        multiplier: 1.5,
        source: "default",
        confidence: "low",
        dataPoints: 0,
        lastUpdated: "2026-08-24T00:00:00.000Z",
        locked: false,
        manualOverride: null,
        windowDays: null,
        loggedDays: null,
        weighIns: null,
        imbalance: null,
      },
      neatStale: false,
      dayTypeNeat: null,
      isRestDayToday: true,
      dayTypeSplitTrusted: false,
      maintenanceKcal: null,
      todayPlan: null,
      todayActiveBurnKcal: 0,
      smoothedWeightKg: null,
      rawLatestWeightKg: null,
      targetWeightKg: 75,
      trendShortKgPerWeek: null,
      trendLongKgPerWeek: null,
      desiredTrendKgPerWeek: 0,
      buffer: {
        mode: "goal-rate",
        goalSurplusKcal: 0,
        servoDeltaKcal: 0,
        bufferApplied: 0,
        stepClipped: false,
        capped: false,
        reason: "holding steady",
      },
    },
    syncedPowerCurve: [],
    powerProfile: null,
    latestWeightKg: null,
    weightHistory: [],
    goals: [],
    weakpoints: [],
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AthleteProfileForm physiology freshness panel", () => {
  it("renders the freshness text and wires mark/clear actions through /api/physiology with a profile refetch", async () => {
    let getCalls = 0;
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/profile" && init === undefined) {
        getCalls += 1;
        if (getCalls === 1) {
          return profileResponse({
            state: "stale",
            lastConfirmedAt: "2026-08-20T09:15:00.000Z",
            ageDays: 4,
          });
        }
        if (getCalls === 2) {
          return profileResponse({
            state: "obsolete",
            markedObsoleteAt: "2026-08-24T09:15:00.000Z",
          });
        }
        return profileResponse({
          state: "fresh",
          confirmedAt: "2026-08-24T09:15:00.000Z",
          effectiveFrom: "2026-08-24",
        });
      }
      if (url === "/api/physiology" && init?.method === "POST") {
        return { ok: true };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    render(<AthleteProfileForm ifBandRows={[]} />);

    expect(
      await screen.findByText("Physiology last confirmed 2026-08-20 — 4 days ago. Re-sync or re-test.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark obsolete" }));

    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith("/api/physiology", {
        method: "POST",
        body: JSON.stringify({ action: "mark-obsolete" }),
      })
    );
    expect(
      await screen.findByText("Physiology marked obsolete 2026-08-24 — generation blocked until re-synced.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith("/api/physiology", {
        method: "POST",
        body: JSON.stringify({ action: "clear-obsolete" }),
      })
    );
    expect(await screen.findByText("Physiology confirmed 2026-08-24 — current.")).toBeTruthy();
    expect(getCalls).toBe(3);
  });
});
