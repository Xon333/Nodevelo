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

  it("declares grounding facts independently rather than deriving them from prompts", () => {
    for (const fixture of FR6_CASES) {
      expect(fixture.grounding.allowedDates).not.toBe(
        expect.objectContaining({ derivedFrom: fixture.prompt }),
      );
      expect(fixture.grounding.allowedNumericTokens.length).toBeGreaterThan(0);
      expect(fixture.grounding.forbiddenClaims.length).toBeGreaterThan(0);
    }
  });
});

describe("deterministic grounding checks", () => {
  const fixture = {
    allowedDates: ["2030-01-08"],
    allowedNumericTokens: ["225W", "90 min", "8/10", "45 TSS"],
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
});
