// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppState } from "../SyncProvider";
import type { CurrentBlock, GeneratedPlan, PlanFindings } from "@/lib/types";

// PlanView pulls in a lot of siblings (BlockGenerator, SeasonRoadmap, SeasonSection,
// RescheduleBanner, PlanPreview) that each have their own data needs — stubbed out here so this test
// stays focused on deleteBlock's own behavior (HR-56), exercised through the real CurrentBlockSection
// (./plan) delete-confirm flow, not a re-implementation of it.
const h = vi.hoisted(() => ({ api: vi.fn(), useSync: vi.fn() }));

vi.mock("@/lib/client-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/client-api")>();
  return { ...actual, api: h.api };
});
vi.mock("../SyncProvider", () => ({ useSync: h.useSync }));
vi.mock("../RescheduleBanner", () => ({ default: () => null }));
vi.mock("../SeasonRoadmap", () => ({ default: () => null }));
vi.mock("../SeasonSection", () => ({ default: () => null }));
// Stubbed with working controls (not nulled) so the publication-gate tests can drive the generate
// flow; the HR-56/retro suites don't touch these names.
vi.mock("./BlockGenerator", () => ({
  default: ({
    goal,
    setGoal,
    generate,
  }: {
    goal: string;
    setGoal: (v: string) => void;
    generate: () => void;
  }) => (
    <div>
      <label htmlFor="goal">Block goal</label>
      <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <button onClick={generate}>Generate New Block</button>
    </div>
  ),
}));

// PlanPreview is stubbed with passthrough controls rather than nulled: the write flow (payload
// assertions, 422 handling) is driven through onWrite/onOverrideAcknowledgedChange, and writeError
// must be observable somewhere — the real component renders it, so the stub does too.
vi.mock("../PlanPreview", () => ({
  default: ({
    onWrite,
    writeError,
    overrideAcknowledged,
    onOverrideAcknowledgedChange,
  }: {
    onWrite: () => void;
    writeError: string | null;
    overrideAcknowledged: boolean;
    onOverrideAcknowledgedChange: (v: boolean) => void;
  }) => (
    <div>
      <button onClick={onWrite}>write-stub</button>
      <button onClick={() => onOverrideAcknowledgedChange(!overrideAcknowledged)}>ack-stub</button>
      {overrideAcknowledged ? <p>ack-on</p> : null}
      {writeError ? (
        <p role="alert">{writeError}</p>
      ) : null}
    </div>
  ),
}));

import PlanView from "./PlanView";

// Safely in the future relative to the sandbox's real system clock so RetroSection's own
// "block ended" prompt never fires and adds noise to this test.
const block = (): CurrentBlock => ({
  goal: "Raise threshold",
  lengthWeeks: 2,
  startDate: "2026-08-01",
  endDate: "2026-08-14",
  overview: "",
  createdAt: "2026-08-01T00:00:00Z",
  days: [{ date: "2026-08-01", name: "Threshold", type: "Threshold", durationMin: 60 }],
});

const mkState = (currentBlock: CurrentBlock | null, overrides: Partial<AppState> = {}): AppState =>
  ({
    configured: true,
    anthropicConfigured: false,
    lastSync: null,
    currentBlock,
    todayAnalysis: null,
    todayOutcome: null,
    readiness: null,
    fatigueAlert: null,
    loadRamp: null,
    acwr: null,
    noBlockSummary: null,
    polarization: null,
    scores: [],
    compromisedDates: [],
    partialDates: [],
    completedDates: [],
    autoSyncOnOpen: true,
    ...overrides,
  }) as AppState;

const setState = vi.fn();
function mockSync(currentBlock: CurrentBlock | null, overrides: Partial<AppState> = {}) {
  h.useSync.mockReturnValue({
    state: mkState(currentBlock, overrides),
    setState,
    loadError: null,
    syncing: false,
    syncError: null,
    analyzing: false,
    syncWarnings: [],
    doSync: vi.fn(),
    reAnalyse: vi.fn(),
  });
}

const renderPlanView = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanView />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PlanView — HR-56 (deleteBlock surfaces the response and reloads history)", () => {
  it("surfaces a partially-failed calendar cleanup and reloads block history after Delete", async () => {
    mockSync(block());
    let historyCalls = 0;
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/history") {
        historyCalls++;
        return [];
      }
      if (url === "/api/profile") return { athleteMd: {}, goals: [], weakpoints: [] };
      if (typeof url === "string" && url.startsWith("/api/season")) {
        return { plan: { objective: "", events: [], periods: [], updatedAt: "" }, outlook: null };
      }
      if (typeof url === "string" && url.startsWith("/api/sync") && init?.method === "DELETE") {
        return { eventsRemoved: 1, eventsFailed: [999] };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    renderPlanView();
    await waitFor(() => expect(screen.getByLabelText("Block actions")).toBeTruthy());
    expect(historyCalls).toBe(1); // the initial mount load

    fireEvent.click(screen.getByLabelText("Block actions"));
    fireEvent.click(await screen.findByText("Delete block…"));
    fireEvent.click(await screen.findByText("Yes, delete"));

    // HR-56: eventsFailed reaches the UI instead of being discarded.
    await waitFor(() => expect(screen.getByText(/1 calendar event/i)).toBeTruthy());
    // HR-56: block history reloads without an unrelated page refresh.
    await waitFor(() => expect(historyCalls).toBe(2));
  });

  it("shows no partial-cleanup notice when every calendar event was removed cleanly", async () => {
    mockSync(block());
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/history") return [];
      if (url === "/api/profile") return { athleteMd: {}, goals: [], weakpoints: [] };
      if (typeof url === "string" && url.startsWith("/api/season")) {
        return { plan: { objective: "", events: [], periods: [], updatedAt: "" }, outlook: null };
      }
      if (typeof url === "string" && url.startsWith("/api/sync") && init?.method === "DELETE") {
        return { eventsRemoved: 1, eventsFailed: [] };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    renderPlanView();
    await waitFor(() => expect(screen.getByLabelText("Block actions")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Block actions"));
    fireEvent.click(await screen.findByText("Delete block…"));
    fireEvent.click(await screen.findByText("Yes, delete"));

    await waitFor(() => expect(setState).toHaveBeenCalled());
    expect(screen.queryByText(/calendar event/i)).toBeNull();
  });
});

describe("Phase 1 — explicit early-end closeout", () => {
  // Route the api mock per-endpoint: mount fires /api/history + /api/profile + /api/season alongside
  // whatever the test itself triggers, so a blanket mockResolvedValue would feed the retro payload to
  // those too (season.ts's derivations read plan.periods and would throw mid-render).
  const routeApi = (retroResponse: unknown) => {
    h.api.mockImplementation(async (url: string) => {
      if (url === "/api/retrospective") return retroResponse;
      if (url === "/api/history") return [];
      if (url === "/api/profile") return { athleteMd: {}, goals: [], weakpoints: [] };
      if (typeof url === "string" && url.startsWith("/api/season")) {
        return { plan: { objective: "", events: [], periods: [], updatedAt: "" }, outlook: null };
      }
      throw new Error(`unexpected api call: ${url}`);
    });
  };

  const sentRetroBody = (): Record<string, unknown> => {
    const call = h.api.mock.calls.find(([u]) => u === "/api/retrospective");
    expect(call).toBeTruthy();
    return JSON.parse(call![1].body as string);
  };

  const active = (): CurrentBlock => ({ ...block(), endDate: "2099-01-07", startDate: "2098-12-27", createdAt: "2098-12-26T00:00:00Z" });

  it("requires a reason before Confirm fires, then posts endedEarly + endReason", async () => {
    mockSync(active());
    routeApi({ retrospective: "done", narrativeDegraded: false, seeds: [], complianceByType: {}, fileId: "x" });
    renderPlanView();

    fireEvent.click(await screen.findByRole("button", { name: /end block early/i }));

    const confirm = screen.getByRole("button", { name: /^confirm early end$/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // disabled while the reason is empty
    fireEvent.change(screen.getByLabelText(/why is it ending early/i), { target: { value: "Race prep pivot" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(h.api).toHaveBeenCalledWith(
      "/api/retrospective",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"endedEarly":true'),
      })
    ));
    expect(sentRetroBody()).toMatchObject({ endedEarly: true, endReason: "Race prep pivot" });
  });

  it("a FINISHED block wraps up without any early-end fields", async () => {
    mockSync({ ...block(), endDate: "2020-01-01", startDate: "2019-12-18", createdAt: "2019-12-17T00:00:00Z" });
    routeApi({ retrospective: "done", narrativeDegraded: false, seeds: [], complianceByType: {}, fileId: "x" });
    renderPlanView();

    fireEvent.click(await screen.findByRole("button", { name: /wrap up block/i }));
    await waitFor(() => expect(h.api.mock.calls.some(([u]) => u === "/api/retrospective")).toBe(true));
    const sent = sentRetroBody();
    expect(sent.endedEarly).toBeUndefined();
    expect(sent.endReason).toBeUndefined();
  });

  it("renders the degraded fallback copy when the closeout came back narrative-less", async () => {
    mockSync({ ...block(), endDate: "2020-01-01", startDate: "2019-12-18", createdAt: "2019-12-17T00:00:00Z" });
    routeApi({ retrospective: null, narrativeDegraded: true, seeds: ["s"], complianceByType: {}, fileId: "x" });
    renderPlanView();
    fireEvent.click(await screen.findByRole("button", { name: /wrap up block/i }));
    expect(await screen.findByText(/closed deterministically/i)).toBeTruthy();
  });
});

describe("publication-gate UI — override acknowledgment rides in the write POST and resets on regenerate", () => {
  const gatePlan = (findings?: PlanFindings): GeneratedPlan => ({
    overview: "Test block.",
    days: [{
      date: "2099-06-03", weekNumber: 1, weekTheme: "Build", name: "Z2", type: "Z2",
      durationMin: 60, workoutText: "", description: "",
    }],
    warnings: [],
    raw: "",
    blockParams: { lengthWeeks: 4, goal: "Raise threshold", startDate: "2099-06-03", weakpoints: [] },
    ...(findings ? { findings } : {}),
  });

  // The real api() helper turns a non-ok `{ error }` body into a thrown Error carrying the server's
  // message — the mock must reproduce exactly that shape for the 422 paths.
  const routeGateApi = (
    plan: GeneratedPlan,
    writeImpl: () => unknown
  ) => {
    h.api.mockImplementation(async (url: string) => {
      if (url === "/api/generate") return { plan };
      if (url === "/api/write") return await writeImpl();
      if (url === "/api/history") return [];
      if (url === "/api/profile") return { athleteMd: {}, goals: [], weakpoints: [] };
      if (typeof url === "string" && url.startsWith("/api/season")) {
        return { plan: { objective: "", events: [], periods: [], updatedAt: "" }, outlook: null };
      }
      throw new Error(`unexpected api call: ${url}`);
    });
  };

  const sentWriteBody = (): Record<string, unknown> => {
    const call = h.api.mock.calls.find(([u]) => u === "/api/write");
    expect(call).toBeTruthy();
    return JSON.parse(call![1].body as string);
  };

  // Generate a plan so the (stubbed) PlanPreview — and with it the write/ack controls — mounts.
  const generateFirst = async (plan: GeneratedPlan, writeImpl: () => unknown) => {
    mockSync(null);
    routeGateApi(plan, writeImpl);
    renderPlanView();
    fireEvent.change(screen.getByLabelText(/block goal/i), { target: { value: "Raise threshold" } });
    fireEvent.click(screen.getByRole("button", { name: /generate new block/i }));
    await screen.findByRole("button", { name: "write-stub" });
  };

  it("sends overrideAcknowledged:false by default; an unchecked-preferences 422 surfaces its readable message", async () => {
    await generateFirst(
      gatePlan({ blockers: [], preferences: ["GOAL: terrain-driven goal but no RaceSim session."] }),
      () => {
        // Server-side refusal mirrors /api/write's real 422 overrideRequired body.
        throw new Error("This plan carries coaching concerns that need your explicit acknowledgment before publishing.");
      }
    );

    fireEvent.click(screen.getByRole("button", { name: "write-stub" }));
    const body = sentWriteBody();
    expect(body.overrideAcknowledged).toBe(false);
    expect(body.plan).toMatchObject({ overview: "Test block." });

    // The 422's message reaches the user next to the Write control instead of vanishing.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/coaching concerns that need your explicit acknowledgment/i);
  });

  it("after checking the acknowledgment the flag is sent true and a clean write succeeds", async () => {
    await generateFirst(
      gatePlan({ blockers: [], preferences: ["GOAL: terrain-driven goal but no RaceSim session."] }),
      () => ({ results: [{ date: "2099-06-03", name: "Z2", ok: true, eventId: 7 }], currentBlock: block() })
    );

    fireEvent.click(await screen.findByRole("button", { name: "ack-stub" }));
    expect(screen.getByText("ack-on")).toBeTruthy(); // stub proves PlanView flipped its own state
    fireEvent.click(screen.getByRole("button", { name: "write-stub" }));

    expect(sentWriteBody().overrideAcknowledged).toBe(true);
    await waitFor(() => expect(setState).toHaveBeenCalled()); // currentBlock adopted
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resets the acknowledgment when a plan is regenerated — a stale 'publish anyway' never applies to new output", async () => {
    await generateFirst(
      gatePlan({ blockers: [], preferences: ["GOAL: …"] }),
      () => ({ results: [{ date: "2099-06-03", name: "Z2", ok: true, eventId: 7 }], currentBlock: null })
    );
    fireEvent.click(screen.getByRole("button", { name: "ack-stub" }));

    // Regenerate: the same controls come back for the NEW plan.
    fireEvent.click(screen.getByRole("button", { name: /generate new block/i }));
    await screen.findByRole("button", { name: "write-stub" });
    expect(screen.queryByText("ack-on")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "write-stub" }));
    expect(sentWriteBody().overrideAcknowledged).toBe(false);
  });
});
