import { describe, expect, it } from "vitest";
import { formatZoneLabel, parseZoneExpression } from "./zone-expression";

describe("parseZoneExpression — single zones", () => {
  it.each([
    ["2", ["Z2"]],
    ["Z2", ["Z2"]],
    ["z2", ["Z2"]],
    ["zone 2", ["Z2"]],
    ["zone2", ["Z2"]],
    [" Z2 ", ["Z2"]],
    ["7", ["Z7"]],
  ])("parses %s -> %s", (input, expected) => {
    expect(parseZoneExpression(input)).toEqual(expected);
  });

  it.each([undefined, null, "", "  ", "0", "8", "zz", "zone", "bogus"])(
    "returns [] for unparseable input %s",
    (input) => {
      expect(parseZoneExpression(input)).toEqual([]);
    }
  );
});

describe("parseZoneExpression — ranges (NV-2 live proof: 3-4, seen verbatim on a real overlay)", () => {
  it.each([
    ["Z3-4", ["Z3", "Z4"]],
    ["3-4", ["Z3", "Z4"]],
    ["Z3–Z4", ["Z3", "Z4"]], // en dash
    ["Z3—Z4", ["Z3", "Z4"]], // em dash
    ["zone 3 to zone 4", ["Z3", "Z4"]],
    ["zone 3 to 4", ["Z3", "Z4"]],
    ["2-3", ["Z2", "Z3"]], // live proof: 2026-08-14's overlay carried this verbatim
    ["Z1-Z7", ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7"]],
    ["Z3-Z3", ["Z3"]], // degenerate single-element range, still valid
  ])("parses %s -> %s", (input, expected) => {
    expect(parseZoneExpression(input)).toEqual(expected);
  });

  it("fails closed on a descending range rather than guessing a direction", () => {
    expect(parseZoneExpression("Z4-2")).toEqual([]);
  });
});

describe("parseZoneExpression — comma lists", () => {
  it.each([
    ["z2,z3", ["Z2", "Z3"]],
    ["Z2, Z4", ["Z2", "Z4"]],
    ["2,3,4", ["Z2", "Z3", "Z4"]],
    ["z2,3-4", ["Z2", "Z3", "Z4"]], // mixed list + range
  ])("parses %s -> %s", (input, expected) => {
    expect(parseZoneExpression(input)).toEqual(expected);
  });

  it("de-duplicates repeated zones across the list", () => {
    expect(parseZoneExpression("z2,z2,z3")).toEqual(["Z2", "Z3"]);
  });

  it("fails the WHOLE list closed when any one segment is unparseable", () => {
    expect(parseZoneExpression("z2,bogus")).toEqual([]);
  });
});

describe("formatZoneLabel", () => {
  it("returns the canonical single-zone label regardless of input spelling", () => {
    expect(formatZoneLabel("3")).toBe("Z3");
    expect(formatZoneLabel("zone 3")).toBe("Z3");
    expect(formatZoneLabel("Z3")).toBe("Z3");
  });

  it("renders a contiguous range as Z<lo>-Z<hi>", () => {
    expect(formatZoneLabel("3-4")).toBe("Z3-Z4");
    expect(formatZoneLabel("Z2-Z4")).toBe("Z2-Z4");
  });

  it("renders a non-contiguous list with a slash, never a dash (would imply a range)", () => {
    expect(formatZoneLabel("z2,z4")).toBe("Z2/Z4");
  });

  it("falls back to the raw uppercased text for unparseable input", () => {
    expect(formatZoneLabel("bogus")).toBe("BOGUS");
  });
});
