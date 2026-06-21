import { describe, expect, it } from "vitest";
import { decideMorningCheck, mergeMorningCheck, proactiveApplyBlock, strainScore, type MorningCheckAnswers, type MorningCheckObjective } from "./morning-check";
import type { MorningCheckEntry } from "./types";

const fresh: MorningCheckAnswers = { fatigue: 1, sleep: 5, soreness: 1, motivation: 5, illness: "none" };
const wrecked: MorningCheckAnswers = { fatigue: 5, sleep: 1, soreness: 5, motivation: 2, illness: "none" };
const moderate: MorningCheckAnswers = { fatigue: 3, sleep: 3, soreness: 3, motivation: 3, illness: "none" }; // strain 12

const goodObjective: MorningCheckObjective = { isQualityDay: true, tsb: 2, readiness: "Build", acwr: "optimal" };
const poorObjective: MorningCheckObjective = { isQualityDay: true, tsb: -28, readiness: "Recover", acwr: "high" };

describe("strainScore", () => {
  it("ranges fresh (4) to wrecked (20)", () => {
    expect(strainScore(fresh)).toBe(4);
    expect(strainScore(wrecked)).toBe(19);
    expect(strainScore(moderate)).toBe(12);
  });
});

describe("decideMorningCheck", () => {
  it("proceeds when fresh on a quality day", () => {
    expect(decideMorningCheck(fresh, goodObjective).decision).toBe("proceed");
  });

  it("downgrades on high reported strain alone, even with good objective signals", () => {
    const r = decideMorningCheck(wrecked, goodObjective);
    expect(r.decision).toBe("downgrade");
    expect(r.reasons.join(" ")).toMatch(/strain/i);
  });

  it("downgrades on any illness before a quality day", () => {
    expect(decideMorningCheck({ ...fresh, illness: "mild" }, goodObjective).decision).toBe("downgrade");
    expect(decideMorningCheck({ ...fresh, illness: "sick" }, goodObjective).decision).toBe("downgrade");
  });

  it("lets the objective signals tip the medium-strain band", () => {
    expect(decideMorningCheck(moderate, goodObjective).decision).toBe("proceed"); // strain 12, objective good
    const poor = decideMorningCheck(moderate, poorObjective);
    expect(poor.decision).toBe("downgrade"); // same strain, but TSB/readiness/ACWR agree
    expect(poor.reasons.join(" ")).toMatch(/TSB|readiness|ACWR/);
  });

  it("always proceeds on a non-quality day (nothing to downgrade)", () => {
    expect(decideMorningCheck(wrecked, { ...poorObjective, isQualityDay: false }).decision).toBe("proceed");
  });
});

describe("proactiveApplyBlock", () => {
  const downgrade: MorningCheckEntry = { date: "2026-06-20", fatigue: 5, sleep: 1, soreness: 5, motivation: 2, illness: "none", strain: 19, decision: "downgrade", setAt: "" };

  it("allows when the athlete checked in with a downgrade and hasn't ridden", () => {
    expect(proactiveApplyBlock(downgrade, false)).toBeNull();
  });
  it("blocks when today's ride is already logged", () => {
    expect(proactiveApplyBlock(downgrade, true)).toMatch(/already logged/);
  });
  it("blocks when there's no check-in", () => {
    expect(proactiveApplyBlock(null, false)).toMatch(/check-in first/);
  });
  it("blocks when the check-in said proceed", () => {
    expect(proactiveApplyBlock({ ...downgrade, decision: "proceed" }, false)).toMatch(/didn't recommend/);
  });
});

describe("mergeMorningCheck", () => {
  it("replaces an existing entry for the same date and keeps them date-sorted", () => {
    const a: MorningCheckEntry = { date: "2026-06-19", fatigue: 1, sleep: 5, soreness: 1, motivation: 5, illness: "none", strain: 4, decision: "proceed", setAt: "" };
    const b: MorningCheckEntry = { date: "2026-06-20", fatigue: 5, sleep: 1, soreness: 5, motivation: 2, illness: "none", strain: 18, decision: "downgrade", setAt: "" };
    const bUpdated: MorningCheckEntry = { ...b, decision: "proceed", strain: 10 };
    const merged = mergeMorningCheck([a, b], bUpdated);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ date: "2026-06-20", decision: "proceed" });
  });
});
