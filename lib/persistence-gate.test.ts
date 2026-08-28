import { describe, expect, it } from "vitest";
import { withExclusivePersistence, withPersistenceAccess } from "./persistence-gate";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("persistence gate", () => {
  it("lets active shared work finish, gives queued exclusive priority, then releases later shared work", async () => {
    const hold = deferred();
    const events: string[] = [];
    const first = withPersistenceAccess(async () => {
      events.push("shared-1-start");
      await hold.promise;
      events.push("shared-1-end");
    });
    await Promise.resolve();

    const exclusive = withExclusivePersistence(async () => {
      events.push("exclusive");
    });
    const second = withPersistenceAccess(async () => {
      events.push("shared-2");
    });
    await Promise.resolve();
    expect(events).toEqual(["shared-1-start"]);

    hold.resolve();
    await Promise.all([first, exclusive, second]);
    expect(events).toEqual(["shared-1-start", "shared-1-end", "exclusive", "shared-2"]);
  });

  it("releases queued shared work when exclusive work throws", async () => {
    const events: string[] = [];
    const exclusive = withExclusivePersistence(async () => {
      events.push("exclusive");
      throw new Error("swap failed");
    });
    const shared = withPersistenceAccess(async () => {
      events.push("shared");
    });
    await expect(exclusive).rejects.toThrow("swap failed");
    await shared;
    expect(events).toEqual(["exclusive", "shared"]);
  });

  it("allows a nested shared call to finish while an exclusive call is queued", async () => {
    const outerStarted = deferred();
    const enterInner = deferred();
    const events: string[] = [];
    const outer = withPersistenceAccess(async () => {
      events.push("outer");
      outerStarted.resolve();
      await enterInner.promise;
      await withPersistenceAccess(async () => {
        events.push("inner");
      });
    });
    await outerStarted.promise;
    const exclusive = withExclusivePersistence(async () => {
      events.push("exclusive");
    });
    enterInner.resolve();
    await outer;
    await exclusive;
    expect(events).toEqual(["outer", "inner", "exclusive"]);
  });
});
