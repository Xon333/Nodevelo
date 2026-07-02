import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/calibration (destructive-route sweep, extends SUB-3). The override POST is the
// one write path onto a store the athlete-model reads for scoring, so the sane-band clamp is the
// property that matters most — same "disable-the-safety-cap" shape SET-1 guarded for BlockSettings.
vi.mock("@/lib/data-store", () => ({
  readCalibration: vi.fn(),
  updateCalibration: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { GET, POST } from "@/app/api/calibration/route";
import { DECOUPLING_GOOD_BOUNDS } from "@/lib/calibration";
import type { CalibrationStore } from "@/lib/types";

const base = (): CalibrationStore => ({
  decouplingGood: {
    value: 4,
    source: "derived",
    confidence: "medium",
    dataPoints: 10,
    lastUpdated: "2026-01-01T00:00:00Z",
    locked: false,
    manualOverride: null,
  },
  updatedAt: "2026-01-01T00:00:00Z",
});

const readMock = () => store.readCalibration as ReturnType<typeof vi.fn>;
const updateMock = () => store.updateCalibration as ReturnType<typeof vi.fn>;
const post = (body: unknown) => POST(new Request("http://x/api/calibration", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  // Mirror updateJson's real read-modify-write shape so the route's response reflects the mutate fn.
  updateMock().mockImplementation(async (mutate: (cur: CalibrationStore) => CalibrationStore) => mutate(base()));
});

describe("POST /api/calibration", () => {
  it("rejects an unknown parameter without touching the store", async () => {
    const res = await post({ param: "somethingElse", manualOverride: 5 });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("clamps a manualOverride above the sane band", async () => {
    const res = await post({ param: "decouplingGood", manualOverride: 100 });
    const json = await res.json();
    expect(json.calibration.decouplingGood.manualOverride).toBe(DECOUPLING_GOOD_BOUNDS.max);
  });

  it("clamps a manualOverride below the sane band", async () => {
    const res = await post({ param: "decouplingGood", manualOverride: -5 });
    const json = await res.json();
    expect(json.calibration.decouplingGood.manualOverride).toBe(DECOUPLING_GOOD_BOUNDS.min);
  });

  it("clears an existing override with null", async () => {
    const res = await post({ param: "decouplingGood", manualOverride: null });
    const json = await res.json();
    expect(json.calibration.decouplingGood.manualOverride).toBeNull();
  });

  it("rejects a non-numeric, non-null manualOverride", async () => {
    const res = await post({ param: "decouplingGood", manualOverride: "high" });
    expect(res.status).toBe(400);
    expect(updateMock()).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const res = await POST(new Request("http://x/api/calibration", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/calibration", () => {
  it("returns the stored calibration", async () => {
    readMock().mockResolvedValue(base());
    const res = await GET();
    const json = await res.json();
    expect(json.calibration.decouplingGood.value).toBe(4);
  });
});
