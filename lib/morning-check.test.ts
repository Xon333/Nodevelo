import { describe, expect, it } from "vitest";
import { decideMorningCheck, mergeMorningCheck, proactiveApplyBlock } from "./morning-check";
import type { MorningCheckEntry } from "./types";

describe("decideMorningCheck", () => {
  it("downgrades a quality day on either flag", () => {
    expect(decideMorningCheck("ill", { isQualityDay: true }).decision).toBe("downgrade");
    expect(decideMorningCheck("extreme-fatigue", { isQualityDay: true }).decision).toBe("downgrade");
  });

  it("names the flag in the reasons", () => {
    expect(decideMorningCheck("ill", { isQualityDay: true }).reasons.join(" ")).toMatch(/ill/i);
    expect(decideMorningCheck("extreme-fatigue", { isQualityDay: true }).reasons.join(" ")).toMatch(/fatigue/i);
  });

  it("proceeds on a non-quality day (nothing to downgrade), even with a flag", () => {
    expect(decideMorningCheck("ill", { isQualityDay: false }).decision).toBe("proceed");
    expect(decideMorningCheck("extreme-fatigue", { isQualityDay: false }).decision).toBe("proceed");
  });
});

describe("proactiveApplyBlock", () => {
  const downgrade: MorningCheckEntry = { date: "2026-06-20", flag: "extreme-fatigue", decision: "downgrade", setAt: "" };

  it("allows when the athlete flagged a downgrade and hasn't ridden", () => {
    expect(proactiveApplyBlock(downgrade, false)).toBeNull();
  });
  it("blocks when today's ride is already logged", () => {
    expect(proactiveApplyBlock(downgrade, true)).toMatch(/already logged/);
  });
  it("blocks when there's no flag set", () => {
    expect(proactiveApplyBlock(null, false)).toMatch(/flag/i);
  });
  it("blocks when the flag resolved to proceed", () => {
    expect(proactiveApplyBlock({ ...downgrade, decision: "proceed" }, false)).toMatch(/didn't recommend/);
  });
});

describe("mergeMorningCheck", () => {
  it("replaces an existing entry for the same date and keeps them date-sorted", () => {
    const a: MorningCheckEntry = { date: "2026-06-19", flag: "ill", decision: "downgrade", setAt: "" };
    const b: MorningCheckEntry = { date: "2026-06-20", flag: "extreme-fatigue", decision: "downgrade", setAt: "" };
    const bUpdated: MorningCheckEntry = { ...b, flag: "ill" };
    const merged = mergeMorningCheck([a, b], bUpdated);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ date: "2026-06-20", flag: "ill" });
  });
});
