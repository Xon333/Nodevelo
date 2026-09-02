import { describe, expect, it } from "vitest";

import {
  buildRetrospectivePrompt,
  buildRideAnalysisPrompt,
  buildStructuredRetrospectivePrompt,
} from "../lib/anthropic-prompts";
import { RetrospectiveToolSchema } from "../lib/retrospective-schema";
import { findUnsupportedClaims } from "./fr6-language-experiment";
import { FR6_CASES, FR6_STRUCTURED_SCHEMA } from "./fr6-language-fixtures";

describe("FR-6 fixed language corpus", () => {
  it("covers exactly the six approved sanitized cases", () => {
    expect(FR6_CASES.map((item) => item.id)).toEqual([
      "ride-prescribed-good",
      "ride-prescribed-poor",
      "ride-self-directed",
      "retro-normal",
      "retro-early",
      "structured-mixed-verdicts",
    ]);

    const serialized = JSON.stringify(FR6_CASES);
    for (const forbidden of [
      "i174",
      "Novo Mesto",
      "Otis",
      "@",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("builds exact prompts through the production builders and uses approved output caps", () => {
    expect(
      FR6_CASES.map(({ category, maxOutputTokens }) => [
        category,
        maxOutputTokens,
      ]),
    ).toEqual([
      ["ride-analysis", 450],
      ["ride-analysis", 450],
      ["ride-analysis", 450],
      ["prose-retrospective", 380],
      ["prose-retrospective", 380],
      ["structured-retrospective", 700],
    ]);

    for (const fixture of FR6_CASES) {
      if (fixture.category === "ride-analysis") {
        expect(fixture.prompt).toBe(buildRideAnalysisPrompt(fixture.input));
      } else if (fixture.category === "prose-retrospective") {
        expect(fixture.prompt).toBe(buildRetrospectivePrompt(fixture.input));
      } else {
        expect(fixture.prompt).toBe(
          buildStructuredRetrospectivePrompt(fixture.input),
        );
      }
    }
  });

  it("uses the production retrospective schema only for the structured case", () => {
    expect(FR6_STRUCTURED_SCHEMA).toBe(RetrospectiveToolSchema);
    for (const fixture of FR6_CASES) {
      expect(fixture.schema).toBe(
        fixture.category === "structured-retrospective"
          ? RetrospectiveToolSchema
          : null,
      );
    }
  });

  it("keeps exact, manually declared grounding facts beside every case", () => {
    expect(Object.fromEntries(FR6_CASES.map(({ id, grounding }) => [id, grounding]))).toEqual({
      "ride-prescribed-good": {
        allowedDates: ["2030-01-08"],
        allowedNumericTokens: ["250W", "225W", "210W", "90 min", "45 TSS", "8/10", "145 bpm", "170 bpm", "90%"],
        allowedDeltas: [],
        forbiddenClaims: ["FTP increased", "adaptation confirmed", "missed interval"],
      },
      "ride-prescribed-poor": {
        allowedDates: ["2030-01-10"],
        allowedNumericTokens: ["250W", "205W", "180W", "60 min", "40 min", "5 min", "10 min", "38 TSS", "3/10", "82%", "50%", "150 bpm", "170 bpm"],
        allowedDeltas: [],
        forbiddenClaims: ["textbook", "fully completed", "fitness increased"],
      },
      "ride-self-directed": {
        allowedDates: ["2030-01-12"],
        allowedNumericTokens: ["250W", "210W", "195W", "75 min", "52 TSS", "7/10", "142 bpm", "170 bpm", "84%"],
        allowedDeltas: [],
        forbiddenClaims: ["prescribed session", "100% compliance", "technique confirmed"],
      },
      "retro-normal": {
        allowedDates: ["2030-01-01", "2030-01-08", "2030-01-14"],
        allowedNumericTokens: ["12h", "11h", "92%", "95%", "88%", "50 CTL", "53 CTL", "85 TSS", "4.5%"],
        allowedDeltas: [{ metric: "ctl", value: 3 }],
        forbiddenClaims: ["ended early", "future session", "FTP increased"],
      },
      "retro-early": {
        allowedDates: ["2030-02-01", "2030-02-03", "2030-02-14"],
        allowedNumericTokens: ["2h", "1.5h", "75%", "50%", "50 CTL"],
        allowedDeltas: [{ metric: "ctl", value: 0 }],
        forbiddenClaims: ["two-week failure", "missed after 2030-02-03", "FTP increased"],
      },
      "structured-mixed-verdicts": {
        allowedDates: ["2030-03-01", "2030-03-14"],
        allowedNumericTokens: ["10h", "9h", "90%", "execution 5", "execution 6", "baseline 5", "baseline 6", "baseline 10", "baseline 250", "250W", "255W"],
        allowedDeltas: [{ metric: "execution", value: 1 }],
        forbiddenClaims: ["injury", "FTP increased", "medication"],
      },
    });
  });

  it("rejects an invented date, metric, and forbidden claim for every case", () => {
    for (const fixture of FR6_CASES) {
      expect(
        findUnsupportedClaims(
          `On 2040-12-31 the output claimed 999 watts and ${fixture.grounding.forbiddenClaims[0]}.`,
          fixture.grounding,
        ),
      ).toEqual([
        "unsupported date: 2040-12-31",
        "unsupported numeric claim: 999 watts",
        `forbidden claim: ${fixture.grounding.forbiddenClaims[0]}`,
      ]);
    }
  });
});

describe("deterministic grounding checks", () => {
  const fixture = {
    allowedDates: ["2030-01-08"],
    allowedNumericTokens: ["225W", "90 min", "8/10", "45 TSS"],
    allowedDeltas: [],
    forbiddenClaims: ["FTP increased"],
  };

  it("reports dates, numeric claims, and forbidden phrases absent from independent facts", () => {
    expect(
      findUnsupportedClaims(
        "On 2030-01-09 you held 240W for 95 min, so FTP increased.",
        fixture,
      ),
    ).toEqual([
      "unsupported date: 2030-01-09",
      "unsupported numeric claim: 240W",
      "unsupported numeric claim: 95 min",
      "forbidden claim: FTP increased",
    ]);
  });

  it("accepts allowlisted values across benign punctuation and spacing variants", () => {
    expect(
      findUnsupportedClaims(
        "On 2030-01-08: 225 W was sustained for 90 minutes (RPE 8 / 10; TSS: 45).",
        fixture,
      ),
    ).toEqual([]);
  });

  it("does not treat ordinary prose numbers without units as metric claims", () => {
    expect(
      findUnsupportedClaims(
        "First, keep the takeaway simple. One priority is enough; use 2–3 sentences.",
        fixture,
      ),
    ).toEqual([]);
  });

  it("matches forbidden phrases case-insensitively without matching substrings", () => {
    expect(findUnsupportedClaims("Your ftp increased.", fixture)).toEqual([
      "forbidden claim: FTP increased",
    ]);
    expect(findUnsupportedClaims("The FTP-increased flag was absent.", fixture)).toEqual(
      [],
    );
  });

  it("preserves signs so an opposite percentage cannot borrow the allowed magnitude", () => {
    const normal = FR6_CASES.find(({ id }) => id === "retro-normal");
    expect(normal).toBeDefined();

    expect(findUnsupportedClaims("Decoupling was 4.5%.", normal!.grounding)).toEqual([]);
    expect(findUnsupportedClaims("Decoupling was -4.5%.", normal!.grounding)).toEqual([
      "unsupported numeric claim: -4.5%",
    ]);
  });

  it("accepts integer-equivalent decimals and hyphenated unit forms", () => {
    expect(
      findUnsupportedClaims(
        "CTL 50.0 followed a 90-minute ride at 225-watt normalized power.",
        {
          allowedDates: [],
          allowedNumericTokens: ["50 CTL", "90 min", "225W"],
          allowedDeltas: [],
          forbiddenClaims: [],
        },
      ),
    ).toEqual([]);
  });

  it("checks relevant named metrics without scanning ordinary list numbers", () => {
    const facts = {
      allowedDates: [],
      allowedNumericTokens: ["baseline 5", "execution 6", "90%"],
      allowedDeltas: [],
      forbiddenClaims: [],
    };

    expect(findUnsupportedClaims("Baseline was 5.0; execution score was 6.0.", facts)).toEqual([]);
    expect(findUnsupportedClaims("Baseline was 999.", facts)).toEqual([
      "unsupported numeric claim: Baseline was 999",
    ]);
    expect(findUnsupportedClaims("First, keep 2 priorities in 3 sentences.", facts)).toEqual([]);
  });

  it("checks both endpoints of named CTL comparison clauses", () => {
    const normal = FR6_CASES.find(({ id }) => id === "retro-normal");
    expect(normal).toBeDefined();

    expect(
      findUnsupportedClaims("CTL increased from 50.0 to 53.", normal!.grounding),
    ).toEqual([]);
    expect(
      findUnsupportedClaims("CTL increased from 50 to 54.", normal!.grounding),
    ).toEqual(["unsupported numeric claim: CTL 54"]);
    expect(
      findUnsupportedClaims("CTL changed from 50 to 54.", normal!.grounding),
    ).toEqual(["unsupported numeric claim: CTL 54"]);
  });

  it("checks execution change clauses without scanning unrelated prose numbers", () => {
    const structured = FR6_CASES.find(
      ({ id }) => id === "structured-mixed-verdicts",
    );
    expect(structured).toBeDefined();

    expect(
      findUnsupportedClaims(
        "Execution improved from 5 to 6; summarize it in 2 sentences.",
        structured!.grounding,
      ),
    ).toEqual([]);
    expect(
      findUnsupportedClaims("Execution improved to 9.", structured!.grounding),
    ).toEqual(["unsupported numeric claim: Execution 9"]);
  });

  it("checks CTL deltas independently with direction semantics", () => {
    const normal = FR6_CASES.find(({ id }) => id === "retro-normal");
    expect(normal).toBeDefined();

    expect(findUnsupportedClaims("CTL increased by 3.0.", normal!.grounding)).toEqual([]);
    expect(findUnsupportedClaims("CTL increased by 4.", normal!.grounding)).toEqual([
      "unsupported numeric delta: CTL +4",
    ]);
    expect(findUnsupportedClaims("CTL decreased by 3.", normal!.grounding)).toEqual([
      "unsupported numeric delta: CTL -3",
    ]);
  });

  it("accepts the declared execution delta and rejects an invented one", () => {
    const structured = FR6_CASES.find(
      ({ id }) => id === "structured-mixed-verdicts",
    );
    expect(structured).toBeDefined();

    expect(
      findUnsupportedClaims(
        "Execution improved by 1; summarize it in 2 sentences.",
        structured!.grounding,
      ),
    ).toEqual([]);
    expect(
      findUnsupportedClaims("Execution improved by 2.", structured!.grounding),
    ).toEqual(["unsupported numeric delta: Execution +2"]);
  });
});
