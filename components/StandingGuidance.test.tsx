/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StandingGuidance from "./StandingGuidance";

vi.mock("./SyncProvider", () => ({
  useSync: () => ({
    state: { lastSync: null, coachAccuracy: { hitRatePct: 67, evaluated: 3, pending: 2 } },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, error: null, refetch: vi.fn() }),
}));

describe("StandingGuidance track-record wording", () => {
  it("states counts, never a percentage of rightness", () => {
    render(<StandingGuidance />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("3 evaluated");
    expect(text).toContain("2 pending");
    expect(text).not.toMatch(/% right|proved right|accuracy/i);
    expect(text).not.toContain("generator is handed");
  });
});
