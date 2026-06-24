import { describe, expect, it } from "vitest";
import { backfillLedgerEntries, shouldRebuildLedger } from "./sync-ledger";
import type { RideScoreEntry } from "./types";

const ftpForDate = () => 250;

describe("backfillLedgerEntries (CR-G ledger schema migration)", () => {
  it("fills missing fields on an old entry without re-shifting present ones", () => {
    // An entry that predates ftpUsed / legacy / inferredType / durationMin / tss.
    const old = {
      date: "2025-01-01",
      executionScore: 7,
      plannedType: null,
      compliancePct: null,
      intensityFactor: 0.7,
    } as unknown as RideScoreEntry;
    const [e] = backfillLedgerEntries([old], ftpForDate, "2025-06-01");
    expect(e.ftpUsed).toBe(250);
    expect(e.planned).toBe(false); // no plannedType → off-plan
    expect(e.inferredType).toBe("Z2");
    expect(e.durationMin).toBe(0);
    expect(e.tss).toBeNull();
    expect(e.legacy).toBe(true); // off-plan + before the structured-training floor
    expect(e.executionScore).toBe(7); // untouched
  });

  it("derives planned from plannedType and never flags a planned ride legacy", () => {
    const planned = { date: "2025-07-01", executionScore: 8, plannedType: "Threshold" } as unknown as RideScoreEntry;
    const [e] = backfillLedgerEntries([planned], ftpForDate, "2025-06-01");
    expect(e.planned).toBe(true);
    expect(e.inferredType).toBe("Threshold");
    expect(e.legacy).toBe(false);
  });

  it("is idempotent — present values win on a second pass (history never re-shifts)", () => {
    const entry: RideScoreEntry = {
      date: "2025-08-01",
      executionScore: 6,
      plannedType: null,
      inferredType: "VO2max",
      planned: false,
      legacy: false,
      compliancePct: null,
      intensityFactor: 0.9,
      ftpUsed: 300, // not 250 — must be preserved
      durationMin: 60,
      tss: 80,
    };
    const twice = backfillLedgerEntries(backfillLedgerEntries([entry], ftpForDate, "2025-01-01"), ftpForDate, "2025-01-01");
    expect(twice[0]).toEqual(entry);
  });

  it("splits off-plan rides on the floor: before = legacy, after = not", () => {
    const before = { date: "2025-05-01", executionScore: 5, plannedType: null } as unknown as RideScoreEntry;
    const after = { date: "2025-07-01", executionScore: 5, plannedType: null } as unknown as RideScoreEntry;
    const [b, a] = backfillLedgerEntries([before, after], ftpForDate, "2025-06-01");
    expect(b.legacy).toBe(true);
    expect(a.legacy).toBe(false);
  });

  it("treats a null floor (no block ever existed) as all off-plan rides legacy", () => {
    const e = { date: "2025-07-01", executionScore: 5, plannedType: null } as unknown as RideScoreEntry;
    expect(backfillLedgerEntries([e], ftpForDate, null)[0].legacy).toBe(true);
  });
});

describe("shouldRebuildLedger (LEDGER-3 one-shot guard)", () => {
  it("never rebuilds a normal sync (not requested)", () => {
    expect(shouldRebuildLedger(false, false, false)).toBe(false);
    expect(shouldRebuildLedger(false, true, true)).toBe(false);
  });

  it("rebuilds on the first request when not yet rebuilt", () => {
    expect(shouldRebuildLedger(true, false, false)).toBe(true);
  });

  it("refuses a repeat request once already rebuilt", () => {
    expect(shouldRebuildLedger(true, true, false)).toBe(false);
  });

  it("allows a forced re-run despite the marker", () => {
    expect(shouldRebuildLedger(true, true, true)).toBe(true);
  });
});
