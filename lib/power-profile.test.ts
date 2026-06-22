import { describe, expect, it } from "vitest";
import { analyzePowerProfile, formatPowerProfileForPrompt } from "./power-profile";
import type { PowerCurvePoint } from "./types";

const FTP = 280;
const curve = (over: Record<number, number>): PowerCurvePoint[] =>
  Object.entries(over).map(([durationSec, watts]) => ({ durationSec: Number(durationSec), watts }));

// Reference multiples: 5s 4.0× · 60s 1.9× · 300s 1.18× of FTP (280W) → 1120 / 532 / 330.4 W.

describe("analyzePowerProfile — rider-type classification", () => {
  it("classifies a dominant 5s effort as a sprinter", () => {
    const p = analyzePowerProfile(curve({ 5: 1400, 60: 560, 300: 330 }), FTP, 70);
    expect(p?.riderType).toBe("sprinter"); // 1400/280/4.0 = 1.25, clears the strength margin
  });

  it("classifies dominant 1–5 min power as a puncheur", () => {
    const p = analyzePowerProfile(curve({ 5: 1100, 60: 620, 300: 360 }), FTP, 70);
    expect(p?.riderType).toBe("puncheur"); // anaerobic 620/280/1.9 = 1.17
  });

  it("classifies a flat curve (weak short efforts) as a time-trialist", () => {
    const p = analyzePowerProfile(curve({ 5: 1000, 60: 480, 300: 310 }), FTP, 70);
    expect(p?.riderType).toBe("time-trialist"); // all three at/below the weakness edge
  });

  it("classifies a balanced curve as an all-rounder", () => {
    const p = analyzePowerProfile(curve({ 5: 1130, 60: 540, 300: 333 }), FTP, 70);
    expect(p?.riderType).toBe("all-rounder"); // nothing clears either edge
  });
});

describe("analyzePowerProfile — easy win", () => {
  it("flags the most-depressed system as the easy win", () => {
    const p = analyzePowerProfile(curve({ 5: 1000, 60: 480, 300: 310 }), FTP, 70);
    expect(p?.easyWin?.system).toBe("neuromuscular"); // 1000/280/4.0 = 0.89, the lowest dip
    expect(p?.easyWin?.durationSec).toBe(5);
  });

  it("returns no easy win for a balanced curve (no real dip)", () => {
    const p = analyzePowerProfile(curve({ 5: 1130, 60: 540, 300: 333 }), FTP, 70);
    expect(p?.easyWin).toBeNull();
  });
});

describe("analyzePowerProfile — W/kg and weight handling", () => {
  it("computes W/kg for display when bodyweight is known", () => {
    const p = analyzePowerProfile(curve({ 5: 1400, 60: 560, 300: 330 }), FTP, 70);
    expect(p?.systems.find((s) => s.durationSec === 5)?.wattsPerKg).toBe(20); // 1400/70
  });

  it("classifies the same regardless of weight (ratios cancel it); W/kg is null without weight", () => {
    const withW = analyzePowerProfile(curve({ 5: 1400, 60: 560, 300: 330 }), FTP, 70);
    const noW = analyzePowerProfile(curve({ 5: 1400, 60: 560, 300: 330 }), FTP, null);
    expect(noW?.riderType).toBe(withW?.riderType);
    expect(noW?.systems[0].wattsPerKg).toBeNull();
  });
});

describe("analyzePowerProfile — curve coverage", () => {
  it("matches the nearest point within 15% of an anchor", () => {
    const p = analyzePowerProfile(curve({ 5: 1400, 65: 560, 300: 330 }), FTP, 70); // 65s within 15% of 60
    expect(p?.systems.some((s) => s.system === "anaerobic")).toBe(true);
  });

  it("skips an anchor with no point within tolerance", () => {
    const p = analyzePowerProfile(curve({ 5: 1400, 80: 560, 300: 330 }), FTP, 70); // 80s > 60±15%
    expect(p?.systems.some((s) => s.system === "anaerobic")).toBe(false);
  });

  it("is not confident with only one usable anchor", () => {
    const p = analyzePowerProfile(curve({ 5: 1400 }), FTP, 70);
    expect(p?.confident).toBe(false);
  });

  it("returns null with no FTP or an empty curve", () => {
    expect(analyzePowerProfile(curve({ 5: 1400 }), 0, 70)).toBeNull();
    expect(analyzePowerProfile([], FTP, 70)).toBeNull();
  });
});

describe("formatPowerProfileForPrompt", () => {
  it("returns empty string for a null or low-confidence profile", () => {
    expect(formatPowerProfileForPrompt(null)).toBe("");
    const lowConf = analyzePowerProfile(curve({ 5: 1400 }), FTP, 70);
    expect(formatPowerProfileForPrompt(lowConf)).toBe("");
  });

  it("renders the rider type and frames the easy win as a hint, not a replacement", () => {
    const p = analyzePowerProfile(curve({ 5: 1000, 60: 480, 300: 310 }), FTP, 70);
    const out = formatPowerProfileForPrompt(p);
    expect(out).toContain("RIDER PROFILE");
    expect(out).toContain("time-trialist");
    expect(out).toContain("easy win");
    expect(out).toContain("not a replacement");
  });

  it("omits the easy-win line when there's no clear weak point", () => {
    const p = analyzePowerProfile(curve({ 5: 1130, 60: 540, 300: 333 }), FTP, 70);
    const out = formatPowerProfileForPrompt(p);
    expect(out).toContain("RIDER PROFILE");
    expect(out).not.toContain("easy win");
  });
});
