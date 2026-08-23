import { describe, expect, it } from "vitest";
import { INTENT_SCORING_VERSION, buildOverlay } from "./intent-scoring";
import {
  indexOverlaysByActivity,
  indexOverlaysByDate,
  isApplicable,
  resolveAll,
  resolveEffectiveOutcome,
} from "./intent-overlay";
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
    objectives: [{
      description: "45 min Z2",
      kind: "zone-time",
      target: { durationMin: 45, zone: "Z2" },
      zoneBasis: "power",
      grounded: true,
      sourceText: "45 min Z2",
      measurable: true,
      scored: true,
      scopeMin: 45,
      evidence: "44 min in Z2",
    }],
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

  it("rejects an overlay that asserts origin: prescribed — only the ledger's `planned` flag can establish that", () => {
    // A malformed overlay claiming `origin: "prescribed"` on an unplanned row would otherwise be admitted
    // into `buildAthleteModel`'s `prescribed` filter (keyed on `outcome.origin === "prescribed"`), reviving
    // per-type grouping on whole-ride-IF-derived type and hitting the `comps.length ? … : 0` compliance
    // fallback for a ride with no compliance concept at all.
    const badOverlay = overlay({ origin: "prescribed" });
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1", planned: false, executionScore: 4 }),
      indexOverlaysByActivity([badOverlay]),
      new Map()
    );
    expect(result.source).toBe("ledger");
    expect(result.origin).toBe("unspecified");
    expect(result.effectiveExecutionScore).toBe(4);
  });
});

describe("effectiveWorkoutType coherence", () => {
  it("accepts an authoritative type on a self-directed overlay", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([overlay({ effectiveWorkoutType: "Threshold" })]),
      new Map()
    );
    expect(result.source).toBe("overlay");
  });

  it("rejects an authoritative type on an unspecified overlay", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([
        notScored("no-intent-found", { effectiveWorkoutType: "Threshold" }),
      ]),
      new Map()
    );
    expect(result.source).toBe("ledger");
  });

  it("accepts no-measurable-objectives with a self-directed origin and null type", () => {
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([
        notScored("no-measurable-objectives", { effectiveWorkoutType: null }),
      ]),
      new Map()
    );
    expect(result.source).toBe("overlay");
  });

  it("accepts an historical record that predates effectiveWorkoutType", () => {
    const record = overlay({ effectiveWorkoutType: "Threshold" });
    delete (record as Partial<IntentOverlay>).effectiveWorkoutType;
    const result = resolveEffectiveOutcome(
      entry({ activityId: "a1" }),
      indexOverlaysByActivity([record]),
      new Map()
    );
    expect(result.source).toBe("overlay");
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
    // Distinct scores (8 vs 3) so the assertion unambiguously proves the ACTIVE overlay applied, not
    // merely that some overlay did and it happened to carry the same value regardless of which.
    const active = overlay({ id: "active", effectiveExecutionScore: 8, createdAt: "2026-06-15T10:00:00.000Z" });
    const pending = overlay({
      id: "pending", status: "pending", effectiveExecutionScore: 3, createdAt: "2026-06-16T10:00:00.000Z",
    });
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

  it("indexOverlaysByDate also keeps the newest applicable overlay independent of input order", () => {
    // This is the fallback path every legacy ledger row (no activityId) resolves through, so its
    // newest-wins behaviour matters just as much as indexOverlaysByActivity's.
    const older = overlay({ id: "old", createdAt: "2026-06-15T10:00:00.000Z" });
    const newer = overlay({ id: "new", createdAt: "2026-06-16T10:00:00.000Z" });
    expect(indexOverlaysByDate([newer, older]).get("2026-06-15")?.id).toBe("new");
    expect(indexOverlaysByDate([older, newer]).get("2026-06-15")?.id).toBe("new");
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

describe("overlay schema versions", () => {
  // What the store round-trip does to every row: JSON serialise → parse back.
  const roundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("schema-1 and schema-2 overlays both survive serialization and stay coherent/applicable", () => {
    const v1 = overlay(); // fixture defaults to schemaVersion: 1
    const v2 = overlay({ id: "ov-2", scoringVersion: 2, schemaVersion: 2 });
    expect(v1.schemaVersion).toBe(1);
    expect(v2.schemaVersion).toBe(2);

    for (const candidate of [v1, v2]) {
      const restored = roundTrip(candidate);
      expect(restored).toEqual(candidate);
      expect(isApplicable(restored)).toBe(true);
      const result = resolveEffectiveOutcome(
        entry({ activityId: candidate.activityId, executionScore: 3 }),
        indexOverlaysByActivity([restored]),
        new Map()
      );
      expect(result).toMatchObject({ source: "overlay", effectiveExecutionScore: 8 });
    }
  });

  it("new writes stamp schemaVersion 2 with scoringVersion INTENT_SCORING_VERSION and round-trip applicable", () => {
    const interpretation = overlay().interpretation;
    if (!interpretation) throw new Error("fixture interpretation missing");
    const written = buildOverlay({
      id: "fresh",
      activityId: "a1",
      date: "2026-06-15",
      noteFingerprint: "fp-fresh",
      createdAt: "2026-06-16T10:00:00.000Z",
      interpretation,
      verdict: {
        score: 7,
        reason: null,
        objectives: interpretation.objectives,
        scopeMin: 45,
        scopeRequiredMin: 20,
      },
    });

    expect(written.schemaVersion).toBe(2);
    expect(written.scoringVersion).toBe(INTENT_SCORING_VERSION);
    expect(INTENT_SCORING_VERSION).toBe(2);

    const restored = roundTrip(written);
    expect(restored).toEqual(written);
    expect(isApplicable(restored)).toBe(true);
  });
});
