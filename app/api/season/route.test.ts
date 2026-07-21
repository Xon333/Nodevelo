import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/season (destructive-route sweep, extends SUB-3). The risk this guards: PUT is the
// athlete-owned save path (objective/events), but `periods` are engine-drafted by the generator — a PUT
// that rebuilds the plan from the body instead of merging onto `current` would silently wipe them.
vi.mock("@/lib/data-store", () => ({
  readSeasonPlan: vi.fn(),
  writeSeasonPlan: vi.fn(),
}));
// GET's roadmap-outlook projection (season-roadmap-preview §6) calls gatherFocusInputs — mocked here
// the way app/api/generate/route.test.ts mocks its other collaborators, since this file's data-store
// mock only stubs readSeasonPlan/writeSeasonPlan, not the fuller read* set gatherFocusInputs needs.
vi.mock("@/lib/season-signals", () => ({
  gatherFocusInputs: vi.fn(async () => ({ limiter: { system: null, confidence: "low" as const }, lastFocus: null, signals: {} })),
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
const get = (query = "") => GET(new Request(`http://x/api/season${query}`));

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
    const res = await get();
    const json = await res.json();
    expect(json.plan.objective).toBe("Century in September");
  });
});

// season-roadmap-preview §6: GET now also returns a stateless `outlook` projection alongside `plan`.
// It's null whenever there's a committed arc to show instead (an upcoming A-event) and, independent of
// that, gated behind SEASON_SHAPES_GENERATION — false as of this task (flips in a later task of this
// plan), so the rolling case is expected to assert null too, not a populated array, until then.
describe("GET /api/season — outlook", () => {
  it("returns a null outlook when there is an upcoming A-event (event mode keeps its committed arc)", async () => {
    stored = { ...base(), events: [{ name: "Gran Fondo", date: "2026-10-01", priority: "A" }] };
    const res = await get("?today=2026-07-01");
    const json = await res.json();
    expect(json.outlook).toBeNull();
  });

  it("returns a null outlook for the rolling case (no upcoming A-event) while SEASON_SHAPES_GENERATION is off", async () => {
    stored = { ...base(), events: [] };
    const res = await get("?today=2026-07-01");
    const json = await res.json();
    expect(json.outlook).toBeNull();
  });

  it("still returns plan unchanged (existing contract)", async () => {
    const res = await get("?today=2026-07-01");
    const json = await res.json();
    expect(json.plan.objective).toBe(base().objective);
  });
});
