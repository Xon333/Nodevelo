import { describe, expect, it, vi } from "vitest";
import { suggestSession } from "./session-suggestion";
import * as seasonSignals from "./season-signals";
import * as season from "./season";
import type { WeeklyEnvelope } from "./types";

const envelope: WeeklyEnvelope = {
  weekStart: "2026-08-10",
  role: "build",
  range: { min: 600, max: 700 },
  previousRange: null,
  reductionApplied: false,
  reductionReason: null,
  calculationVersion: 1,
  resolvedAt: "2026-08-10T06:00:00.000Z",
};

describe("suggestSession", () => {
  it("returns null when the readiness gate says Recover — never suggests pushing through fatigue", async () => {
    const result = await suggestSession(
      "2026-08-12",
      envelope,
      400,
      { level: "Recover", reason: "TSB -20 — accumulated fatigue" },
      { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).toBeNull();
  });

  it("passes today through to gatherFocusInputs — never lets its date fallback diverge from the client-supplied sync date", async () => {
    const spy = vi
      .spyOn(seasonSignals, "gatherFocusInputs")
      .mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({
      focus: "aerobic-base",
      rationale: "aerobic-base is neglected",
      scores: [],
    });
    await suggestSession(
      "2026-08-12",
      envelope,
      400,
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ today: "2026-08-12" }));
  });

  it("never forwards computeLoadRamp's reason text into the suggestion output", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({
      limiter: { system: null, confidence: "low" },
      lastFocus: null,
      signals: {},
    });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({
      focus: "aerobic-base",
      rationale: "aerobic-base is neglected",
      scores: [],
    });
    const result = await suggestSession(
      "2026-08-12",
      envelope,
      400,
      { level: "Build", reason: "TSB 5 — good conditions to train" },
      {
        triggered: true,
        level: "caution",
        thisWeekTss: 450,
        lastWeekTss: 380,
        changePct: 18,
        reason:
          "Load up 18% on the previous 7 days (450 vs 380 TSS) — above the ~10% progressive-overload guideline. Watch recovery.",
      },
      null
    );
    expect(result?.reason ?? "").not.toMatch(/injury/i);
    expect(result?.reason ?? "").not.toMatch(/risk/i);
  });

  it("maps the chosen focus to a concrete session shape with an IF²-based TSS estimate", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({
      limiter: { system: null, confidence: "low" },
      lastFocus: null,
      signals: {},
    });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({
      focus: "threshold",
      rationale: "threshold execution has been strong",
      scores: [],
    });
    const result = await suggestSession(
      "2026-08-12",
      envelope,
      400,
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.durationRangeMin[0]).toBeGreaterThan(0);
    expect(result!.expectedTssRange[0]).toBeGreaterThan(0);
  });

  it("above range: suggests a low-dose recovery session, never null, never calling the week a failure", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({
      limiter: { system: null, confidence: "low" },
      lastFocus: null,
      signals: {},
    });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({
      focus: "threshold",
      rationale: "threshold execution has been strong",
      scores: [],
    });
    const result = await suggestSession(
      "2026-08-12",
      envelope,
      750, // already exceeds envelope.range.max (700)
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 750, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.purpose.toLowerCase()).toMatch(/recovery|easy/);
    expect(result!.reason.toLowerCase()).not.toMatch(/failure|failed/);
  });

  it("below range: suggests normally — never a desperate catch-up framing", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({
      limiter: { system: null, confidence: "low" },
      lastFocus: null,
      signals: {},
    });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({
      focus: "aerobic-base",
      rationale: "aerobic-base is neglected",
      scores: [],
    });
    const result = await suggestSession(
      "2026-08-12",
      envelope,
      200, // well below range.min (600)
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 200, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.reason.toLowerCase()).not.toMatch(/catch.?up|behind|make up/);
  });
});
