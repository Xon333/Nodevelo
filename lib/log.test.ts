import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logWarn } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  it("writes a structured line to console.error with the route/step/status shape", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("/api/sync", "quirk-extraction", new Error("boom"));
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ route: "/api/sync", step: "quirk-extraction", status: "error", message: "boom" });
  });

  it("stringifies a non-Error throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("/api/note", "post", "not an Error instance");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.message).toBe("not an Error instance");
  });
});

describe("logWarn", () => {
  it("writes a structured line to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("/api/disposition", "re-stamp-ledger", "best-effort — the next sync will re-derive");
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ route: "/api/disposition", status: "warn" });
  });
});
