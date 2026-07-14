import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetGenerationCache, dedupeGeneration, generationKey } from "./generate-cache";
import type { GenerationResult } from "./anthropic-api";

const result = (raw: string): GenerationResult => ({ toolInput: null, raw, truncated: false, stopReason: null });

afterEach(() => {
  _resetGenerationCache();
  vi.useRealTimers();
});

describe("generationKey", () => {
  it("is stable for identical parts and sensitive to each part", () => {
    const base = generationKey("a", "b", "c");
    expect(generationKey("a", "b", "c")).toBe(base);
    expect(generationKey("a", "b", "c2")).not.toBe(base);
    expect(generationKey("a", "b2", "c")).not.toBe(base);
    expect(generationKey("a2", "b", "c")).not.toBe(base);
  });

  it("does not collide across the part boundary", () => {
    expect(generationKey("ab", "c", "d")).not.toBe(generationKey("a", "bc", "d"));
  });
});

describe("dedupeGeneration", () => {
  it("runs compute once for concurrent identical requests (in-flight dedupe)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const compute = async () => {
      calls++;
      await gate;
      return result("plan");
    };

    const a = dedupeGeneration("k", compute);
    const b = dedupeGeneration("k", compute); // lands while the first is still in flight
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(calls).toBe(1);
    expect(ra.result.raw).toBe("plan");
    expect(rb.result.raw).toBe("plan");
    expect(ra.deduped).toBe(false); // the one that actually triggered the call
    expect(rb.deduped).toBe(true); // joined the in-flight call
  });

  it("runs compute per distinct key", async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return result("p");
    };
    await Promise.all([dedupeGeneration("k1", compute), dedupeGeneration("k2", compute)]);
    expect(calls).toBe(2);
  });

  it("evicts a failed generation so an identical retry re-runs", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(dedupeGeneration("k", failing)).rejects.toThrow("boom");
    await expect(dedupeGeneration("k", failing)).rejects.toThrow("boom");
    expect(calls).toBe(2); // not stuck returning the rejected promise
  });

  it("reuses a finished result within the window, re-runs after it expires", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const compute = async () => {
      calls++;
      return result(`p${calls}`);
    };

    const first = await dedupeGeneration("k", compute);
    expect(first.deduped).toBe(false);

    vi.advanceTimersByTime(30_000); // within the 60s window
    const within = await dedupeGeneration("k", compute);
    expect(within.deduped).toBe(true);
    expect(calls).toBe(1);

    vi.advanceTimersByTime(40_000); // now 70s since completion → expired
    const after = await dedupeGeneration("k", compute);
    expect(after.deduped).toBe(false);
    expect(calls).toBe(2);
  });
});
