import { describe, expect, it } from "vitest";
import { buildIntentPrompt, INTENT_NOTE_MAX_CHARS } from "./intent-prompt";

const NOTE_455 = `The plan for the ride was:
- 45m z2 steady start
-then a climbing part on undulating terrain which is my weakpoint since it includes power changes not just a steady z4 climb effort, so there were z4 efforts, z5 and z6 on 10%+ gradients  aswell as short descents in between.
-finished the session with a 9m at 292 effort
-then a fast technical descent at the endwhich is also my weakpoint so i tried to practice fast cornering and keeping speed on descents`;

const NOTE_823 = `-Decide to do the workout indoors since the nearby climb where I can do 20min effort (30m riding away) was certainly wet from yesterdays rain so descending would be dangerous (lots of potholes)
-Encountered a big problem while doing the intervals. Maybe the problem was heat management but also I noticed that ERG mode on the trainer was so much more difficult, something like ghost resistance, even doing 200w felt like doing 230-240w outdoors on a calibrated magene pes 515 powermeter I use. I managed to do around 14m of the first interval but I almost puked from the effort, then I lowered the watts manually to 260 but still the effort was too much in the second interval and I couldnt complete so i just decided to hit the duration amount after that with z2 in freeride mode (200w felt much more like 200w but still.
`;

describe("intent prompt", () => {
  it("does not truncate the real acceptance note (455 chars)", () => {
    expect(NOTE_455.length).toBe(455);
    expect(buildIntentPrompt(NOTE_455, 118)).toContain(NOTE_455);
  });

  it("does not truncate the longest note in the real corpus (823 chars)", () => {
    expect(NOTE_823.length).toBe(823);
    expect(buildIntentPrompt(NOTE_823, 120)).toContain(NOTE_823);
  });

  it("marks a note it truncates", () => {
    expect(buildIntentPrompt("x".repeat(INTENT_NOTE_MAX_CHARS + 50), 60)).toContain("[note truncated]");
  });

  it("carries no ride metrics beyond duration", () => {
    const prompt = buildIntentPrompt(NOTE_455, 118);
    for (const leak of ["decoupling", "TSS", "IF ", "NP ", "execution score", "15.7"]) {
      expect(prompt).not.toContain(leak);
    }
  });

  it("states the refusal-of-invented-specificity rule verbatim", () => {
    expect(buildIntentPrompt(NOTE_455, 118)).toContain(
      "Extract only what the athlete explicitly stated; never invent specificity."
    );
  });

  it("is deterministic", () => {
    expect(buildIntentPrompt(NOTE_455, 118)).toBe(buildIntentPrompt(NOTE_455, 118));
  });
});
