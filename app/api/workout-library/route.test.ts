import { beforeEach, describe, expect, it, vi } from "vitest";

// Route test for /api/workout-library (+ /api/workout-library/[id]) — the service/export layers are
// mocked (each has its own dedicated test suite from Tasks 2/3); this proves the routes parse input,
// call the right thin service functions, and map results/errors to the right HTTP status.
vi.mock("@/lib/data-store", () => ({
  readWorkoutLibrary: vi.fn(),
}));
vi.mock("@/lib/workout-library-service", () => ({
  promoteWorkoutManually: vi.fn(),
  setWorkoutLibraryStatus: vi.fn(),
}));
vi.mock("@/lib/workout-library-export", () => ({
  exportWorkoutLibraryEntry: vi.fn(),
}));

import { readWorkoutLibrary } from "@/lib/data-store";
import { promoteWorkoutManually, setWorkoutLibraryStatus } from "@/lib/workout-library-service";
import { exportWorkoutLibraryEntry } from "@/lib/workout-library-export";
import { GET, POST } from "@/app/api/workout-library/route";
import { PATCH } from "@/app/api/workout-library/[id]/route";
import type { WorkoutLibraryEntry } from "@/lib/types";

function entry(overrides: Partial<WorkoutLibraryEntry> = {}): WorkoutLibraryEntry {
  return {
    id: "abcd1234", workoutType: "Threshold", durationMin: 70, workoutText: "Warmup\n- 10m 60%",
    status: "active", promotedBy: "manual", evidence: [{ date: "2026-08-01", executionScore: 8 }],
    useCount: 0, recentUses: [], createdAt: "2026-08-01T00:00:00.000Z", promotedAt: "2026-08-01T00:00:00.000Z",
    intervalsExport: { status: "pending" },
    ...overrides,
  };
}

const post = (body: unknown) =>
  POST(new Request("http://t/api/workout-library", { method: "POST", body: JSON.stringify(body) }));
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://t/api/workout-library/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/workout-library", () => {
  it("returns all entries", async () => {
    vi.mocked(readWorkoutLibrary).mockResolvedValue({ entries: [entry()] });
    const json = await (await GET()).json();
    expect(json.entries).toEqual([entry()]);
  });
});

describe("POST /api/workout-library", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await POST(new Request("http://t/api/workout-library", { method: "POST", body: "{ not json" }));
    expect(res.status).toBe(400);
    expect(promoteWorkoutManually).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed date without calling the service", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ date: "08/01/2026" })).status).toBe(400);
    expect(promoteWorkoutManually).not.toHaveBeenCalled();
  });

  it("maps day-not-found to 404", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValue({ ok: false, reason: "day-not-found" });
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(404);
    expect(exportWorkoutLibraryEntry).not.toHaveBeenCalled();
  });

  it("maps not-completed (blocked disposition) to 400 with a concrete reason", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValue({ ok: false, reason: "not-completed" });
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/disposition/i);
  });

  it("maps a protocol-invalid rejection to 400", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValue({ ok: false, reason: "protocol-invalid" });
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/protocol/i);
  });

  it("maps unsupported-type and not-scored to 400 too", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValueOnce({ ok: false, reason: "unsupported-type" });
    expect((await post({ date: "2026-08-01" })).status).toBe(400);
    vi.mocked(promoteWorkoutManually).mockResolvedValueOnce({ ok: false, reason: "not-scored" });
    expect((await post({ date: "2026-08-01" })).status).toBe(400);
  });

  it("maps a local-store failure (thrown error) to 500", async () => {
    vi.mocked(promoteWorkoutManually).mockRejectedValue(new Error("workout-library.json: both the live file and its .bak are corrupt"));
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(500);
  });

  it("promotes successfully, exports the new entry, and returns the exported (post-export) state", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValue({ ok: true, entry: entry({ intervalsExport: { status: "pending" } }) });
    vi.mocked(exportWorkoutLibraryEntry).mockResolvedValue(entry({ intervalsExport: { status: "synced", workoutId: "555" } }));
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(200);
    const { entry: returned } = await res.json();
    expect(returned.intervalsExport).toEqual({ status: "synced", workoutId: "555" });
    expect(exportWorkoutLibraryEntry).toHaveBeenCalledWith("abcd1234");
  });

  it("returns the active local entry with failed export state when remote export fails — a locally-successful promotion is not an error", async () => {
    vi.mocked(promoteWorkoutManually).mockResolvedValue({ ok: true, entry: entry() });
    vi.mocked(exportWorkoutLibraryEntry).mockResolvedValue(entry({ intervalsExport: { status: "failed", error: "Intervals.icu request failed (500)" } }));
    const res = await post({ date: "2026-08-01" });
    expect(res.status).toBe(200);
    const { entry: returned } = await res.json();
    expect(returned.status).toBe("active");
    expect(returned.intervalsExport).toEqual({ status: "failed", error: "Intervals.icu request failed (500)" });
  });
});

describe("PATCH /api/workout-library/:id", () => {
  it("rejects an invalid JSON body", async () => {
    const res = await PATCH(new Request("http://t/api/workout-library/x", { method: "PATCH", body: "{ not json" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognized action", async () => {
    const res = await patch("abcd1234", { action: "delete" });
    expect(res.status).toBe(400);
    expect(setWorkoutLibraryStatus).not.toHaveBeenCalled();
  });

  it("retires an entry", async () => {
    vi.mocked(setWorkoutLibraryStatus).mockResolvedValue(entry({ status: "retired" }));
    const res = await patch("abcd1234", { action: "retire" });
    expect(res.status).toBe(200);
    expect(setWorkoutLibraryStatus).toHaveBeenCalledWith("abcd1234", "retired");
    expect((await res.json()).entry.status).toBe("retired");
  });

  it("restores an entry", async () => {
    vi.mocked(setWorkoutLibraryStatus).mockResolvedValue(entry({ status: "active" }));
    const res = await patch("abcd1234", { action: "restore" });
    expect(setWorkoutLibraryStatus).toHaveBeenCalledWith("abcd1234", "active");
    expect((await res.json()).entry.status).toBe("active");
  });

  it("retries export via exportWorkoutLibraryEntry, not setWorkoutLibraryStatus", async () => {
    vi.mocked(exportWorkoutLibraryEntry).mockResolvedValue(entry({ intervalsExport: { status: "synced", workoutId: "1" } }));
    const res = await patch("abcd1234", { action: "retry-export" });
    expect(exportWorkoutLibraryEntry).toHaveBeenCalledWith("abcd1234");
    expect(setWorkoutLibraryStatus).not.toHaveBeenCalled();
    expect((await res.json()).entry.intervalsExport).toEqual({ status: "synced", workoutId: "1" });
  });

  it("maps an unknown id to 404 for retire/restore/retry-export alike", async () => {
    vi.mocked(setWorkoutLibraryStatus).mockResolvedValue(null);
    expect((await patch("nonexistent", { action: "retire" })).status).toBe(404);
    vi.mocked(exportWorkoutLibraryEntry).mockResolvedValue(null);
    expect((await patch("nonexistent", { action: "retry-export" })).status).toBe(404);
  });

  it("maps a local-store failure to 500", async () => {
    vi.mocked(setWorkoutLibraryStatus).mockRejectedValue(new Error("workout-library.json corrupt"));
    expect((await patch("abcd1234", { action: "retire" })).status).toBe(500);
  });
});
