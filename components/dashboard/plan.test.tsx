// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CurrentBlockSection, RetroSection } from "./plan";
import type { CurrentBlock } from "@/lib/types";

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
  });

  it("still renders the narrative when one exists", () => {
    render(<RetroSection block={null} generating={false} result={retroResult("Solid block overall.")} error={null} onGenerate={() => {}} />);
    expect(screen.getByText("Solid block overall.")).toBeTruthy();
  });
});
