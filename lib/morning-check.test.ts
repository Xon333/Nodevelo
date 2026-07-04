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

  // S2-9: injury is musculoskeletal — the pedaling motion is the hazard, not the intensity. So it rests
  // the day (not a swap/downgrade) and does so on ANY ride day, quality or not — the "nothing to protect on
  // an easy day" logic that's fine for ill/fatigue is wrong here.
  it("rests today on an injury flag regardless of quality (never proceed, never downgrade)", () => {
    expect(decideMorningCheck("injury", { isQualityDay: true }).decision).toBe("rest");
    expect(decideMorningCheck("injury", { isQualityDay: false }).decision).toBe("rest");
  });

  it("injury guidance names the risk and points to a professional", () => {
    const reasons = decideMorningCheck("injury", { isQualityDay: false }).reasons.join(" ");
    expect(reasons).toMatch(/rest today/i);
    expect(reasons).toMatch(/professional/i);
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
  it("blocks an injury 'rest' decision — there's nothing to move (S2-9)", () => {
    expect(proactiveApplyBlock({ ...downgrade, flag: "injury", decision: "rest" }, false)).toMatch(/doesn't move/i);
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
