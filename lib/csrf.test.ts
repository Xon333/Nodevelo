import { describe, expect, it } from "vitest";
import { isForbiddenCrossSiteWrite } from "./csrf";

describe("isForbiddenCrossSiteWrite (CR-D same-origin guard)", () => {
  const host = "localhost:3000";

  it("allows safe methods regardless of origin", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get", "options"]) {
      expect(isForbiddenCrossSiteWrite(m, "https://evil.example", host)).toBe(false);
    }
  });

  it("allows a same-origin write (origin host == request host)", () => {
    expect(isForbiddenCrossSiteWrite("POST", "http://localhost:3000", host)).toBe(false);
    expect(isForbiddenCrossSiteWrite("DELETE", "http://localhost:3000", host)).toBe(false);
  });

  it("blocks a cross-site write", () => {
    expect(isForbiddenCrossSiteWrite("POST", "https://evil.example", host)).toBe(true);
    expect(isForbiddenCrossSiteWrite("PUT", "http://localhost:3001", host)).toBe(true); // different port = different origin
  });

  it("allows a write with no Origin header (non-browser client — no CSRF vector)", () => {
    expect(isForbiddenCrossSiteWrite("POST", null, host)).toBe(false);
  });

  it("blocks a write with a malformed Origin", () => {
    expect(isForbiddenCrossSiteWrite("POST", "not-a-url", host)).toBe(true);
  });

  it("blocks a write when the Host header is missing (can't verify same-origin)", () => {
    expect(isForbiddenCrossSiteWrite("POST", "http://localhost:3000", null)).toBe(true);
  });

  it("is method-case-insensitive for writes", () => {
    expect(isForbiddenCrossSiteWrite("post", "https://evil.example", host)).toBe(true);
  });
});
