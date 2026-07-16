import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks, needsBaseGate, weeksSinceBase, nextBuildFocus, pickBuildFocus, draftSeasonArc, applyDeloadCadence, assignLoadTargets, backwardScheduleFromEvent, replanSeasonArc, achievedTssForPeriod, currentPeriod, periodForDate, periodsInRange, formatSeasonContext, validateSeasonFit, validateFocusMatch, validateSeasonPlanInput, roadmapView, suggestedBlockWeeks, filterGoalsByFocus, goalRelevanceForFocus, labelExposureWeeks, exposureFromSessions, FOCUS_LABELS, scoreFocusCandidates, selectBuildFocus, execQualityByFocus, FOCUS_TRAINABILITY, WEEKLY_INTENSITY_FLOOR, weeksSinceSeasonBreak, type SeasonDraftInput } from "./season";
import type { SeasonPlan, PlannedDay, FocusPeriod, AthleteModel } from "./types";

describe("FOCUS_LABELS", () => {
  it("gives 'general' an honest, non-noise label", () => {
    expect(FOCUS_LABELS.general).toBe("all phases");
  });
  it("covers every focus value", () => {
    for (const f of ["general", "aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen"] as const) {
      expect(FOCUS_LABELS[f]).toBeTruthy();
    }
  });
});

describe("season constants + helpers", () => {
  it("encodes the KB deload cadence (3:1 default, 2:1 tight)", () => {
    expect(SEASON_CONSTANTS.deloadEveryWeeks).toBe(4);
    expect(SEASON_CONSTANTS.deloadTightEveryWeeks).toBe(3);
  });
  it("rotates threshold → vo2max → durability by default (KB variety)", () => {
    expect(defaultBuildOrder()).toEqual(["threshold", "vo2max", "durability"]);
  });
  it("adds whole weeks UTC-safe", () => {
    expect(addWeeks("2026-07-01", 3)).toBe("2026-07-22");
  });
});

const baseInput = (over: Partial<SeasonDraftInput> = {}): SeasonDraftInput => ({
  objective: "get faster", events: [], ctl: 60, ftp: 280, recentWeeklyTss: 420,
  limiter: { system: null, confidence: "low" }, recentFocuses: ["aerobic-base", "threshold"], heavyFatigue: false, ...over,
});

describe("draftSeasonArc — Mode-C", () => {
  it("base-gates when no aerobic-base sits in the recent window", () => {
    expect(needsBaseGate([])).toBe(true); // first-ever draft leads with base
    expect(needsBaseGate(["threshold", "vo2max", "durability", "threshold"])).toBe(true);
    expect(needsBaseGate(["aerobic-base", "threshold"])).toBe(false);
  });

  it("picks the weakest system first when the limiter is confident, else default rotation", () => {
    expect(nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])).toBe("vo2max");
    // low-confidence limiter → default order, skipping a back-to-back repeat
    expect(nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])).toBe("vo2max");
  });

  it("never repeats a focus back-to-back", () => {
    expect(nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])).not.toBe("threshold");
  });

  it("confident-limiter rotation eventually surfaces every build focus — not a two-state trap", () => {
    // Real athlete case: limiter = confident anaerobic. The old fallback alternated
    // anaerobic → threshold forever; vo2max and durability were structurally unreachable.
    const limiter = { system: "anaerobic" as const, confidence: "high" as const };
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = nextBuildFocus(limiter, recent);
      picks.push(f);
      recent.push(f);
    }
    expect(picks).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold", "anaerobic", "threshold"]); // the old trap
    expect(picks).toContain("vo2max");
    expect(picks).toContain("durability");
    // The limiter still leads every other period; the interleaved periods rotate least-recently-used.
    expect(picks).toEqual(["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "threshold"]); // scored selector (coverage plan) — supersedes the interim LRU sequence
  });

  it("REGRESSION: the fallback is least-recently-used, not first-in-default-order", () => {
    // Old code returned "threshold" for both of these unconditionally (first non-last entry of
    // defaultBuildOrder), even when vo2max/durability had never appeared at all.
    expect(nextBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold", "anaerobic"])).toBe("vo2max");
    expect(nextBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold", "vo2max", "anaerobic"])).toBe("durability");
  });

  it("drafts base(if gated) → rotating build periods → a realize week, dated contiguously", () => {
    const arc = draftSeasonArc(baseInput({ recentFocuses: [] }), "2026-07-01");
    expect(arc[0].focus).toBe("aerobic-base");
    expect(arc[0].startDate).toBe("2026-07-01");
    expect(arc[1].startDate).toBe(addWeeksExpected(arc[0])); // contiguous
    expect(arc.some((p) => p.focus === "sharpen")).toBe(true); // realize week present
    expect(arc.every((p) => p.source === "derived")).toBe(true);
  });
  it("drafted arcs carry a monotonically ramping load envelope — no 0.6x plateau, no taper-week spike", () => {
    // baseInput's recentFocuses includes aerobic-base → no base gate → exactly horizonPeriods (5) periods.
    const arc = draftSeasonArc(baseInput({ recentWeeklyTss: 806 }), "2026-07-01");
    expect(arc).toHaveLength(5);
    // Every 3-4-week period trips the 3:1 cadence; only the 1-week sharpen doesn't — the real pathology shape.
    expect(arc.map((x) => x.deloadWeek)).toEqual([true, true, true, true, false]);
    const targets = arc.map((x) => x.targetWeeklyTss!);
    expect(targets).toEqual([854, 905, 959, 1017, 1048]);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]); // never a spike after a plateau
    }
  });
});

describe("pickBuildFocus — LRU + limiter-weighted build selection", () => {
  it("prefers a confident limiter when it wasn't just used", () => {
    expect(pickBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold"])).toBe("anaerobic");
    expect(pickBuildFocus({ system: "durability", confidence: "medium" }, [])).toBe("durability");
  });
  it("never repeats the most recent focus — even the limiter", () => {
    expect(pickBuildFocus({ system: "anaerobic", confidence: "high" }, ["anaerobic"])).not.toBe("anaerobic");
  });
  it("falls back to the least-recently-used candidate across ALL four build systems", () => {
    // anaerobic has never appeared — the fixed [threshold, vo2max, durability] cycle could never pick it
    expect(pickBuildFocus({ system: null, confidence: "low" }, ["threshold", "vo2max", "durability"])).toBe("anaerobic");
    // durability is the most starved candidate here (oldest last appearance)
    expect(pickBuildFocus({ system: null, confidence: "low" }, ["durability", "anaerobic", "threshold", "vo2max"])).toBe("durability");
    // a low-confidence limiter gets no special weighting
    expect(pickBuildFocus({ system: "anaerobic", confidence: "low" }, ["anaerobic"])).toBe("threshold");
  });
  it("tie-breaks never-used candidates in BUILD_FOCI order", () => {
    expect(pickBuildFocus({ system: null, confidence: "low" }, [])).toBe("threshold");
  });
});

describe("backwardScheduleFromEvent — build rotation quality (the athlete's live KOM path)", () => {
  const ev = { name: "Alpe KOM", date: "2026-12-01", priority: "A" as const }; // 21-wk runway from 2026-07-01
  it("reaches anaerobic in a long runway (the fixed 3-focus cycle never did)", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(arc.filter((p) => p.phase === "build").map((p) => p.focus)).toContain("anaerobic");
  });
  it("schedules a confident limiter into the runway, landing nearest the peak", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput({ limiter: { system: "anaerobic", confidence: "high" } }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build");
    expect(builds[builds.length - 1].focus).toBe("anaerobic"); // last build before peak — the most race-specific slot
  });
  it("never repeats a focus back-to-back within the runway", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput({ limiter: { system: "vo2max", confidence: "high" } }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build");
    for (let i = 1; i < builds.length; i++) expect(builds[i].focus).not.toBe(builds[i - 1].focus);
  });
});

function addWeeksExpected(p: { startDate: string; plannedWeeks: number }): string {
  return new Date(Date.parse(p.startDate) + p.plannedWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

describe("load envelope", () => {
  const p = (): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: 3,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("ramps ~+6% off the seed, capped by ACWR", () => {
    const out = assignLoadTargets([p(), p(), p()], 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss!).toBeGreaterThan(out[0].targetWeeklyTss!);
    // never a jump beyond the ACWR ceiling vs the seed-derived chronic
    expect(out[2].targetWeeklyTss! / 400).toBeLessThanOrEqual(1.3 + 0.001);
  });
  it("withholds targets when there is no seed (no FTP/CTL)", () => {
    expect(assignLoadTargets([p()], null, 1.3)[0].targetWeeklyTss).toBeNull();
  });
  it("ignores deloadWeek entirely — every period ramps and the base always advances (the lighter week lives inside the block, not in this envelope)", () => {
    const periods = [
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: true }, // flagged: the TRAILING week is lighter — but the loading-week target still ramps
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
    ];
    const out = assignLoadTargets(periods, 400, 1.3);
    expect(out.map((x) => x.targetWeeklyTss)).toEqual([424, 449, 476, 505, 520]); // +6% each, last capped at 400 * 1.3
    expect(out[2].deloadWeek).toBe(true); // the flag itself is untouched — display/prompt consumers still see it
  });
  it("real cadence shape (every multi-week period flagged) ramps off the seed instead of freezing at 0.6x", () => {
    // Real generated-season shape: every 3-4-week period trips the 3:1 boundary and carries
    // deloadWeek: true; only the single-week sharpen doesn't. Seed = this athlete's real
    // 90-day baseline x 7 ~= 806. The old bug produced [484, 484, 484, 484, 854] — a 0.6x
    // plateau with the nominal taper week spiking +76% above it.
    const flagged = (weeks: number, deload: boolean) => ({ ...p(), plannedWeeks: weeks, deloadWeek: deload });
    const out = assignLoadTargets(
      [flagged(4, true), flagged(3, true), flagged(4, true), flagged(3, true), flagged(1, false)],
      806,
      1.3
    );
    expect(out.map((x) => x.targetWeeklyTss)).toEqual([854, 905, 959, 1017, 1048]); // +6% ramp, capped at round(806 * 1.3)
  });
});

describe("deload cadence", () => {
  const p = (weeks: number): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: weeks,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("flags a deload after ~3 loading weeks (3:1 default)", () => {
    const out = applyDeloadCadence([p(2), p(2), p(2)], false); // cumulative 2,4,6 wk
    expect(out[0].deloadWeek).toBe(false); // 2 wk in
    expect(out[1].deloadWeek).toBe(true); // crosses the 4-week (3:1) boundary
    expect(out[2].deloadWeek).toBe(false); // counter reset after the deload — next period is only 2 wk in
  });
  it("tightens to 2:1 under heavy fatigue", () => {
    const out = applyDeloadCadence([p(2), p(2)], true); // boundary at 3 wk
    expect(out[0].deloadWeek).toBe(true);
    expect(out[1].deloadWeek).toBe(true); // after reset, the next 2-wk period hits the 2:1 boundary again
  });
});

describe("event-anchored mode (dormant until an A-event exists)", () => {
  it("back-fills taper → peak ending on the A-date, build/base before", () => {
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    const last = arc[arc.length - 1];
    expect(last.phase).toBe("taper");
    // taper ends on (or just before) the event date
    expect(new Date(addWeeksExpected(last)).getTime()).toBeGreaterThanOrEqual(Date.parse("2026-09-29"));
    expect(arc.some((p) => p.phase === "peak")).toBe(true);
    expect(arc[0].startDate).toBe("2026-07-01");
  });
  it("clamps to a taper-only when the runway is too short", () => {
    const ev = { name: "KOM", date: "2026-07-10", priority: "A" as const };
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(arc.every((p) => p.phase === "taper" || p.phase === "peak")).toBe(true);
  });
  it("draftSeasonArc routes to the event scheduler only for a future A-event", () => {
    const arc = draftSeasonArc(baseInput({ events: [{ name: "X", date: "2026-10-01", priority: "A" }] }), "2026-07-01");
    expect(arc.some((p) => p.phase === "taper")).toBe(true);
  });
  it("never applies deload cadence to the event-anchored tail — peak/taper are exempt", () => {
    // 13-week runway: build 3wk → build 4wk → peak 5wk → taper 1wk — this is the exact shape that
    // previously crossed the 3:1 deload boundary on the peak block (Task 5 review finding).
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const direct = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(direct.some((p) => p.deloadWeek)).toBe(false);
    expect(direct.every((p) => p.deloadWeek === false)).toBe(true);
    // Also verify via draftSeasonArc's routing into event mode with the same runway.
    const routed = draftSeasonArc(baseInput({ events: [{ name: "Gran Fondo", date: "2026-10-01", priority: "A" }] }), "2026-07-01");
    expect(routed.some((p) => p.deloadWeek)).toBe(false);
  });
});

const planWith = (periods: SeasonPlan["periods"]): SeasonPlan => ({ objective: "get faster", events: [], periods, updatedAt: "" });

describe("replanSeasonArc", () => {
  const achieved = () => 400;
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = replanSeasonArc(planWith([past]), baseInput(), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("preserves a future override period", () => {
    // Starts 2026-07-15 (after today, 2026-07-01) — a pure future override, does not straddle today,
    // so it must land in the `overrides` bucket, not the new `current` bucket.
    const ovr = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "mine", source: "override" as const, confidence: "high" as const };
    const out = replanSeasonArc(planWith([ovr]), baseInput(), achieved, "2026-07-01");
    expect(out.periods.some((p) => p.source === "override" && p.rationale === "mine")).toBe(true);
  });
  it("is idempotent on unchanged inputs", () => {
    // `a` is a fresh draft from an empty plan: its first period (aerobic-base) starts exactly at
    // "2026-07-01", so it straddles that same `today` and gets swept into the new `current` bucket on
    // the NEXT call — that transition (nothing preserved → something preserved) legitimately changes
    // the horizon-relative redraft, so a → b is not required to be a no-op. The real idempotency
    // contract is a fixed point: once a plan HAS been through a re-plan (so the straddling period is
    // already sitting in it), replanning again with the same `today` must reproduce exactly the same
    // periods. So compare b → c, not a → b.
    const a = replanSeasonArc(planWith([]), baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    const b = replanSeasonArc(a, baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    const c = replanSeasonArc(b, baseInput({ recentFocuses: [] }), achieved, "2026-07-01");
    expect(c.periods.map((p) => p.focus + p.startDate)).toEqual(b.periods.map((p) => p.focus + p.startDate));
  });
  it("preserves the period straddling today verbatim, without stamping achievedTss", () => {
    // Starts before today, plannedWeeks pushes its end past today → straddles "today" (2026-07-01).
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanSeasonArc(planWith([current]), baseInput(), achieved, "2026-07-01");
    const preserved = out.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current); // unchanged: same focus/startDate/plannedWeeks/everything
    expect(preserved.achievedTss).toBeUndefined(); // not complete yet — must not be stamped
  });
  it("starts the redrafted tail strictly after the straddling period ends, not at today", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanSeasonArc(planWith([current]), baseInput(), achieved, "2026-07-01");
    const currentEnd = addWeeks(current.startDate, current.plannedWeeks); // 2026-07-13
    const firstDerived = out.periods.filter((p) => p.startDate > current.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    expect(firstDerived.startDate).toBe(currentEnd);
  });
  it("is idempotent for the current-period bucket specifically: re-running with the same today reproduces it unchanged", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const first = replanSeasonArc(planWith([current]), baseInput(), achieved, "2026-07-01");
    const second = replanSeasonArc(first, baseInput(), achieved, "2026-07-01");
    const preserved = second.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
  });
});

// Two contiguous periods used across the multi-period lookup/context/fit tests: base 2026-07-12 → 08-02
// (exclusive), then anaerobic build 08-02 → 08-23 — the real shape that broke 6-week generation.
const basePeriod = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-07-12", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 420, deloadWeek: false, rationale: "Base first.", source: "derived" as const, confidence: "medium" as const };
const buildPeriod = { focus: "anaerobic" as const, phase: "build" as const, startDate: "2026-08-02", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "Then build.", source: "derived" as const, confidence: "medium" as const };

describe("periodForDate / periodsInRange", () => {
  const plan = planWith([basePeriod, buildPeriod]);
  it("returns the period covering an arbitrary date (start inclusive, end exclusive)", () => {
    expect(periodForDate(plan, "2026-07-12")?.focus).toBe("aerobic-base");
    expect(periodForDate(plan, "2026-08-01")?.focus).toBe("aerobic-base"); // last base day
    expect(periodForDate(plan, "2026-08-02")?.focus).toBe("anaerobic"); // boundary day belongs to the NEXT period
    expect(periodForDate(plan, "2026-07-01")).toBeNull(); // before the plan
    expect(periodForDate(plan, "2026-09-01")).toBeNull(); // after the plan
  });
  it("matches currentPeriod's straddling definition exactly", () => {
    expect(periodForDate(plan, "2026-07-20")).toBe(currentPeriod(plan, "2026-07-20"));
  });
  it("lists every period an inclusive date range overlaps, in chronological order", () => {
    expect(periodsInRange(plan, "2026-07-20", "2026-08-30").map((p) => p.focus)).toEqual(["aerobic-base", "anaerobic"]);
    expect(periodsInRange(plan, "2026-07-13", "2026-07-20").map((p) => p.focus)).toEqual(["aerobic-base"]); // confined
    expect(periodsInRange(plan, "2026-08-01", "2026-08-02").map((p) => p.focus)).toEqual(["aerobic-base", "anaerobic"]); // touches the boundary from both sides
    expect(periodsInRange(plan, "2026-09-01", "2026-09-10")).toEqual([]); // outside every period
  });
});

describe("season context + fit validation", () => {
  const cur = { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-06-29", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const };
  it("formats a one-line season context for the prompt", () => {
    const line = formatSeasonContext(planWith([cur]), "2026-07-01")!;
    expect(line).toContain("SEASON CONTEXT");
    expect(line).toContain("vo2max");
    expect(line).toContain("450");
  });
  it("prepends the season objective when set", () => {
    const line = formatSeasonContext(planWith([cur]), "2026-07-01")!;
    expect(line.startsWith("SEASON CONTEXT: get faster — phase build")).toBe(true);
  });
  it("omits the objective prefix entirely when it's empty", () => {
    const plan = { ...planWith([cur]), objective: "" };
    const line = formatSeasonContext(plan, "2026-07-01")!;
    expect(line.startsWith("SEASON CONTEXT: phase build")).toBe(true);
    expect(line).not.toContain(" — phase"); // no stray separator with nothing before it
  });
  it("returns null when the plan has no current period", () => {
    expect(formatSeasonContext(planWith([]), "2026-07-01")).toBeNull();
  });
  it("COMPAT: a block range confined to one period produces byte-identical output to the rangeless call", () => {
    const plan = planWith([cur]); // cur covers 2026-06-29 → 07-27 (exclusive)
    const withRange = formatSeasonContext(plan, "2026-07-01", { startDate: "2026-07-01", endDate: "2026-07-14" });
    expect(withRange).toBe(formatSeasonContext(plan, "2026-07-01"));
    // and pin the exact legacy wording so a rewrite can't silently drift it
    expect(withRange).toBe("SEASON CONTEXT: get faster — phase build · focus vo2max · wk 1 of 4 · target ~450 TSS/wk. ");
  });
  it("describes the ordered sequence of periods a multi-period block spans, mapped to block weeks", () => {
    const threshold = { ...buildPeriod, focus: "threshold" as const, startDate: "2026-08-23", plannedWeeks: 4, rationale: "Then threshold." };
    const plan = planWith([basePeriod, buildPeriod, threshold]);
    // 6-week block 2026-07-20 → 2026-08-30 — the live case that spanned all three periods.
    const line = formatSeasonContext(plan, "2026-07-14", { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line.startsWith("SEASON CONTEXT: get faster — this block spans 3 season periods")).toBe(true);
    // segments appear in chronological order
    expect(line.indexOf("aerobic-base")).toBeLessThan(line.indexOf("anaerobic"));
    expect(line.indexOf("anaerobic")).toBeLessThan(line.indexOf("threshold"));
    // each segment carries its own split + block-week span (base covers block wk 1–2, ends 2026-08-01)
    expect(line).toContain("wk 1–2 (2026-07-20 → 2026-08-01): phase base · focus aerobic-base · 90/10 split");
    expect(line).toContain("phase build · focus anaerobic · 80/20 split");
    // the last segment is clipped to the block end, not the period end
    expect(line).toContain("2026-08-30");
    expect(line).not.toContain("2026-09");
  });
});

describe("validateSeasonFit — per-period, duration-weighted", () => {
  const plan = planWith([basePeriod, buildPeriod]);
  const day = (date: string, type: PlannedDay["type"], durationMin: number): PlannedDay =>
    ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText: "", description: "" });

  it("warns when a base-period block is hard by TIME share", () => {
    const days = [day("2026-07-13", "VO2max", 60), day("2026-07-14", "Z2", 60)]; // 50% of riding time hard
    const w = validateSeasonFit(days, plan, 280);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/base\/aerobic period \(90\/10\)/);
    expect(w[0]).toContain("50%");
  });
  it("does NOT fire on short quality touches a session COUNT would flag", () => {
    // 2 hard of 6 rides = 33% by count (the old check fired), but only 90/570 ≈ 16% of riding time.
    const days = [
      day("2026-07-13", "SIT", 45), day("2026-07-14", "Z2", 120), day("2026-07-15", "Z2", 120),
      day("2026-07-16", "Threshold", 45), day("2026-07-17", "Z2", 120), day("2026-07-18", "Z2", 120),
    ];
    expect(validateSeasonFit(days, plan, 280)).toEqual([]);
  });
  it("DOES fire when one long hard day dominates the time at a low session count", () => {
    // 1 hard of 5 rides = 20% by count (the old > 0.2 check stayed silent), but 300/420 ≈ 71% of time.
    const days = [
      day("2026-07-13", "RaceSim", 300), day("2026-07-14", "Z2", 30), day("2026-07-15", "Z2", 30),
      day("2026-07-16", "Z2", 30), day("2026-07-17", "Z2", 30),
    ];
    expect(validateSeasonFit(days, plan, 280).length).toBe(1);
  });
  it("checks each day against ITS OWN period — build-week quality is not blamed on the base period", () => {
    const days = [
      day("2026-07-27", "Z2", 120), day("2026-07-29", "Z2", 120), day("2026-08-01", "Z2", 90), // base portion: all easy
      day("2026-08-03", "VO2max", 60), day("2026-08-05", "Threshold", 75), day("2026-08-07", "Z2", 90), // build portion: quality is legitimate
    ];
    expect(validateSeasonFit(days, plan, 280)).toEqual([]);
  });
  it("scopes a warning to the date range of the period it belongs to", () => {
    const days = [
      day("2026-07-27", "Threshold", 75), day("2026-07-29", "VO2max", 60), day("2026-08-01", "Z2", 60), // base portion: 71% hard
      day("2026-08-03", "VO2max", 60), day("2026-08-05", "Z2", 90), // build portion
    ];
    const w = validateSeasonFit(days, plan, 280);
    expect(w.length).toBe(1);
    expect(w[0]).toContain("2026-07-27");
    expect(w[0]).toContain("2026-08-01");
    expect(w[0]).not.toContain("2026-08-03"); // the build days are not implicated
  });
  it("ignores rest/strength days and days not covered by any period", () => {
    const days = [day("2026-06-01", "VO2max", 60), day("2026-07-13", "Rest", 0), day("2026-07-14", "Strength", 45)];
    expect(validateSeasonFit(days, plan, 280)).toEqual([]);
  });
});

describe("roadmapView", () => {
  it("marks done / current / upcoming by date", () => {
    const periods = [
      { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const },
      { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-06-29", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const },
      { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-27", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 470, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const },
    ];
    const v = roadmapView(planWith(periods), "2026-07-01");
    expect(v.map((x) => x.status)).toEqual(["done", "current", "upcoming"]);
  });
});

describe("validateSeasonPlanInput", () => {
  it("accepts an objective + well-formed events", () => {
    const r = validateSeasonPlanInput({ objective: "get faster", events: [{ name: "GF", date: "2026-10-01", priority: "A" }] });
    expect(typeof r).not.toBe("string");
  });
  it("rejects a bad event date / priority", () => {
    expect(typeof validateSeasonPlanInput({ objective: "x", events: [{ name: "GF", date: "nope", priority: "A" }] })).toBe("string");
    expect(typeof validateSeasonPlanInput({ objective: "x", events: [{ name: "GF", date: "2026-10-01", priority: "Z" }] })).toBe("string");
  });
});

describe("suggestedBlockWeeks", () => {
  const period = (startDate: string, plannedWeeks: number): FocusPeriod => ({
    focus: "threshold", phase: "build", startDate, plannedWeeks, intensitySplit: "80/20",
    targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("ceilings to the smallest allowed value >= remaining weeks", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 4), "2026-07-01")).toBe(4); // 4 remaining -> 4
    expect(suggestedBlockWeeks(period("2026-07-01", 4), "2026-07-15")).toBe(2); // 2 remaining -> 2
    expect(suggestedBlockWeeks(period("2026-07-01", 8), "2026-07-08")).toBe(8); // 7 remaining -> 8
  });
  it("floors at 2 even with 1 or 0 weeks remaining", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 3), "2026-07-15")).toBe(2); // 1 wk left (or less) -> 2
    expect(suggestedBlockWeeks(period("2026-07-01", 2), "2026-07-15")).toBe(2); // period already over -> floor 2
  });
  it("caps at 8 for a long remaining runway", () => {
    expect(suggestedBlockWeeks(period("2026-07-01", 12), "2026-07-01")).toBe(8);
  });
});

describe("filterGoalsByFocus", () => {
  const g = (goal: string, focus: import("./types").SeasonFocus | "general") => ({ goal, target: "", focus });
  const goals = [g("A", "threshold"), g("B", "vo2max"), g("C", "general"), g("D", "durability")];
  it("includes focus-matching goals plus every general-tagged goal", () => {
    expect(filterGoalsByFocus(goals, "threshold").map((x) => x.goal)).toEqual(["A", "C"]);
  });
  it("returns every goal unfiltered when seasonFocus is null", () => {
    expect(filterGoalsByFocus(goals, null)).toEqual(goals);
  });
  it("returns only general-tagged goals when no goal matches the given focus", () => {
    expect(filterGoalsByFocus(goals, "anaerobic").map((x) => x.goal)).toEqual(["C"]);
  });
});

describe("goalRelevanceForFocus — goal text gates focus relevance", () => {
  it("an FTP goal weights threshold AND vo2max high (Odden 2024: both raise the ceiling), anaerobic zero", () => {
    const goal = "Raise my FTP from 280 to 300 W and hold it longer";
    expect(goalRelevanceForFocus(goal, "threshold")).toBe(1);
    expect(goalRelevanceForFocus(goal, "vo2max")).toBe(0.8);
    expect(goalRelevanceForFocus(goal, "durability")).toBe(0.3);
    expect(goalRelevanceForFocus(goal, "anaerobic")).toBe(0);
  });
  it("a sprint goal weights anaerobic, a long-event goal weights durability", () => {
    expect(goalRelevanceForFocus("win the town-sign sprint", "anaerobic")).toBe(1);
    expect(goalRelevanceForFocus("finish a 200km gran fondo strong", "durability")).toBe(1);
    expect(goalRelevanceForFocus("finish a 200km gran fondo strong", "threshold")).toBe(0.5);
  });
  it("neutral 0.5 for every focus when text is empty, absent, or matches nothing", () => {
    for (const f of ["threshold", "vo2max", "anaerobic", "durability"] as const) {
      expect(goalRelevanceForFocus(undefined, f)).toBe(0.5);
      expect(goalRelevanceForFocus("", f)).toBe(0.5);
      expect(goalRelevanceForFocus("just ride and have fun", f)).toBe(0.5);
    }
  });
  it("negation in the same clause suppresses a pattern (session-requirements' clause matcher)", () => {
    expect(goalRelevanceForFocus("no FTP targets this year, just consistency", "threshold")).toBe(0.5);
    // negation in an EARLIER clause does not reach across — the FTP tag stands
    expect(goalRelevanceForFocus("no racing, but raise my FTP", "threshold")).toBe(1);
  });
});

describe("decay-urgency signals — label fallback + real-session exposure", () => {
  it("labelExposureWeeks: weeks since the focus last ended, KB default weeks per label", () => {
    expect(labelExposureWeeks(["aerobic-base", "threshold"], "threshold")).toBe(0); // it IS the last label
    expect(labelExposureWeeks(["threshold", "vo2max"], "threshold")).toBe(4); // one vo2max period (4 wk) since
    expect(labelExposureWeeks(["anaerobic", "threshold", "vo2max"], "anaerobic")).toBe(8); // 4 + 4
    expect(labelExposureWeeks(["threshold", "vo2max"], "durability")).toBeNull(); // never appeared
    expect(labelExposureWeeks([], "threshold")).toBeNull();
  });
  it("exposureFromSessions: weeks since the latest qualifying REAL session per focus", () => {
    const days = [
      { date: "2026-06-17", type: "Threshold" as const, durationMin: 75 }, // 2 whole weeks before asOf
      { date: "2026-06-10", type: "SIT" as const, durationMin: 45 }, // 3 weeks
      { date: "2026-05-20", type: "Threshold" as const, durationMin: 75 }, // older — latest wins
    ];
    const exp = exposureFromSessions(days, 280, "2026-07-01");
    expect(exp.threshold).toBe(2);
    expect(exp.anaerobic).toBe(3); // SIT is the anaerobic session type
    expect(exp.vo2max).toBeUndefined(); // no real VO2max session → absent → caller falls back to labels
  });
  it("durability exposure requires embedded intensity or a template stamp — a plain Z2 spin does not count", () => {
    const plain = { date: "2026-06-24", type: "Z2" as const, durationMin: 120, workoutText: "- 2h 65%" };
    const loaded = { date: "2026-06-17", type: "Z2" as const, durationMin: 180, workoutText: "Main Set 3x\n- 8m 92%" };
    const stamped = { date: "2026-06-10", type: "Z2" as const, durationMin: 180, durabilityTemplate: "C" };
    expect(exposureFromSessions([plain], 280, "2026-07-01").durability).toBeUndefined();
    expect(exposureFromSessions([plain, loaded], 280, "2026-07-01").durability).toBe(2);
    expect(exposureFromSessions([plain, stamped], 280, "2026-07-01").durability).toBe(3);
  });
  it("ignores zero-duration days and days after asOf", () => {
    const days = [
      { date: "2026-07-05", type: "VO2max" as const, durationMin: 60 }, // future vs asOf
      { date: "2026-06-17", type: "VO2max" as const, durationMin: 0 }, // rest-shaped placeholder
    ];
    expect(exposureFromSessions(days, 280, "2026-07-01").vo2max).toBeUndefined();
  });
});

describe("scoreFocusCandidates / selectBuildFocus — goal × trainability × urgency × execution", () => {
  const noLimiter = { system: null, confidence: "low" as const };
  const anHigh = { system: "anaerobic" as const, confidence: "high" as const };

  it("encodes the trainability constants and the intensity floor (Hickson 1985 / Odden 2024)", () => {
    expect(FOCUS_TRAINABILITY).toEqual({ threshold: 1.0, vo2max: 0.9, durability: 0.6, anaerobic: 0.3 });
    expect(WEEKLY_INTENSITY_FLOOR).toBe(1); // ≥1 quality session/wk at high %FTP — satisfiable by ANY quality label
  });

  it("returns all four build foci with labeled parts summing to the score", () => {
    const scored = scoreFocusCandidates(noLimiter, []);
    expect(scored.map((s) => s.focus).sort()).toEqual(["anaerobic", "durability", "threshold", "vo2max"]);
    for (const s of scored) {
      const { goal, urgency, trainability, execution, limiter } = s.parts;
      expect(goal + urgency + trainability + execution + limiter).toBeCloseTo(s.score, 6);
    }
    // empty history, no signals: neutral goal/exec, never-seen urgency for all → trainability decides
    expect(scored[0].focus).toBe("threshold");
    expect(scored[0].score).toBeCloseTo(0.35 * 0.5 + 0.3 * 1.3 + 0.2 * 1.0 + 0.15 * 0.5, 6); // 0.84
  });

  it("(a) an FTP goal ranks threshold and vo2max above a confident anaerobic limiter — goal-driven, not deficit-greedy", () => {
    const scored = scoreFocusCandidates(anHigh, ["aerobic-base"], { goalText: "Raise my FTP from 280 to 300 W" });
    expect(scored.map((s) => s.focus)).toEqual(["threshold", "vo2max", "anaerobic", "durability"]);
    expect(scored[0].score).toBeCloseTo(1.015, 6); // 0.35·1 + 0.3·1.3 + 0.2·1 + 0.15·0.5
    expect(scored[2].parts.limiter).toBeCloseTo(0.2, 6); // the limiter bonus is visible — just outweighed
  });

  it("(b) decay-urgency surfaces whichever focus has been dark longest", () => {
    const scored = scoreFocusCandidates(noLimiter, [], { exposure: { threshold: 1, vo2max: 2, anaerobic: 1, durability: 26 } });
    expect(scored[0].focus).toBe("durability"); // 26 weeks dark beats every trainability advantage
  });

  it("(c) breaks the two-state oscillation: confident anaerobic limiter, growing history — vo2max AND durability surface", () => {
    // Same reproduction scenario as the critical-fixes sibling: the old selector alternated
    // anaerobic → threshold forever; vo2max and durability were structurally unreachable.
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = selectBuildFocus(anHigh, recent);
      picks.push(f);
      recent.push(f);
    }
    expect(picks).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold", "anaerobic", "threshold"]);
    expect(picks).toContain("vo2max");
    expect(picks).toContain("durability");
    expect(picks).toEqual(["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "threshold"]); // hand-traced
  });

  it("(d) trainability keeps a slow-responding limiter from dominating every slot", () => {
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = selectBuildFocus(anHigh, recent);
      picks.push(f);
      recent.push(f);
    }
    // Old behavior: anaerobic in every other slot (3 of 6). Scored: emphasis, not monopoly.
    expect(picks.filter((f) => f === "anaerobic").length).toBeLessThanOrEqual(2);
  });

  it("never returns the most recent focus — even the limiter", () => {
    expect(selectBuildFocus(anHigh, ["anaerobic"])).not.toBe("anaerobic");
  });

  it("poor execution on a focus hands a marginal FTP-goal slot to the alternative (explicit fourth factor)", () => {
    const goal = { goalText: "Raise my FTP from 280 to 300 W" };
    expect(selectBuildFocus(noLimiter, ["aerobic-base"], goal)).toBe("threshold");
    const flipped = selectBuildFocus(noLimiter, ["aerobic-base"], { ...goal, execQuality: { threshold: 2, vo2max: 9 } });
    expect(flipped).toBe("vo2max"); // threshold's recent execution is poor → weaker candidate for MORE emphasis
  });

  it("execQualityByFocus maps workout-type execution EWMAs onto build foci", () => {
    const stat = (type: import("./types").WorkoutType, execEwma: number) =>
      ({ type, n: 5, execEwma, complianceEwma: 90, trend: "flat" as const });
    const model: AthleteModel = {
      byType: [stat("Threshold", 3.2), stat("Z2", 7.1)],
      overallExecEwma: 6, overallTrend: "flat", sampleSize: 10,
      behaviour: { totalRides: 10, plannedRides: 8, unplannedRides: 2, offPlanPct: 20, unplannedAvgQuality: null, weeklyHours: 7 },
      behaviourAllTime: { totalRides: 40, plannedRides: 30, unplannedRides: 10, offPlanPct: 25, unplannedAvgQuality: null, weeklyHours: 7 },
    };
    expect(execQualityByFocus(model)).toEqual({ threshold: 3.2, durability: 7.1 });
  });
});

describe("draftSeasonArc — scored coverage selection (replaces the two-state/LRU selector)", () => {
  const anHigh = { system: "anaerobic" as const, confidence: "high" as const };
  it("one horizon reaches three of four build systems, then the arc cap re-touches base before a 4th build would cross 12wk (Task 2, 2026-07-15-season-macro-structure)", () => {
    // baseInput's recentFocuses = ["aerobic-base", "threshold"] → base gate silent, but seeds 4 loading
    // weeks already on the athlete's legs (weeksSinceBase). anaerobic(3) + vo2max(4) + durability(3) = 10
    // more → 14 consecutive loading weeks, which would cross arcWeeks.max (12) on the would-be 4th build
    // (threshold, 4wk) — so the arc cap substitutes an aerobic-base touch for that slot instead. This
    // supersedes the pre-arc-cap expectation (all four systems in one horizon): the cap is exactly what
    // stops an unbounded monotone build (Foster 1998), so a re-touch pre-empting the 4th build is correct.
    const arc = draftSeasonArc(baseInput({ limiter: anHigh }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build" && p.focus !== "sharpen").map((p) => p.focus);
    expect(builds).toEqual(["anaerobic", "vo2max", "durability"]);
    expect(arc.some((p) => p.focus === "aerobic-base" && p.rationale.includes("Arc boundary"))).toBe(true);
  });
  it("focusSignals flow through the draft: an FTP goal leads the arc with threshold/vo2max, not the anaerobic limiter", () => {
    const arc = draftSeasonArc(
      baseInput({ limiter: anHigh, recentFocuses: ["aerobic-base"], focusSignals: { goalText: "Raise my FTP from 280 to 300 W" } }),
      "2026-07-01"
    );
    const builds = arc.filter((p) => p.phase === "build" && p.focus !== "sharpen").map((p) => p.focus);
    expect(builds.slice(0, 2)).toEqual(["threshold", "vo2max"]);
    expect(builds[0]).not.toBe("anaerobic");
  });
  it("nextBuildFocus delegates to the scored selector (labels-only) — old contracts hold", () => {
    expect(nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])).toBe("vo2max"); // limiter bonus wins
    expect(nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])).toBe("vo2max"); // trainability tie-break
    expect(nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])).not.toBe("threshold"); // never repeat
  });
  it("REGRESSION (found live, 2026-07-15): real exposure for ALL foci must not freeze urgency for the whole draft — a never-yet-drafted focus must still surface within one horizon", () => {
    // Reproduces the exact live scenario: a confident anaerobic limiter, a goal mentioning both FTP
    // ("raise FTP") and sprint ("Sprint (0-30s)" weakpoint), and REAL exposure data for all four build
    // foci (as any athlete with a training history has) — none of it stale enough to hit
    // NEVER_SEEN_URGENCY on its own. Before the fix, vo2max/durability's real exposure never grew
    // across the draft (unlike labelExposureWeeks for whatever kept getting picked), so the draft
    // degenerated into anaerobic/threshold alternating forever — the exact pathology this whole plan
    // exists to prevent, just triggered by frozen real signals instead of a broken fallback array.
    const arc = draftSeasonArc(
      baseInput({
        limiter: anHigh,
        recentFocuses: ["aerobic-base"],
        focusSignals: {
          goalText: "Raise my FTP from 280 to 300 W. Weakpoint: Sprint (0-30s).",
          exposure: { threshold: 0, anaerobic: 0, vo2max: 3, durability: 2 }, // all real, all comparatively fresh
          execQuality: { threshold: 6.2, vo2max: 7, anaerobic: 7, durability: 6.8 },
        },
      }),
      "2026-07-01"
    );
    const builds = arc.filter((p) => p.phase === "build" && p.focus !== "sharpen").map((p) => p.focus);
    // vo2max surfaces at slot 3 — previously structurally impossible. Durability doesn't quite
    // overtake anaerobic within this specific 4-slot horizon (its urgency is still compounding); that's
    // an honest, expected outcome, not a regression — it will surface on a later replan or a longer
    // horizon as its own urgency keeps growing, exactly as labelExposureWeeks already does for anaerobic.
    // The would-be 4th build (anaerobic again, 3wk) would push consecutive loading to 11+3=14wk, crossing
    // arcWeeks.max (12) — the arc cap (Task 2, 2026-07-15-season-macro-structure) substitutes an
    // aerobic-base touch there instead, which is itself further confirmation the old two-focus trap is
    // broken: a real reset fires, not just a third focus appearing before the pattern would resume.
    expect(builds).toEqual(["anaerobic", "threshold", "vo2max"]);
    expect(builds).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold"]); // the old (re-)trap
    expect(builds).toContain("vo2max"); // the actual bug this test exists to catch
    expect(arc.some((p) => p.focus === "aerobic-base" && p.rationale.includes("Arc boundary"))).toBe(true);
  });
});

describe("validateFocusMatch — a period's label must match its generated sessions", () => {
  const day = (date: string, type: PlannedDay["type"], durationMin: number, workoutText = ""): PlannedDay =>
    ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText, description: "" });
  const vo2Period = { focus: "vo2max" as const, phase: "build" as const, startDate: "2026-08-02", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 450, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "high" as const };
  const duraPeriod = { ...vo2Period, focus: "durability" as const };

  it("flags a vo2max period whose block days carry zero VO2max sessions", () => {
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "Threshold", 75), day("2026-08-07", "Z2", 120),
      day("2026-08-10", "Threshold", 75), day("2026-08-12", "Z2", 120),
    ];
    const w = validateFocusMatch(days, planWith([vo2Period]), 280);
    expect(w.length).toBe(1);
    expect(w[0]).toContain("Season fit:");
    expect(w[0]).toContain("vo2max period");
    expect(w[0]).toContain("VO2max");
  });
  it("stays silent when the implied session type is present", () => {
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "VO2max", 60), day("2026-08-07", "Z2", 120),
      day("2026-08-10", "Threshold", 75), day("2026-08-12", "Z2", 120),
    ];
    expect(validateFocusMatch(days, planWith([vo2Period]), 280)).toEqual([]);
  });
  it("durability: a plain-Z2 week fails, an embedded-intensity Z2 week passes (carriesEmbeddedIntensity)", () => {
    const plain = [
      day("2026-08-03", "Z2", 150, "- 2h 65%"), day("2026-08-05", "Z2", 120, "- 2h 65%"),
      day("2026-08-10", "Z2", 180, "- 3h 65%"),
    ];
    expect(validateFocusMatch(plain, planWith([duraPeriod]), 280).length).toBe(1);
    const loaded = [
      day("2026-08-03", "Z2", 150, "- 2h 65%"),
      day("2026-08-10", "Z2", 180, "Warmup\n- 15m 55%\n\nMain Set 3x\n- 8m 92%"), // real durability insert
    ];
    expect(validateFocusMatch(loaded, planWith([duraPeriod]), 280)).toEqual([]);
  });
  it("does not fire when the block only brushes the period (< 7 calendar days of overlap)", () => {
    const days = [day("2026-08-03", "Z2", 120), day("2026-08-05", "Z2", 120)]; // 3-day span
    expect(validateFocusMatch(days, planWith([vo2Period]), 280)).toEqual([]);
  });
  it("ignores base/sharpen periods, rest/strength days, and uncovered dates", () => {
    const base = { ...vo2Period, focus: "aerobic-base" as const, phase: "base" as const };
    const days = [
      day("2026-08-03", "Z2", 120), day("2026-08-05", "Rest", 0), day("2026-08-07", "Strength", 45),
      day("2026-08-12", "Z2", 120), day("2026-09-20", "Z2", 120), // last date: no covering period
    ];
    expect(validateFocusMatch(days, planWith([base]), 280)).toEqual([]);
  });
});

describe("achievedTssForPeriod — real achieved load from the score-log ledger", () => {
  const period: FocusPeriod = {
    focus: "threshold", phase: "build", startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "80/20",
    targetWeeklyTss: 420, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  }; // covers 2026-06-01 → 2026-06-22 (exclusive)
  it("sums ledger tss inside [startDate, periodEnd) — end-exclusive, matching periodForDate", () => {
    const entries = [
      { date: "2026-06-01", tss: 80 }, // first day: in
      { date: "2026-06-10", tss: 100.4 },
      { date: "2026-06-21", tss: 50 }, // last covered day: in
      { date: "2026-06-22", tss: 999 }, // period end: OUT (exclusive)
      { date: "2026-05-31", tss: 999 }, // before: out
    ];
    expect(achievedTssForPeriod(entries, period)).toBe(230); // round(80 + 100.4 + 50)
  });
  it("skips null-tss entries but still sums the rest", () => {
    expect(achievedTssForPeriod([{ date: "2026-06-05", tss: null }, { date: "2026-06-06", tss: 120 }], period)).toBe(120);
  });
  it("returns null (not 0) when no in-range entry carries tss — no data is not zero load", () => {
    expect(achievedTssForPeriod([], period)).toBeNull();
    expect(achievedTssForPeriod([{ date: "2026-06-05", tss: null }], period)).toBeNull();
    expect(achievedTssForPeriod([{ date: "2026-07-05", tss: 300 }], period)).toBeNull(); // outside the range
  });
});

describe("bounded emphasis arcs (8–12 wk)", () => {
  it("encodes the arc bounds", () => {
    expect(SEASON_CONSTANTS.arcWeeks).toEqual({ min: 8, max: 12 });
  });
  it("estimates loading weeks since the last aerobic-base touch", () => {
    expect(weeksSinceBase([])).toBe(0);
    expect(weeksSinceBase(["aerobic-base"])).toBe(0);
    expect(weeksSinceBase(["aerobic-base", "threshold", "vo2max"])).toBe(8); // 4 + 4 KB default weeks
    expect(weeksSinceBase(["threshold", "durability"])).toBe(7); // no base anywhere → the whole history counts
  });
  it("inserts an aerobic-base touch before consecutive loading weeks exceed arcWeeks.max", () => {
    const arc = draftSeasonArc(baseInput(), "2026-07-01"); // seed: base already in the window → gate silent, 4 loading wk behind
    expect(needsBaseGate(baseInput().recentFocuses)).toBe(false); // proves the gate did NOT produce the base below
    expect(arc.some((p) => p.focus === "aerobic-base")).toBe(true); // the arc cap did
    // Invariant (selector-agnostic — survives the sibling plans' rotation fixes): no stretch of
    // consecutive loading periods exceeds the arc cap, counting the 4 weeks already on the athlete's
    // legs from the seeded threshold period. sharpen resets too — it is itself a lighter week.
    let run = 4;
    for (const p of arc) {
      if (p.focus === "aerobic-base" || p.focus === "sharpen") { run = 0; continue; }
      run += p.plannedWeeks;
      expect(run).toBeLessThanOrEqual(SEASON_CONSTANTS.arcWeeks.max);
    }
  });
  it("forces the reset at the cap even when the 4-period lookback still contains a base", () => {
    // 11 loading weeks since the base (4+4+3) — yet base is still inside needsBaseGate's window.
    expect(needsBaseGate(["aerobic-base", "threshold", "vo2max", "durability"])).toBe(false);
    const arc = draftSeasonArc(baseInput({ recentFocuses: ["aerobic-base", "threshold", "vo2max", "durability"] }), "2026-07-01");
    expect(arc[0].focus).toBe("aerobic-base"); // cap fires immediately: 11 + any build (3–4 wk) > 12
    expect(arc[0].rationale).toContain("Arc boundary");
  });
});

describe("season-break clock", () => {
  it("encodes the break cadence: ~2 arcs of loading, then a 2-week transition", () => {
    expect(SEASON_CONSTANTS.transitionEveryLoadingWeeks).toBe(20);
    expect(SEASON_CONSTANTS.transitionWeeks).toBe(2);
  });
  it("measures from the last transition's end, else the season start; null before anything started", () => {
    const build = (startDate: string): FocusPeriod => ({
      focus: "threshold", phase: "build", startDate, plannedWeeks: 4, intensitySplit: "80/20",
      targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
    });
    expect(weeksSinceSeasonBreak([], "2026-07-01")).toBeNull();
    expect(weeksSinceSeasonBreak([build("2099-01-01")], "2026-07-01")).toBeNull(); // nothing started yet
    expect(weeksSinceSeasonBreak([build("2026-01-12")], "2026-07-01")).toBe(24); // no break ever → since season start
    const transition: FocusPeriod = { ...build("2026-04-06"), phase: "transition", plannedWeeks: 2 }; // ends 2026-04-20
    expect(weeksSinceSeasonBreak([build("2026-01-12"), transition], "2026-07-01")).toBe(10); // from its END
  });
});

describe("genuine season break (phase transition) in the draft", () => {
  it("leads with a transition instead of a base touch when the break clock is overdue", () => {
    const arc = draftSeasonArc(baseInput({ recentFocuses: [], weeksSinceSeasonBreak: 24 }), "2026-07-01");
    expect(arc[0].phase).toBe("transition");
    expect(arc[0].focus).toBe("aerobic-base");
    expect(arc[0].plannedWeeks).toBe(SEASON_CONSTANTS.transitionWeeks);
    expect(arc[0].deloadWeek).toBe(false);
  });
  it("replaces the arc-boundary base touch with a transition when the clock runs out mid-draft — once", () => {
    const arc = draftSeasonArc(baseInput({ weeksSinceSeasonBreak: 24 }), "2026-07-01"); // default seed: no gate, 4 wk behind
    const idx = arc.findIndex((p) => p.phase === "transition");
    expect(idx).toBeGreaterThan(0); // mid-draft, at the arc cap — not the lead period
    expect(arc.filter((p) => p.phase === "transition").length).toBe(1); // the clock resets after the break
  });
  it("drafts a plain base touch when the clock is young or unknown", () => {
    const young = draftSeasonArc(baseInput({ weeksSinceSeasonBreak: 10 }), "2026-07-01");
    expect(young.every((p) => p.phase !== "transition")).toBe(true);
    expect(young.some((p) => p.focus === "aerobic-base")).toBe(true); // the arc cap still resets — just with base
    const unknown = draftSeasonArc(baseInput({ recentFocuses: [] }), "2026-07-01");
    expect(unknown.every((p) => p.phase !== "transition")).toBe(true);
  });
  it("replanSeasonArc feeds the break clock from the plan's own periods", () => {
    // Six frozen 4-week build periods = 24 calendar weeks of loading, no transition ever.
    const frozen: FocusPeriod[] = ["2026-01-12", "2026-02-09", "2026-03-09", "2026-04-06", "2026-05-04", "2026-06-01"].map((startDate, i) => ({
      focus: i % 2 === 0 ? "threshold" : "vo2max", phase: "build", startDate, plannedWeeks: 4,
      intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
    }));
    const out = replanSeasonArc(planWith(frozen), baseInput(), () => 400, "2026-07-01");
    const t = out.periods.find((p) => p.phase === "transition");
    expect(t).toBeDefined();
    expect(t!.startDate).toBe("2026-07-01"); // the redraft leads with the overdue break
  });
});
