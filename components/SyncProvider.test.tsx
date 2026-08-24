// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SYNC_QUERY_KEY, SyncProvider, useSync } from "./SyncProvider";
import type { AppState } from "./SyncProvider";

const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: h.api }));

// Minimal AppState fixture — only the fields the tests below actually inspect are meaningfully varied.
const mkAppState = (createdAt: string | null, over: Partial<AppState> = {}): AppState =>
  ({
    configured: true,
    anthropicConfigured: false,
    lastSync: null,
    currentBlock: createdAt
      ? { goal: "g", lengthWeeks: 1, startDate: "2026-06-15", endDate: "2026-06-21", overview: "", createdAt, days: [] }
      : null,
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
    ...over,
  }) as AppState;

function Harness() {
  const { state, doSync, reAnalyse, syncing, analyzing } = useSync();
  return (
    <div>
      <div data-testid="createdAt">{state?.currentBlock?.createdAt ?? "none"}</div>
      <div data-testid="freshness">{state?.physiologyFreshness?.state ?? "none"}</div>
      <button onClick={() => void doSync()} disabled={syncing}>
        sync
      </button>
      <button onClick={() => void reAnalyse()} disabled={analyzing}>
        analyse
      </button>
    </div>
  );
}

const renderHarness = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncProvider>
        <Harness />
      </SyncProvider>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("SyncProvider — HR-45 (doSync refreshes currentBlock)", () => {
  it("picks up a currentBlock changed server-side by the sync (inbound calendar reconcile) even though the POST response itself carries no currentBlock field", async () => {
    let getCalls = 0;
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/sync?today=")) {
        getCalls++;
        // First GET (initial query load): the old block. Second GET (post-invalidate refetch): a
        // DIFFERENT block, simulating sync's own inbound-move reconcile mutating it server-side.
        return mkAppState(getCalls === 1 ? "createdAt-OLD" : "createdAt-NEW");
      }
      if (url === "/api/sync" && init?.method === "POST") {
        // The real POST response shape: no currentBlock field at all.
        return {
          lastSync: { syncedAt: "now" },
          todayAnalysis: null,
          analysisPending: false,
          warnings: [],
          readiness: null,
          fatigueAlert: null,
          loadRamp: null,
          acwr: null,
          polarization: null,
          scores: [],
          compromisedDates: [],
          partialDates: [],
          completedDates: [],
          athleteState: null,
          coachSnapshot: null,
          calibration: null,
        };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    renderHarness();
    await waitFor(() => expect(screen.getByTestId("createdAt").textContent).toBe("createdAt-OLD"));

    fireEvent.click(screen.getByText("sync"));

    // Eventually reflects the block sync itself changed server-side — not left stale at "createdAt-OLD"
    // just because the POST response had no currentBlock field to merge.
    await waitFor(() => expect(screen.getByTestId("createdAt").textContent).toBe("createdAt-NEW"));
    expect(getCalls).toBe(3); // initial load + post-sync refetch + post-intent refetch
  });

  it("refreshes GET-only physiologyFreshness from the refetch instead of expecting the POST sync payload to carry it", async () => {
    let getCalls = 0;
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/sync?today=")) {
        getCalls++;
        return mkAppState(null, {
          physiologyFreshness: getCalls === 1
            ? { state: "stale", lastConfirmedAt: null, ageDays: null }
            : { state: "fresh", confirmedAt: "2026-06-22T09:15:00.000Z", effectiveFrom: "2026-06-22" },
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return {
          lastSync: { syncedAt: "now" },
          todayAnalysis: null,
          analysisPending: false,
          warnings: [],
          readiness: null,
          fatigueAlert: null,
          loadRamp: null,
          acwr: null,
          polarization: null,
          scores: [],
          compromisedDates: [],
          partialDates: [],
          completedDates: [],
          athleteState: null,
          coachSnapshot: null,
          calibration: null,
        };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    renderHarness();
    await waitFor(() => expect(screen.getByTestId("freshness").textContent).toBe("stale"));

    fireEvent.click(screen.getByText("sync"));

    await waitFor(() => expect(screen.getByTestId("freshness").textContent).toBe("fresh"));
    expect(getCalls).toBe(3);
  });
});

describe("SyncProvider — deferred intent parsing", () => {
  it("invalidates the sync query after the intent loop, so a newly-written overlay becomes visible without another manual sync", async () => {
    h.api.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/api/sync?today=")) return mkAppState(null);
      if (url === "/api/analyze") return { todayAnalysis: null, warnings: [] };
      if (url === "/api/intent") return { processed: 0, remaining: 0, stalled: false, failedIds: [], warnings: [] };
      throw new Error(`unexpected api call: ${url}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(
      <QueryClientProvider client={queryClient}>
        <SyncProvider><Harness /></SyncProvider>
      </QueryClientProvider>
    );
    await screen.findByText("analyse");
    fireEvent.click(screen.getByText("analyse"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: SYNC_QUERY_KEY }));
  });

  it("carries failed ids across bounded rounds without retrying them", async () => {
    const intentBodies: Array<{ force: boolean; skip: string[] }> = [];
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/sync?today=")) return mkAppState(null);
      if (url === "/api/analyze") return { todayAnalysis: null, warnings: [] };
      if (url === "/api/intent") {
        intentBodies.push(JSON.parse(String(init?.body)) as { force: boolean; skip: string[] });
        if (intentBodies.length === 1) return { processed: 2, remaining: 2, stalled: false, failedIds: ["a1"], warnings: [] };
        if (intentBodies.length === 2) return { processed: 1, remaining: 1, stalled: false, failedIds: ["a2"], warnings: [] };
        return { processed: 0, remaining: 2, stalled: true, failedIds: [], warnings: [] };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    renderHarness();
    await screen.findByText("analyse");
    fireEvent.click(screen.getByText("analyse"));

    await waitFor(() => expect(intentBodies).toHaveLength(3));
    expect(intentBodies.map((body) => body.skip)).toEqual([[], ["a1"], ["a1", "a2"]]);
    expect(intentBodies.every((body) => body.force)).toBe(true);
  });
});

// Task 6 (segment-aware intent scoring): the Today card holds the generic score while `analyzing`
// is true, so that flag MUST already be set by the time the fast-path sync render settles —
// otherwise a frame renders syncing=false AND analyzing=false with the fresh (un-overlaid) analysis,
// flashing a score the intent loop is about to override. Assert every committed render between POST
// sync completion and intent completion shows at least one of the two flags up.
describe("SyncProvider — intent-pending handoff", () => {
  it("never commits syncing=false AND analyzing=false between POST sync completing and /api/intent finishing", async () => {
    let releaseIntent: (() => void) | null = null;
    h.api.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/api/sync?today=")) return mkAppState(null);
      if (url === "/api/sync") {
        return {
          lastSync: { syncedAt: "now" },
          todayAnalysis: null,
          analysisPending: false,
          warnings: [],
          readiness: null,
          fatigueAlert: null,
          loadRamp: null,
          acwr: null,
          polarization: null,
          scores: [],
          compromisedDates: [],
          partialDates: [],
          completedDates: [],
        };
      }
      if (url === "/api/intent") {
        await new Promise<void>((resolve) => { releaseIntent = resolve; });
        return { processed: 0, remaining: 0, stalled: true, failedIds: [], warnings: [] };
      }
      if (url === "/api/analyze") return { todayAnalysis: null, warnings: [] };
      throw new Error(`unexpected api call: ${url}`);
    });

    const observed: Array<{ syncing: boolean; analyzing: boolean }> = [];
    function Probe() {
      const { syncing, analyzing } = useSync();
      useEffect(() => {
        observed.push({ syncing, analyzing });
      });
      return null;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SyncProvider>
          <Probe />
          <Harness />
        </SyncProvider>
      </QueryClientProvider>
    );
    await screen.findByText("sync");

    fireEvent.click(screen.getByText("sync"));
    // Hold /api/intent open so every render in the post-POST window is observable.
    await waitFor(() => expect(releaseIntent).not.toBeNull());
    // Let any interleaved renders/microtasks flush while the intent call is still pending.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    const firstBusyIndex = observed.findIndex((s) => s.syncing || s.analyzing);
    expect(firstBusyIndex).toBeGreaterThanOrEqual(0); // sanity: the busy window was actually observed

    // After release, wait for full settle so no late render escapes observation.
    releaseIntent!();
    await waitFor(() => expect(observed[observed.length - 1]).toEqual({ syncing: false, analyzing: false }));

    // Every committed state from the first busy one until the final settle must keep at least one
    // flag up. A {false,false} entry mid-window is exactly the flash this guards against.
    const busyWindow = observed.slice(firstBusyIndex, -1);
    const gaps = busyWindow.filter((s) => !s.syncing && !s.analyzing);
    expect(gaps).toEqual([]);
  });
});
