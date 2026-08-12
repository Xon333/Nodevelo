// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SyncProvider, useSync } from "./SyncProvider";
import type { AppState } from "./SyncProvider";

const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: h.api }));

// Minimal AppState fixture — only the fields the tests below actually inspect are meaningfully varied.
const mkAppState = (createdAt: string | null): AppState =>
  ({
    configured: true,
    anthropicConfigured: false,
    lastSync: null,
    currentBlock: createdAt
      ? { goal: "g", lengthWeeks: 1, startDate: "2026-06-15", endDate: "2026-06-21", overview: "", createdAt, days: [] }
      : null,
    todayAnalysis: null,
    readiness: null,
    fatigueAlert: null,
    loadRamp: null,
    acwr: null,
    polarization: null,
    scores: [],
    compromisedDates: [],
    partialDates: [],
    completedDates: [],
    autoSyncOnOpen: true,
  }) as AppState;

function Harness() {
  const { state, doSync, reAnalyse, syncing, analyzing } = useSync();
  return (
    <div>
      <div data-testid="createdAt">{state?.currentBlock?.createdAt ?? "none"}</div>
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
    expect(getCalls).toBe(2); // initial load + the post-sync invalidate refetch
  });
});

describe("SyncProvider — deferred intent parsing", () => {
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
