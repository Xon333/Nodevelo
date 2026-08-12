import { describe, expect, it } from "vitest";
import { INTENT_MAX_PER_RUN, buildIntentQueue, needsParse, normalizeNote, noteFingerprint, primaryRideOfDate } from "./intent-queue";
import { buildRideScores } from "./score-log";
import type { ActivitySummary, IntentOverlay, RideScoreEntry } from "./types";

// Same shape as lib/score-log.test.ts's helper — deliberately, so the cross-module parity test below
// compares like with like and the two suites' fixtures can't drift apart.
function activity(over: Partial<ActivitySummary> & { date: string }): ActivitySummary {
  return {
    id: over.date,
    type: "Ride",
    name: "Ride",
    movingTimeSec: 3600,
    avgWatts: 180,
    normalizedPower: 185,
    maxWatts: 400,
    icuFtp: null,
    powerHrZ2: null,
    powerHrZ2Mins: null,
    avgHr: 140,
    maxHr: 165,
    kj: 600,
    activeBurnKcal: null,
    trainingLoad: 60,
    rpe: 5,
    carbsIngestedG: null,
    decoupling: 3,
    efficiencyFactor: 1.3,
    description: null,
    avgCadence: 88,
    distanceMeters: 30000,
    elevationGain: 300,
    powerZoneTimes: null,
    hrZoneTimes: null,
    hrrc: null,
    wPrimeRollingJ: null,
    wBalDepletionJ: null,
    ...over,
  };
}

// An off-plan ledger row. `activityId` is deliberately ABSENT by default: that is every row in the
// real ledger today (all of them predate Phase 2a), so the default fixture exercises the date path.
const ledger = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry => ({
  executionScore: 6,
  plannedType: null,
  inferredType: "Z2",
  planned: false,
  legacy: false,
  compliancePct: null,
  intensityFactor: 0.64,
  ftpUsed: 288,
  durationMin: 60,
  tss: 60,
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
  interpretation: null,
  scoringVersion: 1,
  schemaVersion: 1,
  createdAt: "2026-06-15T10:00:00.000Z",
  approvedAt: null,
  supersededBy: null,
  ...over,
});

// Turns a queue into the overlay store a successful run would have written, so a test can assert the
// SECOND call dequeues them. Mirrors the runner's `(activityId, noteFingerprint)` keying, nothing more.
const asWritten = (queue: ReturnType<typeof buildIntentQueue>): IntentOverlay[] =>
  queue.map((item, i) =>
    overlay({ id: `ov-${i}`, activityId: item.activityId, date: item.date, noteFingerprint: item.fingerprint })
  );

describe("normalizeNote / noteFingerprint", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeNote("  4x8   min\n\n  @ threshold  ")).toBe("4x8 min @ threshold");
  });

  it("treats an absent and a whitespace-only note as the same empty note", () => {
    // This is what makes "no note" idempotent rather than a permanent re-queue.
    expect(normalizeNote(null)).toBe("");
    expect(noteFingerprint(null)).toBe(noteFingerprint("   \n\t "));
    expect(noteFingerprint(null)).toBe(noteFingerprint(""));
  });

  it("is a stable 16-hex-char digest that changes when the note changes", () => {
    expect(noteFingerprint("easy spin")).toMatch(/^[0-9a-f]{16}$/);
    expect(noteFingerprint("easy spin")).toBe(noteFingerprint("easy   spin"));
    expect(noteFingerprint("easy spin")).not.toBe(noteFingerprint("hard spin"));
  });
});

describe("autoFromDate — Phase 4's period is untouchable", () => {
  const acts = [
    activity({ date: "2026-08-05", id: "a-0805", description: "easy spin" }),
    activity({ date: "2026-08-06", id: "a-0806", description: "tempo blocks" }),
    activity({ date: "2026-08-07", id: "a-0807", description: "4x8 threshold" }),
  ];
  const entries = [ledger({ date: "2026-08-05" }), ledger({ date: "2026-08-06" }), ledger({ date: "2026-08-07" })];

  it("drops every candidate before the boundary", () => {
    const q = buildIntentQueue(acts, entries, [], "2026-08-07", "2026-08-07");
    expect(q.map((i) => i.date)).toEqual(["2026-08-07"]); // 08-05, 08-06 are Phase 4's
  });

  it("drops them even under force — force bypasses idempotency, never the boundary", () => {
    const q = buildIntentQueue(acts, entries, [], "2026-08-07", "2026-08-07", { force: ["a-0805"] });
    expect(q.find((i) => i.activityId === "a-0805")).toBeUndefined();
    expect(q.map((i) => i.activityId)).toEqual(["a-0807"]);
  });

  it("includes a ride exactly ON the boundary", () => {
    const q = buildIntentQueue(acts, entries, [], "2026-08-07", "2026-08-06"); // >= not >
    expect(q.map((i) => i.date)).toEqual(["2026-08-07", "2026-08-06"]);
  });

  it("enqueues nothing at all when no boundary has been persisted yet", () => {
    // Fail-closed. `autoFromDate` is what stands between 2b and the historical no-block period, so an
    // unset boundary must mean "auto-process nothing", never "auto-process everything". The runner
    // persists it before the first queue build; this is the guard for when it somehow didn't.
    expect(buildIntentQueue(acts, entries, [], "2026-08-07", null)).toEqual([]);
    expect(buildIntentQueue(acts, entries, [], "2026-08-07", undefined)).toEqual([]);
    expect(buildIntentQueue(acts, entries, [], "2026-08-07", undefined, { force: ["a-0807"] })).toEqual([]);
  });
});

describe("ledger/primary binding (question 9)", () => {
  const acts = [
    activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800, description: "x" }),
    activity({ date: "2026-01-05", id: "long", movingTimeSec: 5400, description: "x" }),
  ];

  it("skips a date where the ledger scored a different ride than primaryRideOfDate", () => {
    // The resolver uses the ACTIVITY index for a row that has an id and never falls back to the date
    // index for it, so an overlay bound to the wrong ride resolves against nothing — silently, from
    // both sides. Skip and warn; never guess.
    const entries = [ledger({ date: "2026-01-05", planned: false, activityId: "short" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01")).toEqual([]);
  });

  it("reports the mismatch rather than swallowing it", () => {
    const entries = [ledger({ date: "2026-01-05", activityId: "short" })];
    const warnings: string[] = [];
    buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01", { warnings });
    expect(warnings).toEqual(["intent: ledger/primary mismatch on 2026-01-05"]);
  });

  it("enqueues a row whose activityId AGREES with the primary ride", () => {
    const entries = [ledger({ date: "2026-01-05", activityId: "long" })];
    const q = buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01");
    expect(q.map((i) => i.activityId)).toEqual(["long"]);
  });

  it("allows a pre-2a row with NO activityId and binds to the primary ride", () => {
    // Every row in the real ledger today is this case.
    const entries = [ledger({ date: "2026-01-05", planned: false })]; // activityId absent
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01").map((i) => i.activityId)).toEqual(["long"]);
  });

  it("never enqueues the secondary ride of a date", () => {
    // The date-keyed overlay index is not primary-ride-aware, so at most one active overlay per date
    // is what keeps the legacy resolution path safe. That guarantee lives here.
    const entries = [ledger({ date: "2026-01-05" })];
    const q = buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01");
    expect(q).toHaveLength(1);
    expect(q[0].durationMin).toBe(90);
  });
});

describe("needsParse — lifecycle walk", () => {
  it("decides correctly across absent → active → edited → superseded → disabled", () => {
    expect(needsParse("a1", "fp-1", [])).toBe(true); // never parsed

    const active = overlay({ activityId: "a1", noteFingerprint: "fp-1" });
    expect(needsParse("a1", "fp-1", [active])).toBe(false); // already done

    expect(needsParse("a1", "fp-2", [active])).toBe(true); // note edited → new fingerprint

    const superseded = overlay({ activityId: "a1", noteFingerprint: "fp-1", supersededBy: "ov-9" });
    expect(needsParse("a1", "fp-1", [superseded])).toBe(true); // interpreted a note that no longer exists

    const disabled = overlay({ activityId: "a1", noteFingerprint: "fp-1", status: "disabled" });
    expect(needsParse("a1", "fp-1", [disabled])).toBe(false); // a human turned it off
  });

  it("does NOT re-parse a disabled or a pending record", () => {
    // The skip test reads ALL overlays, not the applicable ones. Using `isApplicable` here — the
    // natural-looking choice — would re-parse and re-bill every disabled and pending record on every
    // sync, resurrecting deliberate human decisions and racing Phase 4's reviewer.
    for (const status of ["disabled", "pending"] as const) {
      const existing = [overlay({ activityId: "a1", noteFingerprint: "fp-1", status })];
      expect(needsParse("a1", "fp-1", existing)).toBe(false);
      expect(buildIntentQueue(
        [activity({ date: "2026-01-05", id: "a1", description: "note" })],
        [ledger({ date: "2026-01-05" })],
        [overlay({ activityId: "a1", noteFingerprint: noteFingerprint("note"), status })],
        "2026-01-10",
        "2026-01-01"
      )).toEqual([]);
    }
  });

  it("ignores a record belonging to a different activity", () => {
    const other = overlay({ activityId: "a2", noteFingerprint: "fp-1" });
    expect(needsParse("a1", "fp-1", [other])).toBe(true);
  });
});

describe("primaryRideOfDate", () => {
  const ftp = () => 288;

  it("matches the activityId buildRideScores stamps, ties included", () => {
    // Cross-module: buildRideScores keeps the FIRST ride on an exact tie (strict `>`). A helper using
    // `>=` would bind an overlay to a ride the ledger never scored — invisible to either module alone.
    const fixtures: Array<{ label: string; acts: ActivitySummary[] }> = [
      {
        label: "two rides of different length",
        acts: [
          activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800 }),
          activity({ date: "2026-01-05", id: "long", movingTimeSec: 5400 }),
        ],
      },
      {
        label: "exactly tied durations",
        acts: [
          activity({ date: "2026-01-05", id: "first", movingTimeSec: 3600 }),
          activity({ date: "2026-01-05", id: "second", movingTimeSec: 3600 }),
        ],
      },
      {
        label: "tied after rounding to whole minutes",
        // buildRideScores compares ROUNDED minutes, not raw seconds: 3610s and 3629s are both 60 min,
        // so the first still wins. A helper comparing movingTimeSec would pick the second.
        acts: [
          activity({ date: "2026-01-05", id: "first", movingTimeSec: 3610 }),
          activity({ date: "2026-01-05", id: "second", movingTimeSec: 3629 }),
        ],
      },
    ];

    for (const { label, acts } of fixtures) {
      const stamped = buildRideScores(null, acts, ftp, "2026-01-10", "2026-01-01")[0];
      expect(stamped, label).toBeDefined();
      expect(primaryRideOfDate(acts, "2026-01-05")?.id, label).toBe(stamped.activityId);
    }
  });

  it("ignores non-ride activities and zero-length rides", () => {
    const acts = [
      activity({ date: "2026-01-05", id: "gym", type: "WeightTraining", movingTimeSec: 7200 }),
      activity({ date: "2026-01-05", id: "ride", movingTimeSec: 1800 }),
      activity({ date: "2026-01-05", id: "empty", movingTimeSec: 0 }),
    ];
    expect(primaryRideOfDate(acts, "2026-01-05")?.id).toBe("ride");
    expect(primaryRideOfDate(acts, "2026-01-06")).toBeNull();
  });
});

describe("buildIntentQueue — candidate rules", () => {
  it("never enqueues a prescribed ride", () => {
    // Decision #14: a post-ride note can never redefine a formal session after the fact.
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "felt great, went long" })];
    const entries = [ledger({ date: "2026-01-05", planned: true, plannedType: "Z2" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01")).toEqual([]);
  });

  it("enqueues a note-less ride so it gets a deterministic no-intent-found", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: null })];
    const entries = [ledger({ date: "2026-01-05" })];
    const q = buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01");
    expect(q).toHaveLength(1);
    expect(q[0].note).toBe("");
    expect(q[0].fingerprint).toBe(noteFingerprint(null));
  });

  it("drops a future-dated ride", () => {
    const acts = [
      activity({ date: "2026-01-05", id: "a1", description: "n" }),
      activity({ date: "2026-01-11", id: "a2", description: "n" }),
    ];
    const entries = [ledger({ date: "2026-01-05" }), ledger({ date: "2026-01-11" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01").map((i) => i.date)).toEqual(["2026-01-05"]);
  });

  it("drops a ride whose date has no ledger entry", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", description: "n" })];
    expect(buildIntentQueue(acts, [], [], "2026-01-10", "2026-01-01")).toEqual([]);
  });

  it("drops a ledger date with no matching activity", () => {
    expect(buildIntentQueue([], [ledger({ date: "2026-01-05" })], [], "2026-01-10", "2026-01-01")).toEqual([]);
  });

  it("carries the note, fingerprint and rounded duration of the primary ride", () => {
    const acts = [activity({ date: "2026-01-05", id: "a1", movingTimeSec: 5430, description: "  90 min   Z2  " })];
    const entries = [ledger({ date: "2026-01-05" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01")[0]).toEqual({
      activityId: "a1",
      date: "2026-01-05",
      note: "  90 min   Z2  ", // raw — the runner normalizes and truncates for the prompt
      fingerprint: noteFingerprint("90 min Z2"),
      durationMin: 91,
    });
  });

  it("orders newest first", () => {
    const acts = [
      activity({ date: "2026-01-03", id: "a3", description: "n" }),
      activity({ date: "2026-01-07", id: "a7", description: "n" }),
      activity({ date: "2026-01-05", id: "a5", description: "n" }),
    ];
    const entries = [ledger({ date: "2026-01-03" }), ledger({ date: "2026-01-07" }), ledger({ date: "2026-01-05" })];
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01").map((i) => i.date)).toEqual([
      "2026-01-07",
      "2026-01-05",
      "2026-01-03",
    ]);
  });

  it("is idempotent: a second call after the overlays land returns nothing", () => {
    const acts = [
      activity({ date: "2026-01-05", id: "a5", description: "endurance" }),
      activity({ date: "2026-01-06", id: "a6", description: null }),
    ];
    const entries = [ledger({ date: "2026-01-05" }), ledger({ date: "2026-01-06" })];
    const first = buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01");
    expect(first).toHaveLength(2);
    expect(buildIntentQueue(acts, entries, asWritten(first), "2026-01-10", "2026-01-01")).toEqual([]);
  });

  it("re-enqueues when the athlete edits the note", () => {
    const entries = [ledger({ date: "2026-01-05" })];
    const before = [activity({ date: "2026-01-05", id: "a5", description: "endurance" })];
    const written = asWritten(buildIntentQueue(before, entries, [], "2026-01-10", "2026-01-01"));
    const after = [activity({ date: "2026-01-05", id: "a5", description: "endurance + 3 sprints" })];
    expect(buildIntentQueue(after, entries, written, "2026-01-10", "2026-01-01")).toHaveLength(1);
  });

  it("force bypasses idempotency for the named ride only", () => {
    const acts = [
      activity({ date: "2026-01-05", id: "a5", description: "endurance" }),
      activity({ date: "2026-01-06", id: "a6", description: "tempo" }),
    ];
    const entries = [ledger({ date: "2026-01-05" }), ledger({ date: "2026-01-06" })];
    const written = asWritten(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01"));
    const q = buildIntentQueue(acts, entries, written, "2026-01-10", "2026-01-01", { force: ["a6"] });
    expect(q.map((i) => i.activityId)).toEqual(["a6"]);
  });

  it("does NOT slice to INTENT_MAX_PER_RUN — the runner does, so `remaining` stays honest", () => {
    const dates = ["01", "02", "03", "04", "05", "06", "07"].map((d) => `2026-01-${d}`);
    const acts = dates.map((date) => activity({ date, id: `a-${date}`, description: "n" }));
    const entries = dates.map((date) => ledger({ date }));
    expect(INTENT_MAX_PER_RUN).toBe(5);
    expect(buildIntentQueue(acts, entries, [], "2026-01-10", "2026-01-01")).toHaveLength(dates.length);
  });
});
