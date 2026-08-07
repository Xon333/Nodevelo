import { describe, expect, it } from "vitest";
import { SEASON_CONSTANTS, defaultBuildOrder, addWeeks, backwardScheduleFromEvent, settleSeasonHistory, replanEventArc, achievedTssForPeriod, currentPeriod, periodForDate, periodsInRange, formatSeasonContext, formatRetestNote, formatUpcomingEventsForBlock, validateSeasonFit, validateFocusMatch, validateSeasonPlanInput, roadmapView, suggestedBlockWeeks, filterGoalsByFocus, goalRelevanceForFocus, labelExposureWeeks, exposureFromSessions, FOCUS_LABELS, scoreFocusCandidates, selectBuildFocus, execQualityByFocus, FOCUS_TRAINABILITY, WEEKLY_INTENSITY_FLOOR, chooseNextFocus, findUpcomingAEvent, isSeasonFocus, realWeeksSinceLastRecovery, planRecoveryWeeks, formatRecoveryWeeks, formatFocusContext, formatFocusCoverageLine, validateBlockFocus, validatePrimaryQualityCadence, projectSeasonOutlook, type SeasonDraftInput } from "./season";
import type { WeekTarget } from "./block-skeleton";
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

describe("selectBuildFocus — LRU + limiter-weighted build selection (used by chooseNextFocus + backwardScheduleFromEvent)", () => {
  it("prefers a confident limiter when it wasn't just used", () => {
    expect(selectBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold"])).toBe("anaerobic");
    expect(selectBuildFocus({ system: "durability", confidence: "medium" }, [])).toBe("durability");
  });
  it("never repeats the most recent focus — even the limiter", () => {
    expect(selectBuildFocus({ system: "anaerobic", confidence: "high" }, ["anaerobic"])).not.toBe("anaerobic");
  });
  it("falls back to the least-recently-used candidate across ALL four build systems", () => {
    // anaerobic has never appeared — the fixed [threshold, vo2max, durability] cycle could never pick it.
    // aerobic-base sits recently-touched (last) so it competes as a normal candidate without winning
    // this particular round — keeps this test's original intent (LRU among the four BUILD systems).
    expect(selectBuildFocus({ system: null, confidence: "low" }, ["durability", "threshold", "vo2max", "aerobic-base"])).toBe("anaerobic");
    // durability is the most starved candidate here (oldest last appearance)
    expect(selectBuildFocus({ system: null, confidence: "low" }, ["durability", "anaerobic", "threshold", "vo2max", "aerobic-base"])).toBe("durability");
    // a low-confidence limiter gets no special weighting
    expect(selectBuildFocus({ system: "anaerobic", confidence: "low" }, ["anaerobic"])).toBe("threshold");
  });
  it("tie-breaks never-used candidates in BUILD_FOCI order", () => {
    expect(selectBuildFocus({ system: null, confidence: "low" }, [])).toBe("threshold");
  });
});

describe("backwardScheduleFromEvent — build rotation quality (the athlete's live KOM path)", () => {
  // 30-wk runway from 2026-07-01 (was 21-wk/2026-12-01 before aerobic-base joined the build-focus
  // pool — with 5 candidates now sharing the same runway, 21 weeks' worth of slots run out on
  // {threshold, durability, vo2max, aerobic-base, threshold} before anaerobic's turn ever comes up;
  // a longer runway restores this block's original intent — anaerobic reachability — without
  // changing what it's actually testing).
  const ev = { name: "Alpe KOM", date: "2027-02-01", priority: "A" as const };
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
  it("never applies deload cadence to the event-anchored tail — peak/taper are exempt", () => {
    // 13-week runway: build 3wk → build 4wk → peak 5wk → taper 1wk — this is the exact shape that
    // previously crossed the 3:1 deload boundary on the peak block (Task 5 review finding).
    const ev = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
    const direct = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(direct.some((p) => p.deloadWeek)).toBe(false);
    expect(direct.every((p) => p.deloadWeek === false)).toBe(true);
  });
});

const planWith = (periods: SeasonPlan["periods"]): SeasonPlan => ({ objective: "get faster", events: [], periods, updatedAt: "" });

describe("settleSeasonHistory (rolling mode — season-continuous-focus-selection §4/§9)", () => {
  const achieved = () => 400;
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = settleSeasonHistory(planWith([past]), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("drops a future period entirely — rolling mode no longer preserves a forward-drafted tail of any kind", () => {
    const future = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "was an override", source: "override" as const, confidence: "high" as const };
    const out = settleSeasonHistory(planWith([future]), achieved, "2026-07-01");
    expect(out.periods).toHaveLength(0);
  });
  it("preserves the period straddling today verbatim, without stamping achievedTss", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = settleSeasonHistory(planWith([current]), achieved, "2026-07-01");
    const preserved = out.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
    expect(preserved.achievedTss).toBeUndefined();
  });
  it("is idempotent: settling an already-settled plan with the same today reproduces it unchanged", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const first = settleSeasonHistory(planWith([current]), achieved, "2026-07-01");
    const second = settleSeasonHistory(first, achieved, "2026-07-01");
    expect(second.periods).toEqual(first.periods);
  });
});

describe("replanEventArc (event-anchored mode — unchanged behavior, narrower entry point)", () => {
  const achieved = () => 400;
  const event = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([past]), event, baseInput(), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("preserves a future override period", () => {
    const ovr = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "mine", source: "override" as const, confidence: "high" as const };
    const out = replanEventArc(planWith([ovr]), event, baseInput(), achieved, "2026-07-01");
    expect(out.periods.some((p) => p.source === "override" && p.rationale === "mine")).toBe(true);
  });
  it("preserves the period straddling today verbatim, without stamping achievedTss", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const preserved = out.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
    expect(preserved.achievedTss).toBeUndefined();
  });
  it("starts the redrafted tail strictly after the straddling period ends, not at today", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const currentEnd = addWeeks(current.startDate, current.plannedWeeks);
    const firstDerived = out.periods.filter((p) => p.startDate > current.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    expect(firstDerived.startDate).toBe(currentEnd);
  });
  it("is idempotent for the current-period bucket specifically", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const first = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const second = replanEventArc(first, event, baseInput(), achieved, "2026-07-01");
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
  it("REGRESSION (found live, 2026-07-16): a deload-flagged segment spanning 2+ block weeks names ONLY its own trailing week as light, not the whole span", () => {
    // The exact live scenario: a 2-week aerobic-base segment (wk 1-2) flagged deloadWeek produced
    // TWO consecutive deload weeks in a real generation, because the old wording ("· deload week")
    // was attached to the whole "wk 1-2" range with no way to tell the model only wk 2 is light.
    const deloadBase = { ...basePeriod, deloadWeek: true };
    const plan = planWith([deloadBase, buildPeriod]);
    const line = formatSeasonContext(plan, "2026-07-14", { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line).toContain("wk 1–2 (2026-07-20 → 2026-08-01): phase base · focus aerobic-base · 90/10 split · target ~420 TSS/wk · deload in wk 2 ONLY — wk 1 still loads normally.");
    expect(line).not.toMatch(/wk 1–2[^.]*· deload week/); // the old, ambiguous whole-range wording must not reappear
  });
  it("names the single deload week plainly when the deload-flagged segment IS only one block-week wide", () => {
    const shortDeload = { ...basePeriod, plannedWeeks: 1, deloadWeek: true }; // 2026-07-12 -> 2026-07-19
    const anaerobicShifted = { ...buildPeriod, startDate: "2026-07-19" };
    const plan = planWith([shortDeload, anaerobicShifted]);
    const line = formatSeasonContext(plan, "2026-07-14", { startDate: "2026-07-13", endDate: "2026-08-16" })!;
    expect(line).toContain("wk 1 (2026-07-13 → 2026-07-18): phase base · focus aerobic-base · 90/10 split · target ~420 TSS/wk · deload week.");
  });
  it("does not call the LAST spanned segment deload at all when the block ends before reaching that period's own true final week", () => {
    const deloadBuild = { ...buildPeriod, deloadWeek: true }; // 2026-08-02 -> 2026-08-23 (3wk), real trailing wk starts 08-16
    const plan = planWith([basePeriod, deloadBuild]);
    // Block ends 2026-08-10 — well before deloadBuild's own periodEnd (2026-08-23), so its real
    // trailing week is never reached by this block; the clipped segment must not claim "deload".
    const line = formatSeasonContext(plan, "2026-07-14", { startDate: "2026-07-20", endDate: "2026-08-10" })!;
    expect(line).toContain("focus anaerobic");
    expect(line).not.toContain("deload");
  });
  it("single-period path: only calls it 'deload week' once we're actually IN the period's final week", () => {
    const deloadPeriod = { ...buildPeriod, deloadWeek: true, startDate: "2026-06-01" }; // 3wk: 06-01 -> 06-22
    const plan = planWith([deloadPeriod]);
    const early = formatSeasonContext(plan, "2026-06-05")!; // wk 1 of 3 — not the final week yet
    expect(early).toContain("wk 1 of 3");
    expect(early).toContain("deload arrives wk 3 (not yet — load normally now)");
    expect(early).not.toContain("· deload week");
    const final = formatSeasonContext(plan, "2026-06-18")!; // wk 3 of 3 — the real trailing week
    expect(final).toContain("wk 3 of 3");
    expect(final).toContain("· deload week");
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
    expect(FOCUS_TRAINABILITY).toEqual({ "aerobic-base": 0.9, threshold: 1.0, vo2max: 0.9, durability: 0.6, anaerobic: 0.3 });
    expect(WEEKLY_INTENSITY_FLOOR).toBe(1); // ≥1 quality session/wk at high %FTP — satisfiable by ANY quality label
  });

  it("returns all five foci (aerobic-base + the four build systems) with labeled parts summing to the score", () => {
    const scored = scoreFocusCandidates(noLimiter, []);
    expect(scored.map((s) => s.focus).sort()).toEqual(["aerobic-base", "anaerobic", "durability", "threshold", "vo2max"]);
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
    // aerobic-base is neutral on goal (0.5) and recently-touched here, so it lands last.
    expect(scored.map((s) => s.focus)).toEqual(["threshold", "vo2max", "anaerobic", "durability", "aerobic-base"]);
    expect(scored[0].score).toBeCloseTo(1.015, 6); // 0.35·1 + 0.3·1.3 + 0.2·1 + 0.15·0.5
    expect(scored[2].parts.limiter).toBeCloseTo(0.2, 6); // the limiter bonus is visible — just outweighed
  });

  it("(b) decay-urgency surfaces whichever focus has been dark longest", () => {
    // aerobic-base given fresh exposure (1wk) too — otherwise, with none of the four other real-exposure
    // signals covering it, it would fall back to NEVER_SEEN_URGENCY and (being foundational + highly
    // trainable) outscore durability's 26-week staleness, which isn't what this test is about.
    const scored = scoreFocusCandidates(noLimiter, [], { exposure: { threshold: 1, vo2max: 2, anaerobic: 1, durability: 26, "aerobic-base": 1 } });
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
    // hand-traced (now against the 5-candidate pool — aerobic-base itself surfaces at slot 6 once
    // every other focus has been recently touched and out-scores it on urgency)
    expect(picks).toEqual(["anaerobic", "threshold", "vo2max", "durability", "anaerobic", "aerobic-base"]);
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
      behaviour: { totalRides: 10, plannedRides: 8, unplannedRides: 2, offPlanPct: 20, driftAvgQuality: null, weeklyHours: 7 },
      behaviourAllTime: { totalRides: 40, plannedRides: 30, unplannedRides: 10, offPlanPct: 25, driftAvgQuality: null, weeklyHours: 7 },
    };
    // Z2 execEwma feeds BOTH durability and aerobic-base — same dimension, no finer distinction.
    expect(execQualityByFocus(model)).toEqual({ threshold: 3.2, durability: 7.1, "aerobic-base": 7.1 });
  });
});

describe("aerobic-base as a scored candidate (season-continuous-focus-selection §4)", () => {
  it("BUILD_FOCI now includes aerobic-base alongside the four build systems", () => {
    const scores = scoreFocusCandidates({ system: null, confidence: "low" }, []);
    expect(scores.map((s) => s.focus).sort()).toEqual(["aerobic-base", "anaerobic", "durability", "threshold", "vo2max"]);
  });

  it("goalRelevanceForFocus never penalizes aerobic-base to 0, even when another pattern fires", () => {
    expect(goalRelevanceForFocus("Raise my FTP", "aerobic-base")).toBe(0.5);
    expect(goalRelevanceForFocus(undefined, "aerobic-base")).toBe(0.5);
    expect(goalRelevanceForFocus("", "aerobic-base")).toBe(0.5);
  });

  it("execQualityByFocus maps aerobic-base onto the same Z2 dimension as durability", () => {
    const model: AthleteModel = {
      byType: [{ type: "Z2", n: 5, execEwma: 7.1, complianceEwma: 90, trend: "flat" as const }],
      overallExecEwma: 7, overallTrend: "flat" as const, sampleSize: 5,
      behaviour: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, driftAvgQuality: null, weeklyHours: 8 },
      behaviourAllTime: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, driftAvgQuality: null, weeklyHours: 8 },
    };
    const out = execQualityByFocus(model);
    expect(out["aerobic-base"]).toBe(7.1);
    expect(out["aerobic-base"]).toBe(out.durability);
  });

  it("exposureFromSessions splits plain Z2/Recovery (aerobic-base) from embedded-intensity Z2/Recovery (durability)", () => {
    const days = [
      { date: "2026-07-01", type: "Z2" as const, durationMin: 120, workoutText: "" }, // plain — no template, no embedded intensity
      { date: "2026-07-03", type: "Recovery" as const, durationMin: 300, durabilityTemplate: "B" }, // durability-templated
    ];
    const out = exposureFromSessions(days, 250, "2026-07-10");
    expect(out["aerobic-base"]).toBe(1); // whole weeks since 2026-07-01
    expect(out.durability).toBe(1); // whole weeks since 2026-07-03
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

describe("transition-period fit validation (validateSeasonFit — untouched by this task)", () => {
  it("warns when hard riding lands inside a transition period", () => {
    const day = (date: string, type: PlannedDay["type"], durationMin: number): PlannedDay =>
      ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText: "", description: "" });
    const transitionPeriod: FocusPeriod = {
      focus: "threshold", phase: "transition", startDate: "2026-07-12", plannedWeeks: 2,
      intensitySplit: "95/5", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
    };
    const plan = planWith([transitionPeriod]);
    const w = validateSeasonFit([day("2026-07-13", "VO2max", 60), day("2026-07-14", "Z2", 60)], plan, 280);
    expect(w.length).toBe(1);
    expect(w[0]).toContain("transition");
  });
});

describe("realWeeksSinceLastRecovery (season-continuous-focus-selection §5)", () => {
  it("returns 0 with no baseline (never force a cap blind)", () => {
    expect(realWeeksSinceLastRecovery([], null, "2026-07-01")).toBe(0);
    expect(realWeeksSinceLastRecovery([{ date: "2026-06-01", tss: 500 }], 0, "2026-07-01")).toBe(0);
  });

  it("finds the most recent week whose real TSS sits at/below 50% of the baseline", () => {
    const entries = [
      { date: "2026-06-15", tss: 90 }, // light week (exactly 3wk before 2026-07-06): 90 <= 400*0.5=200
      { date: "2026-06-22", tss: 380 }, // loading
      { date: "2026-06-29", tss: 410 }, // loading
      { date: "2026-07-01", tss: 60 }, // this week so far
    ];
    // "Today" is 2026-07-06, so the current 7-day window is [2026-06-30, 2026-07-06]: only the
    // 2026-07-01 entry falls in it (2026-06-29 is one day outside). Window ending 2026-07-06 (this
    // week, partial): 60 <= 200 → light. 0 weeks since.
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-07-06")).toBe(0);
  });

  it("counts real calendar weeks back to the last genuinely light week", () => {
    const entries = [
      { date: "2026-06-08", tss: 100 }, // light week, 3 weeks before 2026-06-29
      { date: "2026-06-15", tss: 420 },
      { date: "2026-06-22", tss: 410 },
      { date: "2026-06-29", tss: 430 }, // "today" — a loading week
    ];
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-06-29")).toBe(3);
  });

  it("gives up at the lookback cap when no light week exists in the ledger's history", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ date: addWeeks("2026-01-05", i), tss: 450 }));
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-07-27")).toBe(26);
  });
});

describe("planRecoveryWeeks", () => {
  it("places a recovery week on the block's own last day when a fresh block exactly reaches the cadence cap", () => {
    expect(planRecoveryWeeks(0, 4, false)).toEqual([3]); // 0+1+1+1+1=4 at index 3 — the block's own final week
  });
  it("forces week 1 (index 0) when already at/over the hard cap", () => {
    expect(planRecoveryWeeks(4, 4, false)).toEqual([0]);
    expect(planRecoveryWeeks(6, 2, false)).toEqual([0]);
  });
  it("places a recovery week exactly when the cumulative count reaches the cap, then repeats every `every` weeks", () => {
    expect(planRecoveryWeeks(2, 8, false)).toEqual([1, 5]); // 2+1+1=4 at index 1; resets; +4 more at index 5
  });
  it("uses the tighter 3-week cadence under heavy fatigue, repeating within a single longer block", () => {
    expect(planRecoveryWeeks(0, 6, true)).toEqual([2, 5]); // 0+1+1+1=3 at index 2; resets; +1+1+1=3 more at index 5
  });
});

describe("formatRecoveryWeeks", () => {
  it("returns null when there are no recovery weeks", () => {
    expect(formatRecoveryWeeks([], 4, "vo2max", 250)).toBeNull();
  });

  it("names the volume cut, the cap, the surviving type, and what is dropped entirely", () => {
    const line = formatRecoveryWeeks([2], 6, "vo2max", 250)!;
    expect(line).toContain("week 3");
    expect(line).toMatch(/30–50%/);
    expect(line).toMatch(/at most 1/i);
    expect(line).toContain("VO2max"); // the focus type is the one that survives
    expect(line).toMatch(/dropped entirely, not shortened/i);
    expect(line).toMatch(/no embedded/i); // the long ride carve-out
  });

  it("asks for zero quality when the focus has no single required session type", () => {
    const line = formatRecoveryWeeks([0], 2, "aerobic-base", 250)!;
    expect(line).toMatch(/no quality sessions/i);
  });

  // Fix 1 (2026-07-29 whole-branch review): durability HAS a focusSessionMatchers entry, but its
  // label describes a Z2 ride carrying embedded threshold+ work — exactly what this same message's
  // LONG RIDE bullet forbids ("no embedded threshold/VO2 efforts this week"). Asking for that
  // composition contradicted the long-ride carve-out in the same instruction, and the validator-side
  // fix (validateRecoveryWeekDensity flags ANY non-quality day with embedded intensity, not just the
  // long ride) meant a plan that followed the COMPOSITION bullet exactly still got flagged. A
  // durability block's recovery week must carry zero embedded work — same "no quality at all" branch
  // as aerobic-base/sharpen.
  it("asks for zero quality sessions for a durability focus, same as aerobic-base/sharpen — a durability recovery week must carry zero embedded work, not a disguised one", () => {
    const line = formatRecoveryWeeks([1], 8, "durability", 250)!;
    const compositionLine = line.split("\n").find((l) => l.startsWith("- COMPOSITION"))!;
    expect(compositionLine).toMatch(/no quality sessions/i);
    expect(compositionLine).not.toMatch(/embedded/i);
  });

  // Fix 2: the dropped-type enumeration used to be a single hardcoded string
  // "(SIT, VO2max, RaceSim, and any second ${m.label})" for every focus — correct only for
  // `threshold`. For vo2max/anaerobic it named the SURVIVOR as dropped and never named Threshold as
  // droppable at all. Now derived from QUALITY_TYPES minus the survivor.
  it("names Threshold as droppable and does not list the survivor as dropped — vo2max focus", () => {
    const line = formatRecoveryWeeks([2], 6, "vo2max", 250)!;
    const compositionLine = line.split("\n").find((l) => l.startsWith("- COMPOSITION"))!;
    // Isolate the dropped-types list from the trailing "and any second <survivor>" clause (still
    // inside the same parenthetical) — the survivor's name legitimately appears THERE, so matching
    // the whole parenthetical would pass without the fix actually applied.
    const parenthetical = compositionLine.match(/Every other quality type \(([^)]*)\)/)?.[1] ?? "";
    const droppedList = parenthetical.split(", and any second")[0];
    const namedTypes = droppedList.split(",").map((s) => s.trim());
    expect(namedTypes).toContain("Threshold");
    expect(namedTypes).not.toContain("VO2max");
  });

  it("names Threshold as droppable and does not list the survivor as dropped — anaerobic focus", () => {
    const line = formatRecoveryWeeks([2], 6, "anaerobic", 250)!;
    const compositionLine = line.split("\n").find((l) => l.startsWith("- COMPOSITION"))!;
    const parenthetical = compositionLine.match(/Every other quality type \(([^)]*)\)/)?.[1] ?? "";
    const droppedList = parenthetical.split(", and any second")[0];
    const namedTypes = droppedList.split(",").map((s) => s.trim());
    expect(namedTypes).toContain("Threshold");
    expect(namedTypes).not.toContain("SIT");
  });

  it("keeps verb and noun in agreement for a multi-week header (are recovery weeks, not are a recovery week)", () => {
    const line = formatRecoveryWeeks([1, 5], 8, "vo2max", 250)!;
    expect(line).toContain("are recovery weeks");
    expect(line).not.toContain("are a recovery week");
  });
});

describe("formatRetestNote (new signature — season-continuous-focus-selection §5)", () => {
  it("returns null when fresh", () => {
    expect(formatRetestNote(10, [], "2026-07-01")).toBeNull();
    expect(formatRetestNote(null, [], "2026-07-01")).toBeNull();
  });
  it("fires once stale, pointing at this block's own recovery week when one exists", () => {
    const note = formatRetestNote(60, [2], "2026-07-01");
    expect(note).toContain("RETEST DUE");
    expect(note).toContain(addWeeks("2026-07-01", 2));
  });
  it("fires with no slot line when this block has no recovery week", () => {
    const note = formatRetestNote(60, [], "2026-07-01");
    expect(note).toContain("RETEST DUE");
    expect(note).not.toContain("Best slot");
  });
});

describe("formatRetestNote — FTP retest cadence", () => {
  it("encodes the ~8-week cadence (intersection of the 6–8 and 8–12 wk coaching ranges — one arc)", () => {
    expect(SEASON_CONSTANTS.retestEveryWeeks).toBe(8);
  });
});

describe("formatUpcomingEventsForBlock — B/C-priority events inside the block's own date range", () => {
  it("lists a B-priority event that falls inside the block range, naming the date and asking it be protected", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "Areh FTP Test", date: "2026-07-22", priority: "B" }];
    const line = formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line).toContain("Areh FTP Test");
    expect(line).toContain("2026-07-22");
    expect(line).toMatch(/protect|build around|do not overwrite/i);
  });
  it("returns null when no B/C event falls inside the range", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "Late Event", date: "2026-09-15", priority: "C" }];
    expect(formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("returns null for an empty events array", () => {
    expect(formatUpcomingEventsForBlock([], { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("ignores A-priority events entirely — those already redirect the whole season via findUpcomingAEvent's event-anchored routing, not this line", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "A-Race", date: "2026-07-22", priority: "A" }];
    expect(formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("lists multiple in-range events in chronological order", () => {
    const events: import("./types").SeasonEvent[] = [
      { name: "Second", date: "2026-08-10", priority: "C" },
      { name: "First", date: "2026-07-25", priority: "B" },
    ];
    const line = formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line.indexOf("First")).toBeLessThan(line.indexOf("Second"));
  });
});

describe("chooseNextFocus (season-continuous-focus-selection §4)", () => {
  it("picks the highest-scored candidate that isn't the last focus", () => {
    const choice = chooseNextFocus({
      limiter: { system: "vo2max", confidence: "high" },
      lastFocus: "threshold",
      signals: {},
    });
    expect(choice.focus).toBe("vo2max"); // limiter bonus wins
    expect(choice.focus).not.toBe("threshold"); // no-back-to-back
    expect(choice.scores).toHaveLength(5); // full ranking, including the loser
  });

  it("gives a KB-grounded rationale distinguishing a confident-limiter pick from a rotation pick", () => {
    const limiterPick = chooseNextFocus({ limiter: { system: "vo2max", confidence: "high" }, lastFocus: "threshold", signals: {} });
    expect(limiterPick.rationale).toContain("depressed system");
    const rotationPick = chooseNextFocus({ limiter: { system: null, confidence: "low" }, lastFocus: "threshold", signals: {} });
    expect(rotationPick.rationale).toBeTruthy();
    expect(rotationPick.rationale).not.toBe(limiterPick.rationale);
  });

  it("gives aerobic-base its own rationale wording when it wins", () => {
    const choice = chooseNextFocus({
      limiter: { system: null, confidence: "low" },
      lastFocus: "threshold",
      signals: { exposure: { "aerobic-base": undefined, threshold: 0, vo2max: 0, anaerobic: 0, durability: 0 } },
    });
    expect(choice.focus).toBe("aerobic-base"); // never-seen urgency (undefined exposure) outranks saturated staleness
    expect(choice.rationale.toLowerCase()).toContain("aerobic");
  });

  it("real signals (goal text, exposure, execution) shape the pick, same as scoreFocusCandidates directly", () => {
    const choice = chooseNextFocus({
      limiter: { system: "anaerobic", confidence: "high" },
      lastFocus: "aerobic-base",
      signals: { goalText: "Raise my FTP from 280 to 300 W" },
    });
    expect(choice.focus).toBe("threshold"); // goal-relevance overrides the anaerobic limiter, same as the old draft-level regression test proved
    expect(choice.rationale).toBe("rotating the quality focus (KB: avoid repeating one stimulus)");
  });
});

describe("findUpcomingAEvent", () => {
  it("finds the nearest future A-priority event", () => {
    const events = [
      { name: "B race", date: "2026-08-01", priority: "B" as const },
      { name: "A race", date: "2026-10-01", priority: "A" as const },
    ];
    expect(findUpcomingAEvent(events, "2026-07-01")?.name).toBe("A race");
  });
  it("returns null when the only A-event is today or in the past", () => {
    const events = [{ name: "A race", date: "2026-07-01", priority: "A" as const }];
    expect(findUpcomingAEvent(events, "2026-07-01")).toBeNull();
  });
  it("returns null when there is no A-event at all", () => {
    expect(findUpcomingAEvent([{ name: "B race", date: "2026-08-01", priority: "B" as const }], "2026-07-01")).toBeNull();
  });
});

describe("isSeasonFocus", () => {
  it("narrows a valid focus string, rejects anything else", () => {
    expect(isSeasonFocus("threshold")).toBe(true);
    expect(isSeasonFocus("aerobic-base")).toBe(true);
    expect(isSeasonFocus("made-up")).toBe(false);
    expect(isSeasonFocus(undefined)).toBe(false);
  });
});

describe("formatFocusContext (rolling mode — season-continuous-focus-selection §4)", () => {
  it("names the focus and rationale, with an objective prefix when set", () => {
    const line = formatFocusContext({ focus: "threshold", rationale: "rotating the quality focus", scores: [] }, "get faster");
    expect(line).toContain("get faster");
    expect(line).toContain("threshold");
    expect(line).toContain("rotating the quality focus");
    expect(line).toContain("every week shares it");
  });
  it("omits the objective prefix when there is none", () => {
    const line = formatFocusContext({ focus: "vo2max", rationale: "r", scores: [] }, "");
    expect(line.startsWith("BLOCK FOCUS: vo2max")).toBe(true);
  });
});

describe("validateBlockFocus (rolling mode)", () => {
  const day = (date: string, type: PlannedDay["type"], durationMin: number, workoutText = ""): PlannedDay =>
    ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText, description: "" });

  it("flags a build-focus block with zero matching sessions", () => {
    const days = [day("2026-07-01", "Z2", 90), day("2026-07-03", "Z2", 90)];
    const warnings = validateBlockFocus(days, "vo2max", 250);
    expect(warnings.some((w) => w.includes("vo2max") && w.includes("zero"))).toBe(true);
  });
  it("passes a build-focus block with at least one matching session", () => {
    const days = [day("2026-07-01", "VO2max", 60), day("2026-07-03", "Z2", 90)];
    expect(validateBlockFocus(days, "vo2max", 250)).toEqual([]);
  });
  it("flags an aerobic-base block with too much hard riding time", () => {
    const days = [day("2026-07-01", "Threshold", 60), day("2026-07-03", "Z2", 60)]; // 50% hard by time
    const warnings = validateBlockFocus(days, "aerobic-base", 250);
    expect(warnings.some((w) => w.includes("aerobic-base"))).toBe(true);
  });
  it("passes an aerobic-base block that stays mostly easy", () => {
    const days = [day("2026-07-01", "Threshold", 20), day("2026-07-03", "Z2", 180)]; // ~10% hard by time
    expect(validateBlockFocus(days, "aerobic-base", 250)).toEqual([]);
  });
  it("has no matcher for sharpen — never fires", () => {
    const days = [day("2026-07-01", "Z2", 60)];
    expect(validateBlockFocus(days, "sharpen", 250)).toEqual([]);
  });
});

// P2c (2026-07-24 block-generation redesign): the requirement and its enforcement (validateBlockFocus,
// above) share focusSessionMatchers — asserted here so the two can never silently drift apart.
describe("formatFocusCoverageLine — mandatory coverage requirement (P2c/P5)", () => {
  it("names the required session type for a build focus, every loading week, with priority over RaceSim", () => {
    expect(formatFocusCoverageLine("vo2max", 250)).toBe(
      "REQUIRED COVERAGE: this block's focus is vo2max — include at least 1 VO2max session in EVERY loading week (not just once across the block). This is the block's primary quality work — it takes priority over RaceSim for the week's quality-session slots; RaceSim is sporadic and fills a slot only when it doesn't crowd this out. Do not substitute a different quality type for this requirement."
    );
    expect(formatFocusCoverageLine("threshold", 250)).toContain("include at least 1 Threshold session");
    expect(formatFocusCoverageLine("anaerobic", 250)).toContain("include at least 1 SIT (anaerobic) session");
    expect(formatFocusCoverageLine("durability", 250)).toContain("durability-loaded Z2 (embedded threshold+ work)");
    expect(formatFocusCoverageLine("threshold", 250)).toContain("priority over RaceSim");
  });

  it("returns null for aerobic-base/sharpen — no single required session type", () => {
    expect(formatFocusCoverageLine("aerobic-base", 250)).toBeNull();
    expect(formatFocusCoverageLine("sharpen", 250)).toBeNull();
  });

  it("uses the exact same matcher validateBlockFocus enforces — a session it accepts never contradicts a requirement it named", () => {
    const day = (date: string, type: PlannedDay["type"], durationMin: number): PlannedDay =>
      ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText: "", description: "" });
    const line = formatFocusCoverageLine("vo2max", 250);
    expect(line).not.toBeNull();
    expect(validateBlockFocus([day("2026-07-01", "VO2max", 60)], "vo2max", 250)).toEqual([]);
  });
});

// P5a (2026-07-24 block-generation redesign): stricter than validateBlockFocus's block-wide floor —
// the primary quality must appear in EVERY loading week, catching the exact live defects (Week 3
// dropped Threshold, SIT vanished in weeks 5-6) a block-wide minimum of 1 couldn't see.
describe("validatePrimaryQualityCadence (P5a)", () => {
  const day = (date: string, weekNumber: number, type: PlannedDay["type"], durationMin = 60): PlannedDay =>
    ({ date, weekNumber, weekTheme: "", name: type, type, durationMin, workoutText: "", description: "" });
  const targets = (overrides: Partial<WeekTarget>[]): WeekTarget[] =>
    overrides.map((o, i) => ({ weekNumber: i + 1, isRecovery: false, targetHours: 12, ...o }));

  it("flags a loading week missing the primary quality's matching session", () => {
    const days = [day("2026-07-01", 1, "VO2max"), day("2026-07-08", 2, "Z2")];
    const w = validatePrimaryQualityCadence(days, "vo2max", targets([{}, {}]), 250);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/PRIMARY QUALITY: week 2 \(loading\)/);
    expect(w[0]).toMatch(/no VO2max session this week/);
  });

  it("passes when every loading week has a matching session", () => {
    const days = [day("2026-07-01", 1, "VO2max"), day("2026-07-08", 2, "VO2max")];
    expect(validatePrimaryQualityCadence(days, "vo2max", targets([{}, {}]), 250)).toEqual([]);
  });

  it("exempts recovery weeks from the requirement", () => {
    const days = [day("2026-07-01", 1, "VO2max"), day("2026-07-08", 2, "Z2")];
    const w = validatePrimaryQualityCadence(days, "vo2max", targets([{}, { isRecovery: true }]), 250);
    expect(w).toEqual([]);
  });

  it("has no matcher for aerobic-base/sharpen — never fires", () => {
    const days = [day("2026-07-01", 1, "Z2")];
    expect(validatePrimaryQualityCadence(days, "aerobic-base", targets([{}]), 250)).toEqual([]);
    expect(validatePrimaryQualityCadence(days, "sharpen", targets([{}]), 250)).toEqual([]);
  });

  it("treats a week with zero generated days as missing the requirement too", () => {
    const days = [day("2026-07-01", 1, "VO2max")];
    const w = validatePrimaryQualityCadence(days, "vo2max", targets([{}, {}]), 250);
    expect(w.some((m) => /week 2/.test(m))).toBe(true);
  });

  // 2026-07-29 (Decision 2c, triple-warning collapse): this recovery-week ceiling was added 2026-07-29
  // earlier the same day and immediately created a third near-duplicate warning alongside
  // validateSchedule's recovery branch and validateRecoveryWeekDensity for the identical fact (a
  // recovery week over its quality ceiling). Removed again — validateRecoveryWeekDensity
  // (lib/schedule-validate.ts) is the sole owner of the recovery-week ceiling now. This is provably
  // lossless, not a silent re-introduction of the old gap:
  //   - vo2max/threshold/anaerobic: the matcher here is exact type equality, a subset of the density
  //     validator's `standalone` set, so matches.length > 1 always implies standalone.length > 1 there.
  //   - durability: the matcher selects embedded Z2/Recovery efforts — exactly the density validator's
  //     `embedded` set, which fires at >=1 (strictly stricter than this ceiling's >1).
  //   - The only case this ceiling ever caught that the density validator doesn't is excess sessions
  //     landing on event dates, which the density validator deliberately excludes (a race inside a
  //     recovery week IS that week's one retained intensity touch) — so that firing was a false
  //     positive, not real coverage. See validateRecoveryWeekDensity's own test file
  //     (lib/schedule-validate.test.ts) for the moved/retained coverage and the cross-validator
  //     "single owner" pinning test proving 3 warnings collapsed to 1.
  it("no longer polices a recovery week's quality count — silent regardless of how many focus sessions it carries", () => {
    const days: PlannedDay[] = [
      { date: "2026-06-15", weekNumber: 1, weekTheme: "t", name: "V1", type: "VO2max", durationMin: 60, workoutText: "- 4m 110%", description: "x" },
      { date: "2026-06-17", weekNumber: 1, weekTheme: "t", name: "V2", type: "VO2max", durationMin: 60, workoutText: "- 4m 110%", description: "x" },
    ];
    const w = validatePrimaryQualityCadence(days, "vo2max", targets([{ isRecovery: true }]), 250);
    expect(w).toEqual([]);
  });
});

describe("projectSeasonOutlook (season-roadmap-preview §6)", () => {
  it("projects the requested number of hypothetical slots, dated contiguously from today", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: "aerobic-base", signals: {} }, "2026-07-01", 3);
    expect(out).toHaveLength(3);
    expect(out[0].startDate).toBe("2026-07-01");
    expect(out[1].startDate).toBe(addWeeks(out[0].startDate, out[0].weeks));
    expect(out[2].startDate).toBe(addWeeks(out[1].startDate, out[1].weeks));
  });

  it("never repeats a focus back-to-back across the projected slots", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} }, "2026-07-01", 4);
    for (let i = 1; i < out.length; i++) expect(out[i].focus).not.toBe(out[i - 1].focus);
  });

  it("defaults to 4 slots when not specified", () => {
    const out = projectSeasonOutlook({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} }, "2026-07-01");
    expect(out).toHaveLength(4);
  });

  it("REGRESSION (ported from the deleted draftSeasonArc-level test, 2026-07-15 live finding): real exposure for ALL foci must not freeze urgency for the whole projection — a never-yet-drafted focus still surfaces within one horizon", () => {
    // A confident anaerobic limiter with real (comparatively fresh, non-zero) exposure for every focus —
    // without the exposure-extrapolation fix, vo2max/durability's real exposure never grows across the
    // loop and the projection degenerates into anaerobic/threshold alternating forever.
    const out = projectSeasonOutlook(
      {
        limiter: { system: "anaerobic", confidence: "high" },
        lastFocus: "aerobic-base",
        signals: {
          goalText: "Raise my FTP from 280 to 300 W. Weakpoint: Sprint (0-30s).",
          exposure: { "aerobic-base": 2, threshold: 0, anaerobic: 0, vo2max: 3, durability: 2 },
          execQuality: { threshold: 6.2, vo2max: 7, anaerobic: 7, durability: 6.8 },
        },
      },
      "2026-07-01",
      4
    );
    const foci = out.map((s) => s.focus);
    expect(foci).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold"]); // the old two-focus trap
    expect(foci).toContain("vo2max"); // structurally reachable within one horizon
  });

  it("REGRESSION (ported from the deleted draftSeasonArc-level test, found by the final whole-branch review): a focus with fresh REAL exposure is not penalized just because it sits in the incoming lastFocus/history", () => {
    // durability's real exposure says 0 weeks (maximally fresh) even though its label was the most
    // recent thing trained (lastFocus) — the projection must honor the real freshness, not fall back to
    // a label-derived staleness estimate that overstates its urgency.
    const out = projectSeasonOutlook(
      {
        limiter: { system: null, confidence: "low" },
        lastFocus: "durability",
        signals: { exposure: { durability: 0 } },
      },
      "2026-07-01",
      3
    );
    // durability must not win the very next slot purely off a stale label-derived estimate when its
    // real exposure says it was just trained — the no-back-to-back rule already keeps it out of slot 0
    // regardless, so this asserts the REAL signal (not a label fallback) is what's driving slot 1+.
    expect(out[0].focus).not.toBe("durability");
  });

  it("REGRESSION: a focus with NO original exposure entry at all (picked only via label fallback) must not re-spike to NEVER_SEEN urgency the second time it's chosen", () => {
    // vo2max has no key whatsoever in signals.exposure — exposureFromSessions's documented contract is
    // that a focus with no qualifying session is ABSENT from its result, the realistic common case, not
    // a corner case. vo2max can therefore only be picked via chooseNextFocus's labelExposureWeeks
    // fallback. The already-fixed drop bug only recomputed staleness for foci that started as keys of
    // the original exposure object — vo2max never was one, so on the first slot after it stops being the
    // literal lastFocus it falls straight back to labelExposureWeeks(recentFocuses, "vo2max") with a
    // one-element history that no longer contains it → null → NEVER_SEEN_URGENCY (1.3) again, exactly
    // the artificial spike the first fix was supposed to eliminate.
    //
    // Hand-traced against the FIXED code (goal=0.5 and execution=0.5 are uniform across all foci here —
    // no goalText/execQuality — so only urgency + trainability differentiate scores; limiter is null so
    // contributes 0 everywhere):
    //   slot 0 (weeksIntoProjection=0, lastFocus="aerobic-base"): vo2max is absent from exposure and not
    //     in recentFocuses=["aerobic-base"] → labelExposureWeeks→null→urgency 1.3, score 0.82 — dominates
    //     every other candidate (next highest, threshold, scores 0.475) → vo2max wins. This part is
    //     IDENTICAL pre- and post-fix (vo2max has no data yet either way; NEVER_SEEN_URGENCY on a truly
    //     first-ever pick is correct, not the bug).
    //   slot 1 (weeksIntoProjection=4, lastFocus="vo2max"): vo2max is excluded (no-back-to-back) so its
    //     score doesn't matter; among the rest, threshold's exposure grows to 1+4=5 (urgency 0.417,
    //     trainability 1.0) beating aerobic-base (same urgency, trainability 0.9), durability (0.6) and
    //     anaerobic (0.3) → threshold wins (score 0.575 vs aerobic-base's 0.555).
    //   slot 2 (weeksIntoProjection=8, lastFocus="threshold") — the crux slot:
    //     FIXED: vo2max is in the pick-time Map (chosenAt=0) → adjusted exposure = 8-0=8 → urgency
    //       8/12=0.667 → score 0.175+0.2+0.18+0.075=0.63.
    //     aerobic-base was never picked via the loop → adjusted exposure = 1(original)+8=9 → urgency
    //       9/12=0.75 → score 0.175+0.225+0.18+0.075=0.655 — narrowly beats vo2max's 0.63 and wins.
    //     BUGGY (pre-fix): vo2max has no original exposure key, so it's never written into the adjusted
    //       exposure object at all regardless of the pick-time Map → falls back to
    //       labelExposureWeeks(["threshold"], "vo2max") = null → urgency 1.3 → score 0.82 → vo2max wins
    //       AGAIN, reproducing the exact spike this fix closes.
    const out = projectSeasonOutlook(
      {
        limiter: { system: null, confidence: "low" },
        lastFocus: "aerobic-base",
        signals: {
          exposure: { "aerobic-base": 1, threshold: 1, anaerobic: 1, durability: 1 }, // vo2max: absent
        },
      },
      "2026-07-01",
      4
    );
    const foci = out.map((s) => s.focus);
    expect(foci[0]).toBe("vo2max");
    expect(foci[1]).toBe("threshold");
    // The crux assertion: without the fix, vo2max wins slot 2 again purely off the 1.3 urgency ceiling.
    expect(foci[2]).not.toBe("vo2max");
    expect(foci[2]).toBe("aerobic-base");
  });
});
