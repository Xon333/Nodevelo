import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockHistoryEntry } from "@/lib/types";

const h = vi.hoisted(() => ({
  readBlockHistory: vi.fn(),
  updateBlockHistory: vi.fn(),
  markRetroSeedsApproved: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({ readBlockHistory: h.readBlockHistory, updateBlockHistory: h.updateBlockHistory }));
// markRetroSeedsApproved is mocked (it touches disk); retroFileId stays REAL — filename derivation
// is the contract under test, so it must be exercised for its actual implementation.
vi.mock("@/lib/kb-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kb-loader")>()),
  markRetroSeedsApproved: h.markRetroSeedsApproved,
}));

import { POST } from "@/app/api/history/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/history", { method: "POST", body: JSON.stringify(body) }));

const entry = (): BlockHistoryEntry =>
  ({
    id: "b1", goal: "Build FTP", startDate: "2026-06-01", endDate: "2026-06-14",
    lengthWeeks: 2, overview: "", createdAt: "2026-06-01T00:00:00.000Z",
  }) as BlockHistoryEntry;

describe("POST /api/history — adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.markRetroSeedsApproved.mockResolvedValue(undefined);
    h.readBlockHistory.mockResolvedValue([entry()]);
    h.updateBlockHistory.mockImplementation(async (mutate: (e: BlockHistoryEntry[]) => BlockHistoryEntry[]) =>
      // Feed the mutate whatever readBlockHistory currently returns, so tests overriding
      // readBlockHistory (e.g. the already-adopted entry) flow through to the route's logic.
      mutate((await h.readBlockHistory()) as BlockHistoryEntry[])
    );
  });

  it("DERIVES the retro filename from the entry — the client sends only { id }", async () => {
    const res = await post({ id: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.markRetroSeedsApproved).toHaveBeenCalledWith("2026-06-01_build-ftp.md");
    expect(h.updateBlockHistory).toHaveBeenCalledTimes(1);
  });

  it("502s WITHOUT stamping when the markdown write fails — nothing partial persists", async () => {
    h.markRetroSeedsApproved.mockRejectedValueOnce(new Error("EACCES"));
    const res = await post({ id: "b1" });
    expect(res.status).toBe(502);
    expect(h.updateBlockHistory).not.toHaveBeenCalled(); // no orphaned reflectionsApprovedAt
  });

  it("a retry after that failure completes end-to-end", async () => {
    h.markRetroSeedsApproved.mockRejectedValueOnce(new Error("EACCES")); // attempt 1 dies on the flip
    expect((await post({ id: "b1" })).status).toBe(502);

    const res = await post({ id: "b1" });                                // attempt 2
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converges when a prior attempt flipped the file but failed before stamping", async () => {
    h.updateBlockHistory.mockRejectedValueOnce(new Error("lock poisoned")); // attempt 1: stamp dies AFTER flip
    expect((await post({ id: "b1" })).status).toBe(502);

    const res = await post({ id: "b1" });                                   // attempt 2: flip no-ops, stamp lands
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is idempotent once fully adopted — 200 with alreadyAdopted, never a 409 dead-end", async () => {
    h.readBlockHistory.mockResolvedValue([{ ...entry(), reflectionsApprovedAt: "2026-06-15T00:00:00.000Z" }]);
    const res = await post({ id: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyAdopted: true });
  });

  it("404s an unknown id before any write", async () => {
    h.readBlockHistory.mockResolvedValue([]);
    const res = await post({ id: "nope" });
    expect(res.status).toBe(404);
    expect(h.markRetroSeedsApproved).not.toHaveBeenCalled();
    expect(h.updateBlockHistory).not.toHaveBeenCalled();
  });

  it("400s a missing id", async () => {
    expect((await post({})).status).toBe(400);
  });
});
