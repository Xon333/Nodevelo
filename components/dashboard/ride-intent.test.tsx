/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RideIntentBlock } from "./ride-intent";
import type { EffectiveOutcome, IntentOverlay } from "@/lib/types";

const overlay = (over: Partial<IntentOverlay> = {}): IntentOverlay => ({
  id: "ov-1", activityId: "a1", date: "2026-08-11", noteFingerprint: "fp-1", status: "active",
  origin: "self-directed", effectiveExecutionScore: 8, notScoredReason: null,
  interpretation: {
    intent: {
      primaryPurpose: "mixed",
      phases: [
        { description: "45 min steady Z2", kind: "zone-time" },
        { description: "9 min around 292 W", kind: "effort" },
      ],
    },
    confidence: "high",
    objectives: [
      { description: "45 min Z2", kind: "zone-time", target: null, zoneBasis: "power", grounded: true, sourceText: "45 min Z2", measurable: true, scored: true, scopeMin: 45, evidence: "44 min in Z2" },
      { description: "descending practice", kind: "qualitative", target: null, zoneBasis: "unspecified", grounded: true, sourceText: "descending practice", measurable: false, scored: false, scopeMin: null, evidence: null },
    ],
    model: "claude-sonnet-4-6", promptVersion: 1,
  },
  scoringVersion: 1, schemaVersion: 1, createdAt: "2026-08-11T13:00:00.000Z",
  approvedAt: null, supersededBy: null, ...over,
});

const outcome = (over: Partial<EffectiveOutcome> = {}): EffectiveOutcome => ({
  effectiveExecutionScore: 8, origin: "self-directed", source: "overlay", overlay: overlay(), ...over,
});

afterEach(() => cleanup());

describe("RideIntentBlock", () => {
  it("renders nothing for a prescribed ride (no overlay)", () => {
    const { container } = render(
      <RideIntentBlock outcome={{ effectiveExecutionScore: 6, origin: "prescribed", source: "ledger", overlay: null }} activityDecoupling={null} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when there is no outcome at all", () => {
    const { container } = render(<RideIntentBlock outcome={null} activityDecoupling={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the intent-used line joining phases with an arrow", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText(/Intent used:/)).toBeTruthy();
    expect(screen.getByText(/45 min steady Z2 → 9 min around 292 W/)).toBeTruthy();
  });

  it("partitions objectives on measurable, not scored", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText(/44 min in Z2/)).toBeTruthy();
    expect(screen.getByText("descending practice")).toBeTruthy();
  });

  it("labels a qualitative objective explicitly, not just via italic styling", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText(/Acknowledged, not graded:/)).toBeTruthy();
    expect(screen.getByText("descending practice").closest("li")?.textContent).toBe("Acknowledged, not graded: descending practice");
  });

  it("shows the Not-scored message and suppresses any score when effectiveExecutionScore is null", () => {
    const notScored = outcome({
      effectiveExecutionScore: null,
      overlay: overlay({ effectiveExecutionScore: null, notScoredReason: "no-measurable-objectives" }),
    });
    render(<RideIntentBlock outcome={notScored} activityDecoupling={null} />);
    expect(screen.getByText("Not scored — nothing measurable to verify")).toBeTruthy();
  });

  it("does not render an intent-used line when interpretation is null (no-intent-found)", () => {
    const noIntent = outcome({
      effectiveExecutionScore: null,
      overlay: overlay({ effectiveExecutionScore: null, notScoredReason: "no-intent-found", interpretation: null }),
    });
    render(<RideIntentBlock outcome={noIntent} activityDecoupling={null} />);
    expect(screen.queryByText(/Intent used:/)).toBeNull();
    expect(screen.getByText("Not scored — no intent found")).toBeTruthy();
  });

  it("shows the medium-confidence caption alongside a real score", () => {
    const medium = outcome({ overlay: overlay({ interpretation: { ...overlay().interpretation!, confidence: "medium" } }) });
    render(<RideIntentBlock outcome={medium} activityDecoupling={null} />);
    expect(screen.getByText(/Limited basis/)).toBeTruthy();
  });

  it("shows the aerobic-drift-not-measurable line for a self-directed ride with no segment", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText("Aerobic drift not measurable — no sufficiently steady aerobic segment")).toBeTruthy();
  });

  it("does not show the aerobic-drift line when a decoupling value is present", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={3.8} />);
    expect(screen.queryByText(/Aerobic drift not measurable/)).toBeNull();
  });
});
