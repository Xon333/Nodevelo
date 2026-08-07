import { describe, expect, it } from "vitest";
import { indexOverlaysByActivity, indexOverlaysByDate, resolveAll, resolveEffectiveOutcome } from "./intent-overlay";
import type { IntentOverlay, NotScoredReason, RideScoreEntry } from "./types";

const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-06-15",
  executionScore: 5,
  plannedType: null,
  inferredType: "Z2",
  planned: false,
  legacy: false,
  compliancePct: null,
  intensityFactor: 0.7,
  ftpUsed: 288,
  durationMin: 90,
  tss: 80,
  ...over,
});

const overlay = (over: Partial<IntentOverlay> = {}): IntentOverlay => ({
  id: "ov-1",
  activityId: "a1",
  date: "2026-06-15",
  noteFingerprint: "fp-1",
  status: "active",
  origin: "self-directed",
  effectiveExecutionScore: 8,
  notScoredReason: null,
  interpretation: {
    intent: { primaryPurpose: "steady endurance", phases: [] },
    confidence: "high",
    objectives: [{ description: "45 min Z2", measurable: true, scored: true, evidence: "44 min in Z2" }],
    model: "claude-sonnet-4-6",
    promptVersion: 7,
  },
  scoringVersion: 1,
  schemaVersion: 1,
  createdAt: "2026-06-15T10:00:00.000Z",
  approvedAt: null,
  supersededBy: null,
  ...over,
});

const notScored = (reason: NotScoredReason, over: Partial<IntentOverlay> = {}): IntentOverlay =>
  overlay({
    effectiveExecutionScore: null,
    notScoredReason: reason,
    scoringVersion: null,
    origin: reason === "no-measurable-objectives" ? "self-directed" : "unspecified",
    interpretation: reason === "no-intent-found" ? null : overlay().interpretation,
    ...over,
  });

describe("resolveEffectiveOutcome — empty store is identity", () => {
  it("falls back to the ledger entry when no overlay exists", () => {
    const result = resolveEffectiveOutcome(entry({ executionScore: 6 }), new Map(), new Map());
    expect(result.effectiveExecutionScore).toBe(6);
    expect(result.source).toBe("ledger");
    expect(result.overlay).toBeNull();
  });

  it("derives origin from the entry when falling back", () => {
    expect(resolveEffectiveOutcome(entry({ planned: true }), new Map(), new Map()).origin).toBe("prescribed");
    expect(resolveEffectiveOutcome(entry({ planned: false }), new Map(), new Map()).origin).toBe("unspecified");
  });
});

describe("resolveEffectiveOutcome — status gating", () => {
  it("applies an active overlay", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1", executionScore: 3 }),
      indexOverlaysByActivity([overlay()]),
      new Map()
    );
    expect(result.effectiveExecutionScore).toBe(8);
    expect(result.origin).toBe("self-directed");
    expect(result.source).toBe("overlay");
  });

  it("ignores pending and disabled overlays", () => {
    for (const status of ["pending", "disabled"] as const) {
      const result = resolveEffectiveOutcome(
        entry({ activityId: "a1", executionScore: 3 }),
        indexOverlaysByActivity([overlay({ status })]),
        new Map()
      );
      expect(result.effectiveExecutionScore).toBe(3);
      expect(result.source).toBe("ledger");
    }
  });
});

describe("resolveEffectiveOutcome — matching rules", () => {
  it("matches by activityId", () => {
    const result = resolveEffectiveOutcome(entry({ activityId: "a1" }), indexOverlaysByActivity([overlay()]), new Map());
    expect(result.effectiveExecutionScore).toBe(8);
  });

  it("falls back to a date match only for a row with no activityId", () => {
    const byDate = indexOverlaysByDate([overlay({ effectiveExecutionScore: 7 })]);
    expect(resolveEffectiveOutcome(entry({ activityId: undefined }), new Map(), byDate).effectiveExecutionScore).toBe(7);
    expect(resolveEffectiveOutcome(entry({ activityId: "primary", executionScore: 2 }), new Map(), byDate).effectiveExecutionScore).toBe(2);
  });

  it("preserves an explicit Not scored outcome", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([notScored("intent-unreliable")]),
      new Map()
    );
    expect(result.effectiveExecutionScore).toBeNull();
    expect(result.overlay?.notScoredReason).toBe("intent-unreliable");
  });

  it("represents a missing note without AI or scorer provenance", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([notScored("no-intent-found")]),
      new Map()
    );
    expect(result.overlay?.interpretation).toBeNull();
    expect(result.overlay?.scoringVersion).toBeNull();
  });
});

describe("resolveEffectiveOutcome — prescribed precedence", () => {
  it("never displaces a planned ride with an overlay", () => {
    const result = resolveEffectiveOutcome(
      entry({ planned: true, activityId: "a1", executionScore: 6, compliancePct: 100 }),
      indexOverlaysByActivity([overlay({ effectiveExecutionScore: 9 })]),
      new Map()
    );
    expect(result.effectiveExecutionScore).toBe(6);
    expect(result.origin).toBe("prescribed");
    expect(result.source).toBe("ledger");
  });
});

describe("origin and score coherence", () => {
  it.each(["no-intent-found", "interpreter-failed", "intent-unreliable"] as const)(
    "rejects self-directed when the reason is %s",
    (reason) => {
      const result = resolveEffectiveOutcome(
        entry({ activityId: "a1" }),
        indexOverlaysByActivity([notScored(reason, { origin: "self-directed" })]),
        new Map()
      );
      expect(result.source).toBe("ledger");
      expect(result.origin).toBe("unspecified");
    }
  );

  it("accepts self-directed when intent was clear but nothing was measurable", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([notScored("no-measurable-objectives")]),
      new Map()
    );
    expect(result.source).toBe("overlay");
    expect(result.origin).toBe("self-directed");
    expect(result.effectiveExecutionScore).toBeNull();
  });

  it("rejects overlays whose score and reason disagree", () => {
    const invalid = [
      overlay({ effectiveExecutionScore: 8, notScoredReason: "intent-unreliable" }),
      overlay({ effectiveExecutionScore: null, notScoredReason: null }),
    ];
    for (const candidate of invalid) {
      expect(
        resolveEffectiveOutcome(entry({ activityId: "a1" }), indexOverlaysByActivity([candidate]), new Map()).source
      ).toBe("ledger");
    }
  });
});

describe("supersession lifecycle", () => {
  it("ignores a superseded overlay", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([overlay({ supersededBy: "ov-new" })]),
      new Map()
    );
    expect(result.source).toBe("ledger");
  });

  it("keeps the active overlay while a pending successor awaits approval", () => {
    const active = overlay({ id: "active", effectiveExecutionScore: 8, createdAt: "2026-06-15T10:00:00.000Z" });
    const pending = overlay({ id: "pending", status: "pending", createdAt: "2026-06-16T10:00:00.000Z" });
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([active, pending]),
      new Map()
    );
    expect(result.effectiveExecutionScore).toBe(8);
    expect(result.overlay?.id).toBe("active");
  });
});

describe("index helpers", () => {
  it("keep the newest applicable overlay independent of input order", () => {
    const older = overlay({ id: "old", createdAt: "2026-06-15T10:00:00.000Z" });
    const newer = overlay({ id: "new", createdAt: "2026-06-16T10:00:00.000Z" });
    expect(indexOverlaysByActivity([newer, older]).get("a1")?.id).toBe("new");
    expect(indexOverlaysByActivity([older, newer]).get("a1")?.id).toBe("new");
  });

  it("excludes missing keys and inapplicable overlays", () => {
    expect(indexOverlaysByActivity([overlay({ activityId: "" })]).size).toBe(0);
    expect(indexOverlaysByDate([overlay({ date: "" })]).size).toBe(0);
    expect(indexOverlaysByActivity([overlay({ status: "pending" })]).size).toBe(0);
    expect(indexOverlaysByActivity([overlay({ supersededBy: "next" })]).size).toBe(0);
  });
});

describe("resolveAll", () => {
  it("pairs every entry with its outcome and preserves order", () => {
    const entries = [entry({ date: "2026-06-14", activityId: "x" }), entry({ activityId: "a1" })];
    const resolved = resolveAll(entries, [overlay()]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].outcome.source).toBe("ledger");
    expect(resolved[1].outcome.source).toBe("overlay");
    expect(resolved[1].entry.date).toBe("2026-06-15");
  });

  it("is identity with an empty store", () => {
    const entries = [entry({ executionScore: 4 }), entry({ date: "2026-06-16", executionScore: 9, planned: true })];
    for (const resolved of resolveAll(entries, [])) {
      expect(resolved.outcome.effectiveExecutionScore).toBe(resolved.entry.executionScore);
      expect(resolved.outcome.source).toBe("ledger");
    }
  });
});
