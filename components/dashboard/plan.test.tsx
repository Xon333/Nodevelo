// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BlockHistory, CurrentBlockSection, RetroSection } from "./plan";
import type { BlockHistoryEntry, CurrentBlock } from "@/lib/types";

// DayAction's own api()/useQueryClient() calls are mocked at the module boundary — this proves
// BlockCalendar/CurrentBlockSection's OWN reaction to DayAction's onMoved callback (HR-47), not
// DayAction's internals (which are exercised directly in DayAction.test.tsx) or SyncProvider/react-query.
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: h.api }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

// Far enough in the future to stay "eligible" (>= today) regardless of when this suite actually runs.
const DAY_DATE = "2099-01-01";

const block = (): CurrentBlock => ({
  goal: "Raise threshold",
  lengthWeeks: 1,
  startDate: DAY_DATE,
  endDate: "2099-01-07",
  overview: "",
  createdAt: "2098-12-01T00:00:00Z",
  days: [{ date: DAY_DATE, name: "Threshold Test", type: "Threshold", durationMin: 60 }],
});

const renderSection = () =>
  render(<CurrentBlockSection block={block()} scores={[]} compromisedDates={[]} partialDates={[]} completedDates={[]} />);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("CurrentBlockSection / BlockCalendar — HR-47 (mirror-failure note survives the popover)", () => {
  it("does NOT auto-close the day popover when the calendar mirror fails, so DayAction's failure note stays visible", async () => {
    h.api.mockResolvedValue({ ok: true, mirrorFailed: ["2099-01-03"] });
    renderSection();

    // Pin the day cell open (its accessible trigger is the "01" cell — day.date.slice(8)).
    fireEvent.click(screen.getByText("01"));
    fireEvent.click(await screen.findByText("Move…"));

    const dateInput = screen.getByLabelText(/Move .* to/);
    fireEvent.change(dateInput, { target: { value: "2099-01-03" } });
    fireEvent.click(screen.getByText("Move"));

    await waitFor(() => expect(screen.getByText(/Intervals\.icu update failed/)).toBeTruthy());
    // The popover (and DayAction inside it) must still be mounted — not wiped out the instant the
    // move applied, before the athlete had a chance to read the failure note.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("DOES auto-close the day popover when the calendar mirror succeeds cleanly", async () => {
    h.api.mockResolvedValue({ ok: true, mirrorFailed: [] });
    renderSection();

    fireEvent.click(screen.getByText("01"));
    fireEvent.click(await screen.findByText("Move…"));
    const dateInput = screen.getByLabelText(/Move .* to/);
    fireEvent.change(dateInput, { target: { value: "2099-01-03" } });
    fireEvent.click(screen.getByText("Move"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

const retroResult = (retrospective: string | null) => ({
  retrospective,
  narrativeDegraded: retrospective === null,
  seeds: ["Threshold executed well — evidence supports progressing Threshold load"],
  complianceByType: { Threshold: 95 },
  fileId: "2026-06-01_build-ftp",
});

describe("RetroSection — degraded (Claude-free) closeouts", () => {
  it("renders the deterministic fallback copy when retrospective is null", () => {
    render(<RetroSection block={null} generating={false} result={retroResult(null)} error={null} onGenerate={() => {}} />);
    expect(screen.getByText(/Closed deterministically/i)).toBeTruthy();
    expect(screen.getByText(/evidence supports progressing/i)).toBeTruthy();
    expect(screen.queryByText("AI-drafted narrative — optional enrichment; the evidence card above is deterministic")).toBeNull();
  });

  it("still renders the narrative when one exists", () => {
    render(<RetroSection block={null} generating={false} result={retroResult("Solid block overall.")} error={null} onGenerate={() => {}} />);
    expect(screen.getByText("AI-drafted narrative — optional enrichment; the evidence card above is deterministic")).toBeTruthy();
    expect(screen.getByText("Solid block overall.")).toBeTruthy();
  });
});

const histEntry = (over: Partial<BlockHistoryEntry>): BlockHistoryEntry =>
  ({
    id: "h1", goal: "Build FTP", startDate: "2026-06-01", endDate: "2026-06-14",
    lengthWeeks: 2, overview: "", createdAt: "2026-06-01T00:00:00.000Z", ...over,
  }) as BlockHistoryEntry;

const refl = [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }];

describe("BlockHistory — reflection adoption", () => {
  it("offers Review & adopt for unapproved reflections and posts the entry id", async () => {
    h.api.mockResolvedValue({ ok: true });
    render(<BlockHistory history={[histEntry({ structuredReflections: refl })]} />);
    fireEvent.click(await screen.findByRole("button", { name: /review & adopt/i }));
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith("/api/history", {
        method: "POST",
        body: JSON.stringify({ id: "h1" }), // filename derived server-side — client sends only the id
      })
    );
  });

  it("shows the adopted stamp and no button once approved", () => {
    render(<BlockHistory history={[histEntry({ structuredReflections: [{ ...refl[0], observation: "Private reflection body" }], reflectionsApprovedAt: "2026-06-15T00:00:00.000Z" })]} />);
    expect(screen.queryByRole("button", { name: /review & adopt/i })).toBeNull();
    expect(screen.getByText(/Adopted .* — these notes reach the next block/)).toBeTruthy();
    expect(screen.queryByText("Private reflection body")).toBeNull();
  });

  it("entries without reflections render no adoption control", () => {
    render(<BlockHistory history={[histEntry({})]} />);
    expect(screen.queryByRole("button", { name: /review & adopt/i })).toBeNull();
  });
});
