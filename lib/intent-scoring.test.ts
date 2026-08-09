import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GRADABLE_KINDS_BY_CONFIDENCE,
  INTENT_MIN_SCOPE_MIN,
  INTENT_SCOPE_MIN_FRACTION,
  INTENT_SCORING_VERSION,
  assessScoreability,
  buildOverlay,
  canonicalise,
  evidenceScope,
  gradableObjectives,
  gradeObjective,
  identityKey,
  intentWorkoutType,
  matchLaps,
  resolveTargetWatts,
  scoreIntentExecution,
  zoneMinutes,
  type RideEvidence,
} from "./intent-scoring";
import { isApplicable } from "./intent-overlay";
import type {
  ExecutedInterval,
  IntentInterpretation,
  IntentTarget,
  ObjectiveKind,
  ScoredObjective,
  StructuredIntent,
  ZoneBasis,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ObjSpec = Partial<IntentTarget> & {
  zoneBasis?: ZoneBasis;
  sourceText?: string;
  description?: string;
  grounded?: boolean;
};

// Builds the shape the MODEL emits: kind + target + zoneBasis + grounded + sourceText. `measurable`,
// `scored`, `scopeMin` and `evidence` are deliberately seeded with values the scorer must overwrite —
// a scorer that trusted the model's own claim about measurability would pass a laxer test.
function obj(kind: ObjectiveKind, spec: ObjSpec = {}): ScoredObjective {
  const { zoneBasis = "unspecified", sourceText, description, grounded = true, ...target } = spec;
  const hasTarget = Object.keys(target).length > 0;
  return {
    description: description ?? `${kind} objective`,
    kind,
    target: hasTarget ? (target as IntentTarget) : null,
    zoneBasis,
    grounded,
    sourceText: sourceText ?? null,
    measurable: true,
    scored: true, // never true on output unless the scorer decided so
    scopeMin: 999, // nonsense the scorer must replace
    evidence: "model-supplied nonsense",
  };
}

function lap(durationSec: number, avgWatts: number | null, startIndex: number | null = null): ExecutedInterval {
  return {
    type: "WORK",
    durationSec,
    avgWatts,
    npWatts: avgWatts,
    avgHr: null,
    startIndex,
    endIndex: startIndex === null ? null : startIndex + durationSec,
  };
}

type EvidenceSpec = Partial<RideEvidence> & { z2Min?: number; zone?: number[] };

function evidence(over: EvidenceSpec = {}): RideEvidence {
  const { z2Min, zone, ...rest } = over;
  const derivedPower =
    zone ?? (z2Min === undefined ? null : [0, Math.round(z2Min * 60), 0, 0, 0, 0, 0]);
  return {
    durationMin: 90,
    isIndoor: false,
    powerZoneTimes: derivedPower,
    hrZoneTimes: null,
    laps: [],
    ftpUsed: 288,
    ...rest,
  };
}

const PLAIN_INTENT: StructuredIntent = { primaryPurpose: "steady endurance ride", phases: [] };

function interp(
  over: {
    confidence?: IntentInterpretation["confidence"];
    objectives?: ScoredObjective[];
    intent?: StructuredIntent;
  } = {}
): IntentInterpretation {
  return {
    intent: over.intent ?? PLAIN_INTENT,
    confidence: over.confidence ?? "high",
    objectives: over.objectives ?? [],
    model: "claude-test-model",
    promptVersion: 1,
  };
}

const scoreOf = (objectives: ScoredObjective[], ev: RideEvidence) =>
  scoreIntentExecution(interp({ objectives }), ev).score;

const grade = (objective: ScoredObjective, ev: RideEvidence) => gradeObjective(objective, ev).objective;

// ---------------------------------------------------------------------------
// The one-way confidence rule (question 1)
// ---------------------------------------------------------------------------

// A note whose tokens ground every fixture below, so grounding never silently does the narrowing that
// the confidence rule is supposed to be doing.
const CONF_NOTE = "45 min z2 then 4 x 5 min at 292 w, finished with 9 min at 95% ftp, in that order";

const FIXTURES: ScoredObjective[][] = [
  [],
  [obj("duration", { durationMin: 45 })],
  [obj("zone-time", { zone: "Z2", durationMin: 45 })],
  [obj("zone-emphasis", { zone: "Z2" })],
  [obj("effort", { durationMin: 9, targetPctFtp: 95 })],
  [obj("structure", { description: "the stated order" })],
  [obj("qualitative", { description: "practice cornering" })],
  [
    obj("zone-time", { zone: "Z2", durationMin: 45 }),
    obj("effort", { durationMin: 5, watts: 292, reps: 4 }),
    obj("structure", { description: "the stated order" }),
    obj("qualitative", { description: "practice cornering" }),
  ],
  [obj("zone-time", { zone: "Z2", durationMin: 45, grounded: false })],
];

describe("the one-way confidence rule", () => {
  it("confidence can only shrink the gradable set, never grow it", () => {
    for (const objectives of FIXTURES) {
      expect(gradableObjectives(objectives, "medium", CONF_NOTE).length).toBeLessThanOrEqual(
        gradableObjectives(objectives, "high", CONF_NOTE).length
      );
      expect(gradableObjectives(objectives, "low", CONF_NOTE).length).toBe(0);
    }
  });

  it("actually shrinks somewhere, so the monotonicity test is not vacuous", () => {
    const withStructure = FIXTURES[7];
    expect(gradableObjectives(withStructure, "medium", CONF_NOTE).length).toBeLessThan(
      gradableObjectives(withStructure, "high", CONF_NOTE).length
    );
    expect(GRADABLE_KINDS_BY_CONFIDENCE.high).toContain("structure");
    expect(GRADABLE_KINDS_BY_CONFIDENCE.medium).not.toContain("structure");
  });

  it("never grades a qualitative objective at any confidence", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(GRADABLE_KINDS_BY_CONFIDENCE[confidence]).not.toContain("qualitative");
    }
  });

  it("`high` cannot rescue a ride the scope gate rejects", () => {
    // 9-min effort, 118-min ride → scope 9 < max(20, 39). The lap IS present, so this exercises the
    // scope arithmetic rather than a missing-data short circuit.
    const nineMinEffort = obj("effort", { durationMin: 9, watts: 292 });
    const ev = evidence({ durationMin: 118, laps: [lap(540, 291)] });
    expect(scoreIntentExecution(interp({ confidence: "high", objectives: [nineMinEffort] }), ev).reason).toBe(
      "no-measurable-objectives"
    );
    expect(scoreIntentExecution(interp({ confidence: "high", objectives: [nineMinEffort] }), ev).scopeMin).toBe(9);
  });

  it("`high` cannot rescue an objective the note does not ground", () => {
    const ungrounded = obj("duration", { durationMin: 180, grounded: false });
    const ev = evidence({ durationMin: 118 });
    expect(scoreIntentExecution(interp({ confidence: "high", objectives: [ungrounded] }), ev).reason).toBe(
      "no-measurable-objectives"
    );
  });

  it("`low` is `intent-unreliable`, never `no-measurable-objectives`", () => {
    const r = scoreIntentExecution(
      interp({ confidence: "low", objectives: [obj("duration", { durationMin: 90 })] }),
      evidence({ durationMin: 90 })
    );
    expect(r.reason).toBe("intent-unreliable");
    expect(r.score).toBeNull();
  });

  it("re-grounding against the note can only narrow, never widen", () => {
    const claimed = [obj("duration", { durationMin: 45 }), obj("duration", { durationMin: 999 })];
    const withNote = gradableObjectives(claimed, "high", CONF_NOTE);
    const withoutNote = gradableObjectives(claimed, "high");
    expect(withNote.length).toBeLessThanOrEqual(withoutNote.length);
    expect(withNote.map((o) => o.target?.durationMin)).toEqual([45]);
  });
});

// ---------------------------------------------------------------------------
// Evidence scope, not fulfilment (the blocker-3 correction)
// ---------------------------------------------------------------------------

describe("evidence scope is what the evidence speaks about, never how much went well", () => {
  it("a badly missed but clearly stated target SCORES LOW, it is never Not scored", () => {
    const r = scoreIntentExecution(
      interp({ objectives: [obj("duration", { durationMin: 180 })] }),
      evidence({ durationMin: 40 })
    );
    expect(r.reason).toBeNull();
    expect(r.score).toBeLessThan(5);
  });

  it("a duration objective always clears the scope gate", () => {
    for (const durationMin of [20, 40, 90, 118, 300]) {
      const r = scoreIntentExecution(
        interp({ objectives: [obj("duration", { durationMin: 60 })] }),
        evidence({ durationMin })
      );
      expect(r.scopeMin).toBe(durationMin);
      expect(r.reason).toBeNull();
    }
  });

  it("but a ride shorter than the absolute floor cannot support a whole-ride verdict", () => {
    const r = scoreIntentExecution(
      interp({ objectives: [obj("duration", { durationMin: 60 })] }),
      evidence({ durationMin: 15 })
    );
    expect(INTENT_MIN_SCOPE_MIN).toBe(20);
    expect(r.reason).toBe("no-measurable-objectives");
  });

  it("an effort-only note on a long ride does not clear the gate", () => {
    const r = scoreIntentExecution(
      interp({ objectives: [obj("effort", { durationMin: 9, watts: 292 })] }),
      evidence({ durationMin: 118, laps: [lap(540, 291)] })
    );
    expect(r.scopeMin).toBe(9);
    expect(r.reason).toBe("no-measurable-objectives");
    expect(r.score).toBeNull();
  });

  it("the same effort DOES clear the gate on a short enough ride", () => {
    // scope 9 vs max(20, 0.33 * 25 = 8.25) still fails on 25 min; 22 min of matched effort clears it.
    const r = scoreIntentExecution(
      interp({ objectives: [obj("effort", { durationMin: 22, watts: 292 })] }),
      evidence({ durationMin: 40, laps: [lap(1320, 291)] })
    );
    expect(r.scopeMin).toBe(22);
    expect(r.reason).toBeNull();
  });

  it("scope is the MAXIMUM across objectives, never a union", () => {
    const objectives = [
      obj("duration", { durationMin: 100 }),
      obj("effort", { durationMin: 9, watts: 292 }),
    ];
    const r = scoreIntentExecution(interp({ objectives }), evidence({ durationMin: 118, laps: [lap(540, 291)] }));
    // A union would be 118 + 9 or similar; the max is the ride itself.
    expect(r.scopeMin).toBe(118);
    expect(evidenceScope(r.objectives)).toBe(118);
  });

  it("the gate threshold is max(floor, fraction * ride)", () => {
    expect(INTENT_SCOPE_MIN_FRACTION).toBe(0.33);
    const r = scoreIntentExecution(
      interp({ objectives: [obj("duration", { durationMin: 60 })] }),
      evidence({ durationMin: 118 })
    );
    expect(r.scopeRequiredMin).toBeCloseTo(Math.max(20, 0.33 * 118), 5);
  });
});

// ---------------------------------------------------------------------------
// Decomposition invariance (question 6's four ordered stages)
// ---------------------------------------------------------------------------

describe("canonicalisation: the model cannot move the score by how it splits an intent", () => {
  const ev = evidence({ durationMin: 90, z2Min: 44, laps: [lap(540, 291), lap(540, 289)] });

  it("exact duplicates score as one claim, not as a sum", () => {
    const single = [obj("zone-time", { zone: "Z2", durationMin: 45 })];
    const dup = [single[0], { ...single[0] }, { ...single[0], description: "steady Z2 block" }];
    // Stage 1 assertion — says WHICH stage broke, not merely that a number moved.
    expect(canonicalise(dup)).toHaveLength(1);
    expect(canonicalise(dup)[0].target?.durationMin).toBe(45); // NOT 135
    expect(scoreOf(dup, ev)).toBe(scoreOf(single, ev));
  });

  it("a split states parts of one total", () => {
    const split = [
      obj("zone-time", { zone: "Z2", durationMin: 20 }),
      obj("zone-time", { zone: "Z2", durationMin: 25 }),
    ];
    expect(canonicalise(split)).toHaveLength(1);
    expect(canonicalise(split)[0].target?.durationMin).toBe(45);
    expect(scoreOf(split, ev)).toBe(scoreOf([obj("zone-time", { zone: "Z2", durationMin: 45 })], ev));
  });

  it("a reordered split is the same split", () => {
    const split = [
      obj("zone-time", { zone: "Z2", durationMin: 20 }),
      obj("zone-time", { zone: "Z2", durationMin: 25 }),
    ];
    expect(canonicalise([...split].reverse())[0].target?.durationMin).toBe(45);
    expect(scoreOf([...split].reverse(), ev)).toBe(scoreOf(split, ev));
  });

  it("a split spelled two ways is still one claim — zone spelling cannot move the score", () => {
    // `zoneMinutes` and `sameZone` already read "Z2" / "z2" / "zone 2" / "2" as one zone, so the
    // dedupe/merge keys must too. Graded on a ride with 30 min of Z2: merged, the 45-min target is
    // 67% of stated (-1, score 4); unmerged, 20 and 25 min both read as over-achieved (+2 each,
    // score 7). A 3-point swing bought purely by the model's choice of spelling.
    const ev30 = evidence({ durationMin: 90, z2Min: 30 });
    const mixed = [
      obj("zone-time", { zone: "Z2", durationMin: 20 }),
      obj("zone-time", { zone: "zone 2", durationMin: 25 }),
    ];
    const consistent = [obj("zone-time", { zone: "Z2", durationMin: 45 })];
    // Stage 2 assertion — says WHICH stage broke, not merely that a number moved.
    expect(canonicalise(mixed)).toHaveLength(1);
    expect(canonicalise(mixed)[0].target?.durationMin).toBe(45); // NOT two 20/25-min targets
    expect(scoreOf(mixed, ev30)).toBe(scoreOf(consistent, ev30));
    expect(scoreOf(mixed, ev30)).toBe(4); // the under-delivered score, never the 7 the split bought
  });

  it("treats every spelling of one zone as one identity", () => {
    const spellings = ["Z2", "z2", "zone 2", "Zone 2", "2", " z 2 "];
    const keys = new Set(
      spellings.map((zone) => identityKey(obj("zone-time", { zone, durationMin: 45 })))
    );
    expect(keys.size).toBe(1);
    // ...but a genuinely different zone still gets its own identity.
    expect(identityKey(obj("zone-time", { zone: "Z3", durationMin: 45 }))).not.toBe([...keys][0]);
  });

  it("duplicate efforts do not multiply the work demanded", () => {
    const one = [obj("effort", { durationMin: 9, watts: 292, reps: 4 })];
    const dup = [one[0], { ...one[0] }];
    expect(canonicalise(dup)).toHaveLength(1);
    expect(canonicalise(dup)[0].target?.reps).toBe(4); // still 4 reps, never 8
    expect(scoreOf(dup, ev)).toBe(scoreOf(one, ev));
  });

  it("contradictory rep counts keep the max and record the conflict", () => {
    const conflicting = [
      obj("effort", { durationMin: 5, watts: 292, reps: 3 }),
      obj("effort", { durationMin: 5, watts: 292, reps: 4 }),
    ];
    const canonical = canonicalise(conflicting);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].target?.reps).toBe(4);
    expect(canonical[0].evidence).toMatch(/conflict/i);
  });

  it("one phrase contributes once, whichever kinds the model split it into", () => {
    const asZoneTime = [obj("zone-time", { zone: "Z2", durationMin: 45, sourceText: "45 min steady Z2" })];
    const asBoth = [...asZoneTime, obj("duration", { durationMin: 45, sourceText: "45 min steady Z2" })];
    expect(canonicalise(asBoth)).toHaveLength(1);
    expect(canonicalise(asBoth)[0].kind).toBe("zone-time"); // the more specific claim wins
    expect(scoreOf(asBoth, ev)).toBe(scoreOf(asZoneTime, ev));
  });

  it("subsumes a duration whose TARGET matches even when the spans were not recorded", () => {
    const asBoth = [
      obj("zone-time", { zone: "Z2", durationMin: 45 }),
      obj("duration", { durationMin: 46 }), // within +-1 min
    ];
    expect(canonicalise(asBoth)).toHaveLength(1);
    expect(canonicalise(asBoth)[0].kind).toBe("zone-time");
  });

  it("but two genuinely separate claims both count", () => {
    // "3 h ride, 45 min of it in Z2" — different spans, different targets, not subsumption.
    // The plan's illustrative fixture used a 2 h total, which on this 90-minute ride lands in the
    // duration band's neutral bucket and would make the score assertion pass either way; the
    // structural assertion on `canonicalise` is the fixture-independent half of this test.
    const both = [
      obj("duration", { durationMin: 180, sourceText: "3 h ride" }),
      obj("zone-time", { zone: "Z2", durationMin: 45, sourceText: "45 min of it in Z2" }),
    ];
    expect(canonicalise(both)).toHaveLength(2);
    expect(scoreOf(both, ev)).not.toBe(scoreOf([both[1]], ev));
  });

  it("does not subsume merely because two objectives both recorded no source span", () => {
    const both = [obj("duration", { durationMin: 180 }), obj("zone-time", { zone: "Z2", durationMin: 45 })];
    expect(canonicalise(both)).toHaveLength(2);
  });

  it("two duration objectives take the MAX, never the sum", () => {
    const two = [obj("duration", { durationMin: 60 }), obj("duration", { durationMin: 120 })];
    const canonical = canonicalise(two);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].target?.durationMin).toBe(120);
    expect(scoreOf(two, ev)).toBe(scoreOf([obj("duration", { durationMin: 120 })], ev));
    expect(scoreOf(two, ev)).not.toBe(scoreOf([obj("duration", { durationMin: 180 })], ev));
  });

  it("never sums zone-time across bases — HR minutes and power minutes are not addable", () => {
    const two = [
      obj("zone-time", { zone: "Z2", durationMin: 20, zoneBasis: "power" }),
      obj("zone-time", { zone: "Z2", durationMin: 25, zoneBasis: "heart-rate" }),
    ];
    const canonical = canonicalise(two);
    expect(canonical).toHaveLength(2);
    expect(canonical.map((o) => o.target?.durationMin).sort()).toEqual([20, 25]);
  });

  it("treats the same zone under two bases as two claims at stage 1, not a duplicate", () => {
    const power = obj("zone-time", { zone: "Z2", durationMin: 20, zoneBasis: "power" });
    const hr = obj("zone-time", { zone: "Z2", durationMin: 20, zoneBasis: "heart-rate" });
    expect(identityKey(power)).not.toBe(identityKey(hr));
  });

  it("excludes description and sourceText from the identity key", () => {
    const a = obj("zone-time", { zone: "Z2", durationMin: 45, description: "warmup", sourceText: "45m z2" });
    const b = obj("zone-time", { zone: "Z2", durationMin: 45, description: "steady", sourceText: "z2 start" });
    expect(identityKey(a)).toBe(identityKey(b));
  });

  it("keeps two distinct qualitative objectives apart despite both having no target", () => {
    const two = [
      obj("qualitative", { description: "practice fast cornering" }),
      obj("qualitative", { description: "keep speed on descents" }),
    ];
    expect(canonicalise(two)).toHaveLength(2);
  });

  it("a zone-time subsumes a zone-emphasis for the same zone", () => {
    const both = [
      obj("zone-time", { zone: "Z2", durationMin: 45 }),
      obj("zone-emphasis", { zone: "Z2" }),
    ];
    const canonical = canonicalise(both);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].kind).toBe("zone-time");
  });

  it("a zone-time does NOT subsume a zone-emphasis for a different zone", () => {
    const both = [obj("zone-time", { zone: "Z2", durationMin: 45 }), obj("zone-emphasis", { zone: "Z4" })];
    expect(canonicalise(both)).toHaveLength(2);
  });

  it("an effort inside a zone-time's zone is a separate claim, never subsumed", () => {
    const both = [
      obj("zone-time", { zone: "Z2", durationMin: 45, sourceText: "45 min steady Z2" }),
      obj("effort", { durationMin: 9, watts: 292, zone: "Z2", sourceText: "9 min at 292" }),
    ];
    expect(canonicalise(both)).toHaveLength(2);
  });

  it("canonicalises an effort stating only a zone into a zone-emphasis (question 7's row)", () => {
    const canonical = canonicalise([obj("effort", { zone: "Z4", sourceText: "some z4 efforts" })]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].kind).toBe("zone-emphasis");
    expect(canonical[0].target?.zone).toBe("Z4");
  });

  it("a summed target is accepted only when every merged part was grounded", () => {
    const parts = [
      obj("zone-time", { zone: "Z2", durationMin: 20 }),
      obj("zone-time", { zone: "Z2", durationMin: 25, grounded: false }),
    ];
    const canonical = canonicalise(parts);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].target?.durationMin).toBe(45);
    expect(canonical[0].grounded).toBe(false); // the sum inherits the weakest part
  });

  it("no kind can be multiplied past its own band by repeating objectives", () => {
    // Three zone-time objectives each nailed exactly. One clamped contribution per kind means +2 in
    // total, not +6 — an unbounded per-objective sum would reach the 10 ceiling instead.
    const ev6 = evidence({ durationMin: 90, powerZoneTimes: [0, 2700, 1800, 900, 0, 0, 0] });
    const many = [
      obj("zone-time", { zone: "Z2", durationMin: 45 }),
      obj("zone-time", { zone: "Z3", durationMin: 30 }),
      obj("zone-time", { zone: "Z4", durationMin: 15 }),
    ];
    expect(scoreOf(many, ev6)).toBe(7);
    expect(scoreOf([many[0]], ev6)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Every effort combination (question 7's table)
// ---------------------------------------------------------------------------

describe("effort grading — every combination of question 7's table", () => {
  const nineMinLap = lap(540, 291);
  const base = () => evidence({ durationMin: 60, laps: [nineMinLap], ftpUsed: 288 });
  const companion = obj("duration", { durationMin: 60 }); // keeps the ride scoreable in the ❌ rows

  it("duration + watts: grades the best-matching lap on the interval-adherence band", () => {
    const r = grade(obj("effort", { durationMin: 9, watts: 292 }), base());
    expect(r.scored).toBe(true);
    expect(r.measurable).toBe(true);
    expect(r.scopeMin).toBe(9);
    expect(scoreOf([obj("effort", { durationMin: 9, watts: 292 }), companion], base())).toBe(
      5 + 2 /* effort, 99.7% */ + 2 /* duration, 100% */
    );
  });

  it("duration + watts, well under target: the adherence band penalises it", () => {
    const ev = evidence({ durationMin: 60, laps: [lap(540, 200)] });
    const r = grade(obj("effort", { durationMin: 9, watts: 292 }), ev);
    expect(r.scored).toBe(true);
    expect(scoreOf([obj("effort", { durationMin: 9, watts: 292 }), companion], ev)).toBe(5 - 2 + 2);
  });

  it("resolves a stated %FTP against the ride's own ftpUsed, not the current FTP", () => {
    const target = { durationMin: 9, targetPctFtp: 95 }; // no `watts` — the model never computes it
    expect(resolveTargetWatts(target, 288)).toBe(274);
    expect(resolveTargetWatts(target, 300)).toBe(285); // a different ride-date FTP, a different target
  });

  it("an explicit watts always wins over a stated percentage", () => {
    expect(resolveTargetWatts({ durationMin: 9, watts: 292, targetPctFtp: 50 }, 288)).toBe(292);
  });

  it("grades a %FTP effort identically to the same effort stated in watts", () => {
    const ev = evidence({ ftpUsed: 288, laps: [lap(540, 275)] });
    expect(scoreOf([obj("effort", { durationMin: 9, targetPctFtp: 95 })], ev)).toBe(
      scoreOf([obj("effort", { durationMin: 9, watts: 274 })], ev)
    );
  });

  it("leaves a %FTP effort ungraded when the ride has no usable FTP anchor", () => {
    const r = grade(obj("effort", { durationMin: 9, targetPctFtp: 95 }), evidence({ ftpUsed: 0 }));
    expect(r.scored).toBe(false);
    expect(r.measurable).toBe(true); // missing data is never a failed metric
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no FTP anchor/);
  });

  it("the no-FTP-anchor row changes the score not at all versus omitting the objective", () => {
    const ev = evidence({ durationMin: 60, laps: [nineMinLap], ftpUsed: 0 });
    const bad = obj("effort", { durationMin: 9, targetPctFtp: 95 });
    expect(scoreOf([companion, bad], ev)).toBe(scoreOf([companion], ev));
  });

  it("duration only: a matching lap is +1, none is -1", () => {
    const hit = grade(obj("effort", { durationMin: 9 }), base());
    expect(hit.scored).toBe(true);
    expect(hit.scopeMin).toBe(9);
    expect(scoreOf([obj("effort", { durationMin: 9 }), companion], base())).toBe(5 + 1 + 2);

    const missEv = evidence({ durationMin: 60, laps: [lap(120, 300)] });
    const miss = grade(obj("effort", { durationMin: 9 }), missEv);
    expect(miss.scored).toBe(true);
    expect(miss.scopeMin).toBe(0);
    expect(scoreOf([obj("effort", { durationMin: 9 }), companion], missEv)).toBe(5 - 1 + 2);
  });

  it("watts only, no duration: ungraded, no window to evaluate over", () => {
    const r = grade(obj("effort", { watts: 292 }), base());
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no duration stated/);
    expect(scoreOf([companion, obj("effort", { watts: 292 })], base())).toBe(scoreOf([companion], base()));
  });

  it("%FTP only, no duration: ungraded for the same reason", () => {
    const r = grade(obj("effort", { targetPctFtp: 95 }), base());
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no duration stated/);
    expect(scoreOf([companion, obj("effort", { targetPctFtp: 95 })], base())).toBe(scoreOf([companion], base()));
  });

  it("reps + watts only, no duration: ungraded for the same reason", () => {
    const r = grade(obj("effort", { watts: 292, reps: 4 }), base());
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no duration stated/);
    expect(scoreOf([companion, obj("effort", { watts: 292, reps: 4 })], base())).toBe(scoreOf([companion], base()));
  });

  it("no lap data at all: ungraded, no delta, no scope", () => {
    const ev = evidence({ durationMin: 60, laps: [] });
    const r = grade(obj("effort", { durationMin: 9, watts: 292 }), ev);
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no interval data/);
    expect(scoreOf([companion, obj("effort", { durationMin: 9, watts: 292 })], ev)).toBe(scoreOf([companion], ev));
  });

  it("reps N + duration + watts: needs ceil(0.75 N) laps and grades their mean", () => {
    const four = evidence({
      durationMin: 60,
      laps: [lap(300, 290), lap(300, 288), lap(300, 292), lap(300, 286)],
    });
    const r = grade(obj("effort", { durationMin: 5, watts: 290, reps: 4 }), four);
    expect(r.scored).toBe(true);
    expect(r.scopeMin).toBe(20); // sum of the four matched lap durations
    expect(scoreOf([obj("effort", { durationMin: 5, watts: 290, reps: 4 }), companion], four)).toBe(5 + 2 + 2);
  });

  it("reps N + duration + watts, short of the threshold: -1 and no watt grading", () => {
    const two = evidence({ durationMin: 60, laps: [lap(300, 290), lap(300, 288)] });
    const r = grade(obj("effort", { durationMin: 5, watts: 290, reps: 4 }), two);
    expect(r.scored).toBe(true);
    expect(r.evidence).toMatch(/2 of 4/);
    expect(r.evidence).not.toMatch(/adherence/);
    expect(scoreOf([obj("effort", { durationMin: 5, watts: 290, reps: 4 }), companion], two)).toBe(5 - 1 + 2);
  });

  it("reps N + duration only: presence against the same ceil(0.75 N) threshold", () => {
    const three = evidence({ durationMin: 60, laps: [lap(300, null), lap(300, null), lap(300, null)] });
    expect(scoreOf([obj("effort", { durationMin: 5, reps: 4 }), companion], three)).toBe(5 + 1 + 2);
    const one = evidence({ durationMin: 60, laps: [lap(300, null)] });
    expect(scoreOf([obj("effort", { durationMin: 5, reps: 4 }), companion], one)).toBe(5 - 1 + 2);
  });

  it("matches laps within +-20% of the stated duration and nothing outside it", () => {
    const target: IntentTarget = { durationMin: 9 }; // 540s → [432, 648]
    expect(matchLaps(target, [lap(432, 300)])).toHaveLength(1);
    expect(matchLaps(target, [lap(648, 300)])).toHaveLength(1);
    expect(matchLaps(target, [lap(431, 300)])).toHaveLength(0);
    expect(matchLaps(target, [lap(649, 300)])).toHaveLength(0);
  });

  it("consumes a matched lap so two efforts cannot both claim it", () => {
    const ev = evidence({ durationMin: 60, laps: [lap(540, 291)] });
    const objectives = [
      obj("effort", { durationMin: 9, watts: 292, sourceText: "9 min at 292" }),
      obj("effort", { durationMin: 9, watts: 200, sourceText: "another 9 min at 200" }),
    ];
    const r = scoreIntentExecution(interp({ objectives }), ev);
    const efforts = r.objectives.filter((o) => o.kind === "effort");
    expect(efforts).toHaveLength(2);
    expect(efforts.filter((o) => (o.scopeMin ?? 0) > 0)).toHaveLength(1);
  });

  it("matches the longest stated target first", () => {
    // One 20-min lap and one 5-min lap. The 20-min effort must take the 20-min lap even though the
    // 5-min effort appears first in the model's output.
    const ev = evidence({ durationMin: 60, laps: [lap(1200, 280), lap(300, 350)] });
    const objectives = [
      obj("effort", { durationMin: 5, watts: 350, sourceText: "5 min hard" }),
      obj("effort", { durationMin: 20, watts: 280, sourceText: "20 min at threshold" }),
    ];
    const r = scoreIntentExecution(interp({ objectives }), ev);
    const long = r.objectives.find((o) => o.target?.durationMin === 20);
    const short = r.objectives.find((o) => o.target?.durationMin === 5);
    expect(long?.scopeMin).toBe(20);
    expect(short?.scopeMin).toBe(5);
  });

  it("an ungraded objective is absent from its kind's mean, not a zero inside it", () => {
    // The sharp version of "no change versus omitting it": here the ungraded effort shares a kind with
    // a graded one, so counting it as a 0 would halve the kind's contribution rather than vanish.
    const ev = evidence({ durationMin: 60, laps: [lap(540, 291)] });
    const good = obj("effort", { durationMin: 9, watts: 292, sourceText: "9 min at 292" });
    const ungradable = obj("effort", { watts: 250, sourceText: "some hard efforts" }); // no duration
    expect(scoreOf([companion, good, ungradable], ev)).toBe(scoreOf([companion, good], ev));
    expect(scoreOf([companion, good], ev)).toBe(5 + 2 + 2);
  });

  it("falls back to presence when the matched lap carries no power", () => {
    const ev = evidence({ durationMin: 60, laps: [lap(540, null)] });
    const r = grade(obj("effort", { durationMin: 9, watts: 292 }), ev);
    expect(r.scored).toBe(true);
    expect(r.evidence).toMatch(/no power/i);
  });
});

// ---------------------------------------------------------------------------
// Zone semantics and zoneBasis (question 8)
// ---------------------------------------------------------------------------

describe("zone evidence: units, indices and the basis rule", () => {
  it("converts seconds to minutes without rounding the seconds first", () => {
    const ev = evidence({ powerZoneTimes: [0, 2705, 0, 0, 0, 0, 0] });
    expect(zoneMinutes(ev, "Z2", "unspecified")?.minutes).toBe(45.1); // not 45
  });

  it("maps `Z2` to index 1", () => {
    const ev = evidence({ powerZoneTimes: [600, 1200, 1800, 0, 0, 0, 0] });
    expect(zoneMinutes(ev, "Z2", "power")?.minutes).toBe(20);
    expect(zoneMinutes(ev, "Z1", "power")?.minutes).toBe(10);
    expect(zoneMinutes(ev, "Z3", "power")?.minutes).toBe(30);
    expect(zoneMinutes(ev, "zone 3", "power")?.minutes).toBe(30);
  });

  it("treats a null, short or all-zero array as no evidence at all", () => {
    expect(zoneMinutes(evidence({ powerZoneTimes: null }), "Z2", "power")).toBeNull();
    expect(zoneMinutes(evidence({ powerZoneTimes: [0, 60] }), "Z5", "power")).toBeNull();
    expect(zoneMinutes(evidence({ powerZoneTimes: [0, 0, 0, 0, 0, 0, 0] }), "Z2", "power")).toBeNull();
  });

  it("leaves a zone objective backed by no array ungraded with scope 0", () => {
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45 }), evidence({ powerZoneTimes: null }));
    expect(r.scored).toBe(false);
    expect(r.measurable).toBe(true);
    expect(r.scopeMin).toBe(0);
  });

  it("grades an explicit power-zone target from POWER data, never from HR", () => {
    const ev = evidence({
      powerZoneTimes: [0, 2700, 0, 0, 0, 0, 0],
      hrZoneTimes: [0, 600, 0, 0, 0, 0, 0],
    });
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "power" }), ev);
    expect(r.evidence).toMatch(/power/);
    expect(r.evidence).toContain("45");
    expect(r.scored).toBe(true);
  });

  it("grades an explicit HR-zone target from HR data", () => {
    const ev = evidence({
      powerZoneTimes: [0, 600, 0, 0, 0, 0, 0],
      hrZoneTimes: [0, 2700, 0, 0, 0, 0, 0],
    });
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "heart-rate" }), ev);
    expect(r.evidence).toMatch(/HR/);
    expect(r.evidence).toContain("45");
    expect(r.scored).toBe(true);
  });

  it("leaves an explicit-basis target UNGRADED when its own array is missing — no cross-fallback", () => {
    const ev = evidence({ powerZoneTimes: null, hrZoneTimes: [0, 2700, 0, 0, 0, 0, 0] });
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "power" }), ev);
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no power zone data/);
  });

  it("leaves an explicit HR target ungraded when only power data exists", () => {
    const ev = evidence({ powerZoneTimes: [0, 2700, 0, 0, 0, 0, 0], hrZoneTimes: null });
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "heart-rate" }), ev);
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no HR zone data/);
  });

  it("defaults `unspecified` to power, falling back to HR only for that basis", () => {
    const both = evidence({
      powerZoneTimes: [0, 2700, 0, 0, 0, 0, 0],
      hrZoneTimes: [0, 600, 0, 0, 0, 0, 0],
    });
    expect(zoneMinutes(both, "Z2", "unspecified")?.basis).toBe("power");
    const hrOnly = evidence({ powerZoneTimes: null, hrZoneTimes: [0, 2700, 0, 0, 0, 0, 0] });
    expect(zoneMinutes(hrOnly, "Z2", "unspecified")?.basis).toBe("heart-rate");
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45 }), hrOnly);
    expect(r.scored).toBe(true);
    expect(r.evidence).toMatch(/HR/);
  });

  it("records in the evidence string whether the basis came from the note or the default", () => {
    const ev = evidence({ powerZoneTimes: [0, 2700, 0, 0, 0, 0, 0] });
    const stated = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "power" }), ev);
    const assumed = grade(obj("zone-time", { zone: "Z2", durationMin: 45, zoneBasis: "unspecified" }), ev);
    expect(stated.evidence).not.toMatch(/assumed/i);
    expect(assumed.evidence).toMatch(/assumed/i);
  });

  it("uses power for `unspecified` on an indoor ride, with no HR fallback", () => {
    const indoor = evidence({ isIndoor: true, powerZoneTimes: null, hrZoneTimes: [0, 2700, 0, 0, 0, 0, 0] });
    expect(zoneMinutes(indoor, "Z2", "unspecified")).toBeNull();
    const r = grade(obj("zone-time", { zone: "Z2", durationMin: 45 }), indoor);
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
  });

  it("grades zone-emphasis on the measured share of zone-array time", () => {
    const heavy = evidence({ durationMin: 90, powerZoneTimes: [0, 3600, 1800, 0, 0, 0, 0] }); // 66.7% Z2
    const mid = evidence({ durationMin: 90, powerZoneTimes: [0, 2700, 2700, 0, 0, 0, 0] }); // 50% Z2
    const flat = evidence({ durationMin: 90, powerZoneTimes: [0, 1800, 3600, 0, 0, 0, 0] }); // 33% Z2
    const thin = evidence({ durationMin: 90, powerZoneTimes: [0, 540, 4860, 0, 0, 0, 0] }); // 10% Z2
    const emphasis = [obj("zone-emphasis", { zone: "Z2" })];
    expect(scoreOf(emphasis, heavy)).toBe(7);
    expect(scoreOf(emphasis, mid)).toBe(6);
    expect(scoreOf(emphasis, flat)).toBe(5);
    expect(scoreOf(emphasis, thin)).toBe(4);
  });

  it("zone BOUNDARY definitions move the score but cannot flip scoreability", () => {
    const I = interp({ objectives: [obj("zone-time", { zone: "Z2", durationMin: 45 })] });
    const a = evidence({ durationMin: 90, zone: [1200, 3000, 1200, 0, 0, 0, 0] });
    const b = evidence({ durationMin: 90, zone: [1200, 1800, 2400, 0, 0, 0, 0] });
    expect(scoreIntentExecution(I, a).reason).toBe(scoreIntentExecution(I, b).reason);
    expect(scoreIntentExecution(I, a).reason).toBeNull();
    expect(scoreIntentExecution(I, a).score).not.toBe(scoreIntentExecution(I, b).score);
    // Scope is presence-based, so it is identical on both sides of the boundary shift.
    expect(scoreIntentExecution(I, a).scopeMin).toBe(scoreIntentExecution(I, b).scopeMin);
  });

  it("absence of zone data CAN flip scoreability, and that is intended", () => {
    const I = interp({ objectives: [obj("zone-time", { zone: "Z2", durationMin: 45 })] });
    const present = evidence({ durationMin: 90, zone: [1200, 3000, 1200, 0, 0, 0, 0] });
    const absent = evidence({ durationMin: 90, powerZoneTimes: null, hrZoneTimes: null });
    expect(scoreIntentExecution(I, present).reason).toBeNull();
    expect(scoreIntentExecution(I, absent).reason).toBe("no-measurable-objectives");
  });
});

// ---------------------------------------------------------------------------
// Qualitative and structure objectives
// ---------------------------------------------------------------------------

describe("qualitative and structure objectives", () => {
  it("acknowledges a qualitative objective without ever grading it", () => {
    const q = obj("qualitative", { description: "practice fast cornering on the descent" });
    const r = scoreIntentExecution(
      interp({ objectives: [q, obj("duration", { durationMin: 60 })] }),
      evidence({ durationMin: 60 })
    );
    const acknowledged = r.objectives.find((o) => o.kind === "qualitative");
    expect(acknowledged?.measurable).toBe(false);
    expect(acknowledged?.scored).toBe(false);
    expect(acknowledged?.scopeMin).toBe(0);
    expect(r.score).toBe(scoreOf([obj("duration", { durationMin: 60 })], evidence({ durationMin: 60 })));
  });

  it("overrides the model's own `measurable`/`scored`/`scopeMin` claims", () => {
    const lying = obj("qualitative", { description: "cornering was excellent" });
    expect(lying.measurable).toBe(true); // as the fixture was handed in
    const r = scoreIntentExecution(interp({ objectives: [lying, obj("duration", { durationMin: 60 })] }), evidence({ durationMin: 60 }));
    const back = r.objectives.find((o) => o.kind === "qualitative");
    expect(back?.measurable).toBe(false);
    expect(back?.scopeMin).toBe(0);
  });

  it("grades structure as reward-only: +1 in the stated order, 0 out of it, never negative", () => {
    // 60 min, so the 20-minute effort's scope clears max(20, 0.33 * 60) on its own.
    const inOrder = evidence({
      durationMin: 60,
      laps: [lap(1200, 280, 100), lap(540, 300, 5000)],
    });
    const outOfOrder = evidence({
      durationMin: 60,
      laps: [lap(1200, 280, 5000), lap(540, 300, 100)],
    });
    const objectives = [
      obj("effort", { durationMin: 20, watts: 280, sourceText: "20 min threshold first" }),
      obj("effort", { durationMin: 9, watts: 300, sourceText: "then 9 min hard" }),
      obj("structure", { description: "20 min block then the 9 min finisher" }),
    ];
    const ordered = scoreIntentExecution(interp({ objectives }), inOrder);
    const scrambled = scoreIntentExecution(interp({ objectives }), outOfOrder);
    expect(ordered.score).toBe(8);
    expect(scrambled.score).toBe(7);
    expect((ordered.score as number) - (scrambled.score as number)).toBe(1);
    expect(ordered.objectives.find((o) => o.kind === "structure")?.scored).toBe(true);
    expect(scrambled.objectives.find((o) => o.kind === "structure")?.scored).toBe(true);

    // Reward-only: stating a structure can never LOWER the score, however the laps came out. This is
    // the observable half of the rule — the band, not just the delta, has to hold it.
    const withoutStructure = objectives.slice(0, 2);
    expect(scrambled.score as number).toBeGreaterThanOrEqual(scoreOf(withoutStructure, outOfOrder) as number);
    expect(ordered.score as number).toBeGreaterThanOrEqual(scoreOf(withoutStructure, inOrder) as number);
  });

  it("leaves structure ungraded when the ride carries no ordered evidence", () => {
    const r = grade(obj("structure", { description: "z2 then climbing" }), evidence({ durationMin: 90 }));
    expect(r.scored).toBe(false);
    expect(r.scopeMin).toBe(0);
    expect(r.evidence).toMatch(/no ordered evidence/);
  });

  it("gives structure a scope of 0 so it can never carry the gate on its own", () => {
    const r = scoreIntentExecution(
      interp({ objectives: [obj("structure", { description: "z2 then climbing" })] }),
      evidence({ durationMin: 90 })
    );
    expect(r.scopeMin).toBe(0);
    expect(r.reason).toBe("no-measurable-objectives");
  });
});

// ---------------------------------------------------------------------------
// Acceptance examples (design §14.1 and §14.2) — the athlete's real notes, verbatim
// ---------------------------------------------------------------------------

const NOTE_2026_08_06 = `The plan for the ride was:
- 45m z2 steady start
-then a climbing part on undulating terrain which is my weakpoint since it includes power changes not just a steady z4 climb effort, so there were z4 efforts, z5 and z6 on 10%+ gradients  aswell as short descents in between.
-finished the session with a 9m at 292 effort
-then a fast technical descent at the endwhich is also my weakpoint so i tried to practice fast cornering and keeping speed on descents`;

const NOTE_2026_08_05 = `Mixed terrain ride, with some z4 and z5 efforts, also KOM scouting. Z2 on the flats`;

describe("acceptance example 14.1 — the real 2026-08-06 mixed ride", () => {
  // The note is the athlete's own, verbatim; the sensor numbers below are a plausible reconstruction
  // that supports the stated objectives (the plan pins the NOTE as a literal, not the telemetry).
  const intent: StructuredIntent = {
    primaryPurpose: "mixed endurance ride with undulating climbing work and a hard finishing effort",
    phases: [
      { description: "45 min steady Z2 start", kind: "zone-time", durationMin: 45, targetZone: "Z2" },
      { description: "undulating climbing with Z4, Z5 and Z6 efforts", kind: "zone-emphasis", targetZone: "Z4" },
      { description: "9 min finishing effort at 292 W", kind: "effort", durationMin: 9, targetWatts: 292 },
      { description: "fast technical descending practice", kind: "qualitative" },
    ],
  };

  const objectives = [
    obj("zone-time", { zone: "Z2", durationMin: 45, sourceText: "45m z2 steady start" }),
    obj("zone-emphasis", { zone: "Z4", sourceText: "there were z4 efforts", description: "Z4 climbing efforts" }),
    obj("zone-emphasis", { zone: "Z5", sourceText: "z5", description: "Z5 climbing efforts" }),
    obj("zone-emphasis", { zone: "Z6", sourceText: "z6 on 10%+ gradients", description: "Z6 climbing efforts" }),
    obj("effort", { durationMin: 9, watts: 292, sourceText: "finished the session with a 9m at 292 effort" }),
    obj("structure", { description: "Z2 start, then climbing, then the finisher, then the descent" }),
    obj("qualitative", {
      description: "practice fast cornering and keeping speed on the technical descent",
      sourceText: "i tried to practice fast cornering and keeping speed on descents",
    }),
  ];

  // 118 min = 7080 s across the seven power zones.
  const ev = evidence({
    durationMin: 118,
    ftpUsed: 288,
    powerZoneTimes: [900, 2760, 1200, 1140, 660, 300, 120],
    hrZoneTimes: [600, 2400, 2400, 1200, 480, 0, 0],
    laps: [lap(300, 330, 2000), lap(240, 350, 3000), lap(540, 291, 6000)],
  });

  const result = scoreIntentExecution(interp({ confidence: "high", objectives, intent }), ev);

  it("guards the note fixture itself", () => {
    expect(NOTE_2026_08_06.length).toBe(455);
  });

  it("interprets the note's four phases", () => {
    expect(intent.phases).toHaveLength(4);
    expect(intent.phases.map((p) => p.kind)).toEqual(["zone-time", "zone-emphasis", "effort", "qualitative"]);
  });

  it("produces an evidence-based score, not the generic 2/10 pathway", () => {
    expect(result.reason).toBeNull();
    expect(result.score).toBe(8);
    expect(result.score).not.toBe(2);
  });

  it("grades the Z2 block from the zone array", () => {
    const z2 = result.objectives.find((o) => o.kind === "zone-time");
    expect(z2?.scored).toBe(true);
    expect(z2?.scopeMin).toBe(118);
    expect(z2?.evidence).toContain("46");
  });

  it("grades the climbing emphasis from its own zones", () => {
    const climbing = result.objectives.filter((o) => o.kind === "zone-emphasis");
    expect(climbing).toHaveLength(3);
    expect(climbing.every((o) => o.scored)).toBe(true);
  });

  it("grades the 9-minute effort against the lap that matches it", () => {
    const effort = result.objectives.find((o) => o.kind === "effort");
    expect(effort?.scored).toBe(true);
    expect(effort?.scopeMin).toBe(9);
    expect(effort?.evidence).toContain("291");
  });

  it("acknowledges the descending objective without grading it", () => {
    const descending = result.objectives.find((o) => o.kind === "qualitative");
    expect(descending?.measurable).toBe(false);
    expect(descending?.scored).toBe(false);
  });

  it("has no variability axis at all, so no delta can derive from ride variability", () => {
    // By construction, per the brief: RideEvidence carries no VI/NP/variability input, so there is no
    // number a variability-derived delta could be computed from. Asserted structurally, not by
    // probing for the absence of a value.
    expect(Object.keys(ev).sort()).toEqual(
      ["durationMin", "ftpUsed", "hrZoneTimes", "isIndoor", "laps", "powerZoneTimes"].sort()
    );
    const source = readFileSync(new URL("./intent-scoring.ts", import.meta.url), "utf8");
    for (const forbidden of [/variabilityIndex/, /\bVI\b/, /normalizedPower/, /npWatts/]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it("records, as a live cross-module fact, that the real note does not ground its own numbers", () => {
    // Task 2's grounder requires a unit-bearing token: "45m"/"9m" carry no `min`, and "292 effort"
    // carries no `W`. So when the runner re-grounds this note, the Z2 duration and the 9-min effort
    // are dropped and only the zone-only objectives survive. Recorded here rather than hidden, because
    // it means design §14.1's "grade the Z2 and the 9-minute objectives" is NOT reachable end-to-end
    // with the grounder as committed. See the report accompanying this task.
    const survived = gradableObjectives(objectives, "high", NOTE_2026_08_06).map((o) => o.kind);
    expect(survived).not.toContain("zone-time");
    expect(survived).not.toContain("effort");
    expect(survived).toContain("zone-emphasis");
  });
});

describe("acceptance example 14.2 — the real 2026-08-05 scouting ride", () => {
  const intent: StructuredIntent = {
    primaryPurpose: "mixed-terrain scouting ride with some harder efforts and Z2 on the flats",
    phases: [
      { description: "Z2 on the flats", kind: "zone-emphasis", targetZone: "Z2" },
      { description: "some Z4 and Z5 efforts", kind: "zone-emphasis", targetZone: "Z4" },
      { description: "KOM scouting", kind: "qualitative" },
    ],
  };

  const objectives = [
    obj("zone-emphasis", { zone: "Z2", sourceText: "Z2 on the flats", description: "Z2 on the flats" }),
    obj("zone-emphasis", { zone: "Z4", sourceText: "some z4", description: "some Z4 efforts" }),
    obj("zone-emphasis", { zone: "Z5", sourceText: "z5 efforts", description: "some Z5 efforts" }),
    obj("qualitative", { description: "KOM scouting", sourceText: "also KOM scouting" }),
  ];

  // 119 min = 7140 s.
  const ev = evidence({
    durationMin: 119,
    ftpUsed: 288,
    powerZoneTimes: [600, 3300, 1500, 960, 540, 180, 60],
    laps: [],
  });

  const result = scoreIntentExecution(interp({ confidence: "medium", objectives, intent }), ev, NOTE_2026_08_05);

  it("guards the note fixture itself", () => {
    expect(NOTE_2026_08_05.length).toBe(83);
  });

  it("scores rather than falling through to Not scored", () => {
    expect(result.reason).toBeNull();
    expect(result.score).not.toBeNull();
    expect(result.score as number).toBeGreaterThanOrEqual(1);
    expect(result.score as number).toBeLessThanOrEqual(10);
  });

  it("grades the Z2 emphasis from the whole-ride zone distribution", () => {
    const z2 = result.objectives.find((o) => o.kind === "zone-emphasis" && o.target?.zone === "Z2");
    expect(z2?.scored).toBe(true);
    expect(z2?.scopeMin).toBe(119);
    expect(z2?.evidence).toContain("46");
  });

  it("survives re-grounding against the real note end-to-end", () => {
    // Unlike 14.1, every objective here is zone-only, so Task 2's grounder supports all of them.
    expect(gradableObjectives(objectives, "medium", NOTE_2026_08_05)).toHaveLength(3);
  });

  it("grades only grounded objectives", () => {
    for (const o of result.objectives) {
      if (o.scored) expect(o.grounded).toBe(true);
    }
  });

  it("drops `structure` from the gradable set at medium confidence", () => {
    expect(result.objectives.some((o) => o.kind === "structure")).toBe(false);
    // Non-vacuous: had the model emitted one, medium would still have dropped it.
    const withStructure = [...objectives, obj("structure", { description: "flats then the efforts" })];
    expect(gradableObjectives(withStructure, "medium", NOTE_2026_08_05).some((o) => o.kind === "structure")).toBe(
      false
    );
    expect(gradableObjectives(withStructure, "high", NOTE_2026_08_05).some((o) => o.kind === "structure")).toBe(true);
  });

  it("does not invent an interval target the note never stated", () => {
    expect(result.objectives.some((o) => o.kind === "effort")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Anti-contamination
// ---------------------------------------------------------------------------

describe("anti-contamination", () => {
  const source = readFileSync(new URL("./intent-scoring.ts", import.meta.url), "utf8");

  it("reads the real committed source file, not a constructed string", () => {
    expect(source.length).toBeGreaterThan(2000);
    expect(source).toContain("export function scoreIntentExecution");
  });

  it("never reads whole-ride decoupling", () => {
    expect(source).not.toMatch(/decoupling/i);
  });

  it("never imports the Anthropic SDK or any AI seam", () => {
    expect(source).not.toMatch(/@anthropic-ai/);
    expect(source).not.toMatch(/from "\.\/anthropic/);
    expect(source).not.toMatch(/anthropic/i);
  });

  it("never reads the ride's existing execution score", () => {
    expect(source).not.toMatch(/executionScore/);
    expect(source).not.toMatch(/computeExecutionScore/);
    expect(source).not.toMatch(/intensityFactor/);
  });

  it("does no I/O", () => {
    expect(source).not.toMatch(/node:fs/);
    expect(source).not.toMatch(/readFile|writeFile|fetch\(/);
  });
});

// ---------------------------------------------------------------------------
// intentWorkoutType
// ---------------------------------------------------------------------------

describe("intentWorkoutType", () => {
  const withPurpose = (primaryPurpose: string): StructuredIntent => ({ primaryPurpose, phases: [] });

  it("takes only a StructuredIntent, so consulting IF is unexpressible", () => {
    expect(intentWorkoutType.length).toBe(1);
  });

  it("maps stated purposes", () => {
    expect(intentWorkoutType(withPurpose("steady Z2 endurance ride"))).toBe("Z2");
    expect(intentWorkoutType(withPurpose("threshold intervals"))).toBe("Threshold");
    expect(intentWorkoutType(withPurpose("sweet spot work"))).toBe("Threshold");
    expect(intentWorkoutType(withPurpose("VO2max session"))).toBe("VO2max");
    expect(intentWorkoutType(withPurpose("sprint intervals"))).toBe("SIT");
    expect(intentWorkoutType(withPurpose("recovery spin"))).toBe("Recovery");
    expect(intentWorkoutType(withPurpose("race simulation"))).toBe("RaceSim");
    expect(intentWorkoutType(withPurpose("gym strength session"))).toBe("Strength");
  });

  it("falls back to the highest zone the phases state", () => {
    expect(
      intentWorkoutType({
        primaryPurpose: "a ride",
        phases: [
          { description: "warm up", kind: "zone-time", targetZone: "Z2" },
          { description: "efforts", kind: "zone-emphasis", targetZone: "Z5" },
        ],
      })
    ).toBe("VO2max");
  });

  it("returns null for an unmappable purpose", () => {
    expect(intentWorkoutType(withPurpose("just riding around with friends and stopping for cake"))).toBeNull();
    expect(intentWorkoutType({ primaryPurpose: "", phases: [] })).toBeNull();
  });

  it("never consults ride intensity — the whole point of the narrow signature", () => {
    const source = readFileSync(new URL("./intent-scoring.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/inferWorkoutType/);
  });
});

// ---------------------------------------------------------------------------
// buildOverlay — the five outcome rows
// ---------------------------------------------------------------------------

describe("buildOverlay produces exactly the records its own consumer accepts", () => {
  const base = {
    id: "overlay-1",
    activityId: "i172976026",
    date: "2026-08-06",
    noteFingerprint: "abc123",
    createdAt: "2026-08-06T18:00:00.000Z",
  };

  const scoredIntent: StructuredIntent = { primaryPurpose: "steady Z2 endurance ride", phases: [] };

  const scoredVerdict = scoreIntentExecution(
    interp({ objectives: [obj("duration", { durationMin: 60 })], intent: scoredIntent }),
    evidence({ durationMin: 60 })
  );
  const scoredInterpretation = interp({ objectives: [obj("duration", { durationMin: 60 })], intent: scoredIntent });

  it("row 1 — no note at all", () => {
    const overlay = buildOverlay({ ...base, reason: "no-intent-found" });
    expect(overlay.origin).toBe("unspecified");
    expect(overlay.effectiveExecutionScore).toBeNull();
    expect(overlay.notScoredReason).toBe("no-intent-found");
    expect(overlay.interpretation).toBeNull();
    expect(overlay.scoringVersion).toBeNull();
    expect(overlay.effectiveWorkoutType).toBeNull();
    expect(isApplicable(overlay)).toBe(true);
  });

  it("row 2 — the parse errored", () => {
    const overlay = buildOverlay({ ...base, reason: "interpreter-failed" });
    expect(overlay.origin).toBe("unspecified");
    expect(overlay.effectiveExecutionScore).toBeNull();
    expect(overlay.notScoredReason).toBe("interpreter-failed");
    expect(overlay.interpretation).toBeNull();
    expect(overlay.scoringVersion).toBeNull();
    expect(overlay.effectiveWorkoutType).toBeNull();
    expect(isApplicable(overlay)).toBe(true);
  });

  it("row 3 — the intent is too unreliable to trust", () => {
    const unreliable = interp({ confidence: "low", objectives: [obj("duration", { durationMin: 60 })], intent: scoredIntent });
    const verdict = scoreIntentExecution(unreliable, evidence({ durationMin: 60 }));
    const overlay = buildOverlay({ ...base, interpretation: unreliable, verdict });
    expect(overlay.origin).toBe("unspecified");
    expect(overlay.effectiveExecutionScore).toBeNull();
    expect(overlay.notScoredReason).toBe("intent-unreliable");
    expect(overlay.scoringVersion).toBeNull();
    expect(overlay.effectiveWorkoutType).toBeNull();
    expect(overlay.interpretation).not.toBeNull(); // the attempt is retained (design §5.3)
    expect(isApplicable(overlay)).toBe(true);
  });

  it("row 4 — the intent is clear but nothing is measurable", () => {
    const nothing = interp({ objectives: [obj("qualitative", { description: "have fun" })], intent: scoredIntent });
    const verdict = scoreIntentExecution(nothing, evidence({ durationMin: 60 }));
    const overlay = buildOverlay({ ...base, interpretation: nothing, verdict });
    expect(overlay.origin).toBe("self-directed");
    expect(overlay.effectiveExecutionScore).toBeNull();
    expect(overlay.notScoredReason).toBe("no-measurable-objectives");
    expect(overlay.scoringVersion).toBeNull();
    expect(overlay.effectiveWorkoutType).toBe("Z2");
    expect(isApplicable(overlay)).toBe(true);
  });

  it("row 5 — the intent is clear and measurable", () => {
    const overlay = buildOverlay({ ...base, interpretation: scoredInterpretation, verdict: scoredVerdict });
    expect(overlay.origin).toBe("self-directed");
    expect(typeof overlay.effectiveExecutionScore).toBe("number");
    expect(overlay.notScoredReason).toBeNull();
    expect(overlay.scoringVersion).toBe(INTENT_SCORING_VERSION);
    expect(overlay.effectiveWorkoutType).toBe("Z2");
    expect(isApplicable(overlay)).toBe(true);
  });

  it("carries the GRADED objectives, not the model's own claims about them", () => {
    const overlay = buildOverlay({ ...base, interpretation: scoredInterpretation, verdict: scoredVerdict });
    expect(overlay.interpretation?.objectives).toEqual(scoredVerdict.objectives);
    expect(overlay.interpretation?.objectives.every((o) => o.scopeMin !== 999)).toBe(true);
  });

  it("sets scoringVersion exactly when a score exists", () => {
    const rows = [
      buildOverlay({ ...base, reason: "no-intent-found" }),
      buildOverlay({ ...base, reason: "interpreter-failed" }),
      buildOverlay({ ...base, interpretation: scoredInterpretation, verdict: scoredVerdict }),
    ];
    for (const row of rows) {
      expect(row.scoringVersion === null).toBe(row.effectiveExecutionScore === null);
    }
  });

  it("nulls effectiveWorkoutType on every `unspecified` row", () => {
    const unreliable = interp({ confidence: "low", objectives: [], intent: scoredIntent });
    const rows = [
      buildOverlay({ ...base, reason: "no-intent-found" }),
      buildOverlay({ ...base, reason: "interpreter-failed" }),
      buildOverlay({
        ...base,
        interpretation: unreliable,
        verdict: scoreIntentExecution(unreliable, evidence({ durationMin: 60 })),
      }),
    ];
    for (const row of rows) {
      expect(row.origin).toBe("unspecified");
      expect(row.effectiveWorkoutType).toBeNull();
    }
  });

  it("never asserts a prescription, and is never born superseded", () => {
    const overlay = buildOverlay({ ...base, interpretation: scoredInterpretation, verdict: scoredVerdict });
    expect(overlay.origin).not.toBe("prescribed");
    expect(overlay.supersededBy).toBeNull();
    expect(overlay.approvedAt).toBeNull();
    expect(overlay.status).toBe("active");
  });

  it("honours an explicit `pending` status without becoming applicable", () => {
    const overlay = buildOverlay({
      ...base,
      status: "pending",
      interpretation: scoredInterpretation,
      verdict: scoredVerdict,
    });
    expect(overlay.status).toBe("pending");
    expect(isApplicable(overlay)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scoring model shape
// ---------------------------------------------------------------------------

describe("the score model", () => {
  it("starts from a baseline of 5 and clamps to 1..10", () => {
    const neutral = scoreOf([obj("duration", { durationMin: 100 })], evidence({ durationMin: 75 })); // 75%
    expect(neutral).toBe(5);
    const floorEv = evidence({ durationMin: 40, zone: [0, 60, 0, 0, 0, 0, 0] });
    const floor = scoreOf(
      [
        obj("duration", { durationMin: 300 }),
        obj("zone-time", { zone: "Z2", durationMin: 200 }),
        obj("zone-emphasis", { zone: "Z4" }),
        obj("effort", { durationMin: 9, watts: 292 }),
      ],
      floorEv
    );
    expect(floor).toBeGreaterThanOrEqual(1);
  });

  it("returns whole numbers", () => {
    const score = scoreOf([obj("zone-emphasis", { zone: "Z2" })], evidence({ durationMin: 90, zone: [0, 2700, 2700, 0, 0, 0, 0] }));
    expect(Number.isInteger(score as number)).toBe(true);
  });

  it("never returns -0 from a negative rounding", () => {
    // mean of (+1, -1, -1) = -0.33, which Math.round alone turns into -0.
    const ev = evidence({ durationMin: 90, powerZoneTimes: [0, 3300, 1500, 960, 540, 180, 660] });
    const score = scoreOf(
      [obj("zone-emphasis", { zone: "Z2" }), obj("zone-emphasis", { zone: "Z4" }), obj("zone-emphasis", { zone: "Z5" })],
      ev
    );
    expect(score).toBe(5);
    expect(Object.is(score, -0)).toBe(false);
  });

  it("assessScoreability applies the three predicates in order", () => {
    expect(assessScoreability({ confidence: "low", gradableCount: 3, scopeMin: 90, rideMin: 90 })).toMatchObject({
      scoreable: false,
      reason: "intent-unreliable",
    });
    expect(assessScoreability({ confidence: "high", gradableCount: 0, scopeMin: 90, rideMin: 90 })).toMatchObject({
      scoreable: false,
      reason: "no-measurable-objectives",
    });
    expect(assessScoreability({ confidence: "high", gradableCount: 1, scopeMin: 9, rideMin: 118 })).toMatchObject({
      scoreable: false,
      reason: "no-measurable-objectives",
    });
    expect(assessScoreability({ confidence: "medium", gradableCount: 1, scopeMin: 90, rideMin: 90 })).toMatchObject({
      scoreable: true,
      reason: null,
    });
  });
});
