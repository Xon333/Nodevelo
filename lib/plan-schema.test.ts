import { describe, expect, it } from "vitest";
import { PlanToolSchema, TRAINING_BLOCK_TOOL, structuredToPlannedDays } from "./plan-schema";

const valid = {
  overview: "4-week threshold build.",
  weeks: [
    {
      weekNumber: 1,
      theme: "Intro",
      days: [
        { date: "2026-06-01", name: "Threshold 2x20", type: "Threshold", durationMin: 75, workout: "Warmup\n- 15m 60%\n\nMain Set 2x\n- 20m 95%", description: "Intent: lift threshold." },
        { date: "2026-06-02", name: "Rest", type: "Rest", durationMin: 0, workout: "Rest", description: "Recover." },
      ],
    },
  ],
};

describe("PlanToolSchema", () => {
  it("accepts a well-formed structured plan", () => {
    expect(PlanToolSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an unknown workout type, a bad date, and a missing weeks array", () => {
    const badType = { ...valid, weeks: [{ ...valid.weeks[0], days: [{ ...valid.weeks[0].days[0], type: "Tempo" }] }] };
    const badDate = { ...valid, weeks: [{ ...valid.weeks[0], days: [{ ...valid.weeks[0].days[0], date: "06/01/2026" }] }] };
    expect(PlanToolSchema.safeParse(badType).success).toBe(false);
    expect(PlanToolSchema.safeParse(badDate).success).toBe(false);
    expect(PlanToolSchema.safeParse({ overview: "x" }).success).toBe(false);
  });
});

describe("structuredToPlannedDays", () => {
  const { overview, days } = structuredToPlannedDays(PlanToolSchema.parse(valid));
  it("flattens weeks into PlannedDay[] with week number/theme propagated", () => {
    expect(overview).toBe("4-week threshold build.");
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: "2026-06-01", weekNumber: 1, weekTheme: "Intro", type: "Threshold", durationMin: 75 });
    expect(days[0].workoutText).toContain("20m 95%");
  });
  it("blanks workoutText for Rest days", () => {
    expect(days[1].type).toBe("Rest");
    expect(days[1].workoutText).toBe("");
  });
});

describe("TRAINING_BLOCK_TOOL", () => {
  it("exposes a clean JSON-schema input_schema (no $schema meta key)", () => {
    expect(TRAINING_BLOCK_TOOL.name).toBe("submit_training_block");
    const schema = TRAINING_BLOCK_TOOL.input_schema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.$schema).toBeUndefined();
    expect((schema.properties as Record<string, unknown>).weeks).toBeDefined();
  });
});
