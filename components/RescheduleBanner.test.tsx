// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppState } from "./SyncProvider";

// RescheduleBanner's own useSync() + api() calls are mocked at the module boundary — this is a unit
// test of the component's OWN state machine (capture-at-fetch-time, reload-on-block-change), not an
// integration test of SyncProvider/react-query.
const h = vi.hoisted(() => ({
  api: vi.fn(),
  useSync: vi.fn(),
}));

vi.mock("@/lib/client-api", () => ({ api: h.api }));
vi.mock("./SyncProvider", () => ({ useSync: h.useSync }));

import RescheduleBanner from "./RescheduleBanner";

const mkState = (createdAt: string | null): AppState =>
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

const setState = vi.fn();
function mockSync(createdAt: string | null) {
  h.useSync.mockReturnValue({
    state: mkState(createdAt),
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

const suggestion = { from: "2026-06-18", fromName: "VO2 6x3", fromType: "VO2max", reason: "missed" as const, to: "2026-06-21" };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RescheduleBanner — HR-44 (capture createdAt at suggestion-fetch time)", () => {
  it("sends the createdAt captured when the suggestion was fetched, not a since-changed live state.currentBlock, when Apply is clicked before the reload completes", async () => {
    mockSync("createdAt-A");
    let secondLoadPending = false;
    h.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/reschedule?today=")) {
        // First call (mount, createdAt-A) resolves immediately; the reload triggered by the
        // createdAt change below is left pending — simulates the real, unavoidable window between
        // the block changing and this banner's own reload actually completing.
        if (!secondLoadPending) {
          return { suggestion, blockCreatedAt: "createdAt-A" };
        }
        return new Promise(() => {}); // never resolves within this test
      }
      if (url === "/api/reschedule" && init?.method === "POST") {
        return { ok: true, mirrored: [], mirrorFailed: [] };
      }
      throw new Error(`unexpected api call: ${url}`);
    });

    const { rerender } = render(<RescheduleBanner />);
    await waitFor(() => expect(screen.getByText("Apply")).toBeTruthy());

    // The block changed (a write/delete/retro landed) — state.currentBlock now points at a DIFFERENT
    // generation. This banner's own reload effect fires (see the next describe block) but its request
    // is the pending one from the mock above, so suggestionBlockCreatedAt is still "createdAt-A".
    secondLoadPending = true;
    mockSync("createdAt-B");
    rerender(<RescheduleBanner />);

    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      const postCall = h.api.mock.calls.find(([url, init]) => url === "/api/reschedule" && (init as RequestInit | undefined)?.method === "POST");
      expect(postCall).toBeDefined();
    });
    const postCall = h.api.mock.calls.find(([url, init]) => url === "/api/reschedule" && (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.expectedBlockCreatedAt).toBe("createdAt-A"); // captured — NOT the live "createdAt-B"
    expect(body.from).toBe(suggestion.from);
    expect(body.to).toBe(suggestion.to);
  });
});

describe("RescheduleBanner — HR-44 (reload suggestion when the block changes)", () => {
  it("re-fetches the suggestion when state.currentBlock.createdAt changes, and updates the captured value", async () => {
    mockSync("createdAt-A");
    h.api.mockResolvedValueOnce({ suggestion, blockCreatedAt: "createdAt-A" });
    const { rerender } = render(<RescheduleBanner />);
    await waitFor(() => expect(screen.getByText("Apply")).toBeTruthy());
    expect(h.api).toHaveBeenCalledTimes(1);

    // A new block (different createdAt) replaces the old one — a different suggestion (or none).
    h.api.mockResolvedValueOnce({ suggestion: null, blockCreatedAt: "createdAt-B" });
    mockSync("createdAt-B");
    rerender(<RescheduleBanner />);

    await waitFor(() => expect(h.api).toHaveBeenCalledTimes(2));
    // No suggestion for the new block → banner renders nothing (not stuck showing the old one).
    await waitFor(() => expect(screen.queryByText("Apply")).toBeNull());
  });

  it("does not re-fetch when re-rendered with the SAME createdAt (no spurious refetch loop)", async () => {
    mockSync("createdAt-A");
    h.api.mockResolvedValueOnce({ suggestion, blockCreatedAt: "createdAt-A" });
    const { rerender } = render(<RescheduleBanner />);
    await waitFor(() => expect(screen.getByText("Apply")).toBeTruthy());
    expect(h.api).toHaveBeenCalledTimes(1);

    mockSync("createdAt-A"); // same value, new object reference
    rerender(<RescheduleBanner />);
    await Promise.resolve();
    expect(h.api).toHaveBeenCalledTimes(1);
  });
});
