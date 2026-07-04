import { describe, expect, it } from "vitest";
import { formatFuelPromptContext } from "./sync-analysis";
import type { FuelPrompt } from "./fuel-prompt";

// formatFuelPromptContext is the pure formatting step between the deterministic FuelPrompt
// (lib/fuel-prompt.ts) and the coach-note prompt: numbers only, no new computation — the LLM
// phrases the one sentence, it never invents or recomputes these figures.

describe("formatFuelPromptContext", () => {
  it("formats a log-nudge with hours+minutes duration (matches the plan's example string)", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "long-ride", durationMin: 125 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 2h05 with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats a log-nudge under an hour as plain minutes (no spurious 0h prefix)", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "interval-day", durationMin: 45 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 45m with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats an exact-hour log-nudge with a zero-padded minutes segment", () => {
    const prompt: FuelPrompt = { kind: "log-nudge", reason: "long-ride", durationMin: 120 };
    expect(formatFuelPromptContext(prompt)).toBe(
      "FUEL PROMPT: rode 2h00 with no carbs logged — remind to log in-ride carbs in Intervals.icu"
    );
  });

  it("formats a gap prompt (matches the plan's example string)", () => {
    const prompt: FuelPrompt = { kind: "gap", loggedGPerH: 35, optimumGPerH: 69, deltaGPerH: -34 };
    expect(formatFuelPromptContext(prompt)).toBe("FUEL PROMPT: logged 35 g/h vs derived optimum 69 g/h");
  });
});
