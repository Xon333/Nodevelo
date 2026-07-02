import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/season (destructive-route sweep, extends SUB-3). The risk this guards: PUT is the
// athlete-owned save path (objective/events), but `periods` are engine-drafted by the generator — a PUT
// that rebuilds the plan from the body instead of merging onto `current` would silently wipe them.
vi.mock("@/lib/data-store", () => ({
  readSeasonPlan: vi.fn(),
  writeSeasonPlan: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { GET, PUT } from "@/app/api/season/route";
import type { SeasonPlan } from "@/lib/types";

const base = (): SeasonPlan => ({
  objective: "Century in September",
  events: [{ name: "Fondo", date: "2026-09-01", priority: "A" }],
  periods: [
    {
      focus: "aerobic-base",
      phase: "base",
      startDate: "2026-01-01",
      plannedWeeks: 4,
      intensitySplit: "80/20",
      targetWeeklyTss: 300,
      deloadWeek: false,
      rationale: "KB",
      source: "derived",
      confidence: "medium",
    },
  ],
  updatedAt: "2026-01-01T00:00:00Z",
});

const readMock = () => store.readSeasonPlan as ReturnType<typeof vi.fn>;
const writeMock = () => store.writeSeasonPlan as ReturnType<typeof vi.fn>;
const put = (body: unknown) => PUT(new Request("http://x/api/season", { method: "PUT", body: JSON.stringify(body) }));

let stored: SeasonPlan;
beforeEach(() => {
  stored = base();
  vi.clearAllMocks();
  readMock().mockImplementation(async () => stored);
  writeMock().mockImplementation(async (plan: SeasonPlan) => {
    stored = plan;
  });
});

describe("PUT /api/season", () => {
  it("rejects a non-object body without writing", async () => {
    const res = await PUT(new Request("http://x/api/season", { method: "PUT", body: JSON.stringify(null) }));
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const res = await PUT(new Request("http://x/api/season", { method: "PUT", body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("rejects an event with a bad date or priority without writing", async () => {
    const res = await put({ objective: "x", events: [{ name: "Fondo", date: "not-a-date", priority: "A" }] });
    expect(res.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();

    const res2 = await put({ objective: "x", events: [{ name: "Fondo", date: "2026-09-01", priority: "Z" }] });
    expect(res2.status).toBe(400);
    expect(writeMock()).not.toHaveBeenCalled();
  });

  it("updates objective/events but preserves engine-drafted periods", async () => {
    const res = await put({ objective: "New goal", events: [] });
    const json = await res.json();
    expect(json.plan.objective).toBe("New goal");
    expect(json.plan.events).toEqual([]);
    expect(json.plan.periods).toEqual(base().periods); // untouched — not part of the PUT body
  });
});

describe("GET /api/season", () => {
  it("returns the stored plan", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.plan.objective).toBe("Century in September");
  });
});
