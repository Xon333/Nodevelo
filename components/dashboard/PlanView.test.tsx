// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppState } from "../SyncProvider";
import type { CurrentBlock } from "@/lib/types";

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
vi.mock("../PlanPreview", () => ({ default: () => null }));
vi.mock("../RescheduleBanner", () => ({ default: () => null }));
vi.mock("../SeasonRoadmap", () => ({ default: () => null }));
vi.mock("../SeasonSection", () => ({ default: () => null }));
vi.mock("./BlockGenerator", () => ({ default: () => null }));

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

const mkState = (currentBlock: CurrentBlock | null): AppState =>
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
  }) as AppState;

const setState = vi.fn();
function mockSync(currentBlock: CurrentBlock | null) {
  h.useSync.mockReturnValue({
    state: mkState(currentBlock),
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
