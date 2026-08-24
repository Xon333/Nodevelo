import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhysiologyStatus } from "@/lib/types";

const physiologyIo = vi.hoisted(() => ({
  status: {} as PhysiologyStatus,
}));

vi.mock("@/lib/physiology-freshness", () => ({
  markPhysiologyObsolete: vi.fn(async () => {
    physiologyIo.status = {
      ...physiologyIo.status,
      markedObsoleteAt: "2026-08-24T12:00:00.000Z",
    };
  }),
  clearPhysiologyObsolete: vi.fn(async () => {
    const { markedObsoleteAt: _drop, ...rest } = physiologyIo.status;
    physiologyIo.status = rest;
  }),
  readPhysiologyStatus: vi.fn(async () => ({
    status: physiologyIo.status,
    corruptFallback: false,
    liveCorrupt: false,
  })),
}));

import {
  clearPhysiologyObsolete,
  markPhysiologyObsolete,
  readPhysiologyStatus,
} from "@/lib/physiology-freshness";
import { POST } from "@/app/api/physiology/route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/physiology", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  physiologyIo.status = {};
});

describe("POST /api/physiology", () => {
  it("marks physiology obsolete", async () => {
    const res = await post({ action: "mark-obsolete" });
    expect(res.status).toBe(200);
    expect(markPhysiologyObsolete).toHaveBeenCalledTimes(1);
    expect(clearPhysiologyObsolete).not.toHaveBeenCalled();

    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      status: { markedObsoleteAt: "2026-08-24T12:00:00.000Z" },
    });
    expect(readPhysiologyStatus).toHaveBeenCalledTimes(1);
  });

  it("clears the obsolete marker", async () => {
    physiologyIo.status = { markedObsoleteAt: "2026-08-23T12:00:00.000Z" };

    const res = await post({ action: "clear-obsolete" });
    expect(res.status).toBe(200);
    expect(clearPhysiologyObsolete).toHaveBeenCalledTimes(1);
    expect(markPhysiologyObsolete).not.toHaveBeenCalled();

    const json = await res.json();
    expect(json).toEqual({ ok: true, status: {} });
  });

  it("rejects an unknown action without touching the marker", async () => {
    const res = await post({ action: "nope" });
    expect(res.status).toBe(400);
    expect(markPhysiologyObsolete).not.toHaveBeenCalled();
    expect(clearPhysiologyObsolete).not.toHaveBeenCalled();
  });

  it("rejects a missing body action", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(markPhysiologyObsolete).not.toHaveBeenCalled();
    expect(clearPhysiologyObsolete).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const res = await POST(new Request("http://t/api/physiology", { method: "POST", body: "{ not json" }));
    expect(res.status).toBe(400);
    expect(markPhysiologyObsolete).not.toHaveBeenCalled();
    expect(clearPhysiologyObsolete).not.toHaveBeenCalled();
  });
});
