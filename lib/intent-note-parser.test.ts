import { describe, expect, it } from "vitest";
import { parseDeterministicIntent } from "./intent-note-parser";

const AUGUST_23_NOTE = `Intent:
-Block 1 (Z3, 1h)
-Effort 1 (Z4 avg/Z5 NP, 7m, rolling climb, steep gradients)
-Effort 2 (z5 avg, 3m30s, very steep short climb)
-Block 2 (Z2 avg/Z3 NP, 24m, rolling terrain)

Overall goal: High intensity ride, aimed to indruce fatigue with the 1h z3 block 1, then z5 efforts to improve durability`;

describe("parseDeterministicIntent", () => {
  it("parses the August 23 labelled interval grammar without AI", () => {
    const parsed = parseDeterministicIntent(AUGUST_23_NOTE);

    expect(parsed?.model).toBe("deterministic-note-parser");
    expect(parsed?.objectives.map(({ target }) => target)).toEqual([
      { segmentLabel: "Block 1", durationMin: 60, zone: "Z3" },
      { segmentLabel: "Effort 1", durationMin: 7, avgPowerZone: "Z4", normalizedPowerZone: "Z5" },
      { segmentLabel: "Effort 2", durationMin: 3.5, avgPowerZone: "Z5" },
      { segmentLabel: "Block 2", durationMin: 24, avgPowerZone: "Z2", normalizedPowerZone: "Z3" },
    ]);
  });

  it("keeps valid siblings when one bullet is malformed", () => {
    const parsed = parseDeterministicIntent("-Block 1 (Z3, 1h)\n-broken\n-Effort 2 (Z5 avg, 3m30s)");

    expect(parsed?.objectives.map((objective) => objective.target?.segmentLabel)).toEqual(["Block 1", "Effort 2"]);
  });
});
