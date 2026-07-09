import { describe, expect, it } from "vitest";
import { deriveTrendsVerdict } from "./trends-verdict";

const pts = (...values: number[]) => values.map((value) => ({ value }));
const scores = (...s: number[]) => s.map((executionScore) => ({ executionScore }));
// One complete logged week: intake/burn totals against a median weight.
const week = (intakeKcal: number, burnKcal: number, weightKg: number) => ({ intakeKcal, burnKcal, weightKg });

describe("deriveTrendsVerdict — axes", () => {
  it("engine ↑ when CTL and Pw:HR both rise", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.2, 1.22, 1.3, 1.34), scores: [], energy: [] });
    const engine = v.axes.find((a) => a.key === "engine")!;
    expect(engine.dir).toBe("up");
    expect(engine.label).toBe("engine ↑");
  });
  it("engine steady when the two signals disagree", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.4, 1.38, 1.3, 1.26), scores: [], energy: [] });
    expect(v.axes.find((a) => a.key === "engine")!.dir).toBe("steady");
  });
  it("engine uses the one signal that exists when the other is thin", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50, 52, 58, 62), ef: pts(1.3), scores: [], energy: [] });
    expect(v.axes.find((a) => a.key === "engine")!.dir).toBe("up");
  });
  it("delivery carries the average and direction of the last 24 scores", () => {
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: scores(5, 5, 5, 5, 8, 8, 8, 8), energy: [] });
    const d = v.axes.find((a) => a.key === "delivery")!;
    expect(d.dir).toBe("up");
    expect(d.label).toBe("delivery ↑ (avg 6.5/10)");
  });
  it("fueling bands via the weekly EA proxy — adequate reads on target", () => {
    // (17500 − 3500) / 7 / 70 = 28.6 kcal/kg/day → adequate
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: [], energy: [week(17500, 3500, 70)] });
    const f = v.axes.find((a) => a.key === "fueling")!;
    expect(f.dir).toBe("steady");
    expect(f.label).toBe("fueling on target");
  });
  it("fueling low reads running low with dir down", () => {
    // (10500 − 3500) / 7 / 70 = 14.3 → low
    const v = deriveTrendsVerdict({ ctl: [], ef: [], scores: [], energy: [week(10500, 3500, 70)] });
    const f = v.axes.find((a) => a.key === "fueling")!;
    expect(f.dir).toBe("down");
    expect(f.label).toBe("fueling running low");
  });
  it("weeks missing either series are excluded from the fueling read", () => {
    const v = deriveTrendsVerdict({
      ctl: [], ef: [], scores: [],
      energy: [{ intakeKcal: null, burnKcal: 3500, weightKg: 70 }, week(24500, 3500, 70)], // 21000/7/70 = 42.9 → ample
    });
    expect(v.axes.find((a) => a.key === "fueling")!.label).toBe("fueling ample");
  });
});

describe("deriveTrendsVerdict — the word", () => {
  const goodEngine = { ctl: pts(50, 52, 58, 62), ef: pts(1.2, 1.22, 1.3, 1.34) };
  const flatScores = scores(7, 7, 7, 7, 7, 7);
  it("Improving: engine up, delivery steady, fueling fine", () => {
    const v = deriveTrendsVerdict({ ...goodEngine, scores: flatScores, energy: [week(17500, 3500, 70)] });
    expect(v.word).toBe("Improving");
  });
  it("low fueling drags Improving down to Holding, never lifts", () => {
    const v = deriveTrendsVerdict({ ...goodEngine, scores: flatScores, energy: [week(10500, 3500, 70)] });
    expect(v.word).toBe("Holding");
  });
  it("Slipping: engine and delivery both falling", () => {
    const v = deriveTrendsVerdict({
      ctl: pts(62, 58, 52, 48), ef: pts(1.34, 1.3, 1.22, 1.18),
      scores: scores(8, 8, 8, 8, 5, 5, 5, 5), energy: [],
    });
    expect(v.word).toBe("Slipping");
  });
  it("Mixed: engine down but delivery up lands between", () => {
    const v = deriveTrendsVerdict({
      ctl: pts(62, 58, 52, 48), ef: pts(1.34, 1.3, 1.22, 1.18),
      scores: scores(5, 5, 5, 5, 8, 8, 8, 8), energy: [],
    });
    expect(v.word).toBe("Mixed");
  });
  it("no verdict at all without an engine or delivery read", () => {
    const v = deriveTrendsVerdict({ ctl: pts(50), ef: [], scores: [], energy: [week(17500, 3500, 70)] });
    expect(v.word).toBeNull();
    expect(v.axes.find((a) => a.key === "engine")!.label).toBe("engine — no read yet");
  });
});
