import { describe, expect, it } from "vitest";
import { parseCalendarEvents } from "./intervals-api";

describe("parseCalendarEvents", () => {
  it("maps the fields the mirror needs and takes the date part of start_date_local", () => {
    const raw = [
      { id: 111, uid: "nodevelo-2026-07-10", external_id: "nodevelo-2026-07-10", start_date_local: "2026-07-10T00:00:00", name: "Durability C", description: "3h Z2…", category: "WORKOUT", type: "Ride" },
      { id: 222, uid: null, external_id: null, start_date_local: "2026-07-11T09:30:00", name: "note", description: "", category: "NOTE" },
    ];
    expect(parseCalendarEvents(raw)).toEqual([
      { id: 111, uid: "nodevelo-2026-07-10", externalId: "nodevelo-2026-07-10", date: "2026-07-10", name: "Durability C", description: "3h Z2…", category: "WORKOUT", type: "Ride" },
      { id: 222, uid: null, externalId: null, date: "2026-07-11", name: "note", description: "", category: "NOTE", type: null },
    ]);
  });

  it("drops malformed entries instead of throwing", () => {
    expect(parseCalendarEvents([{ id: 1 }, "junk", null])).toEqual([]);
    expect(parseCalendarEvents("not-an-array")).toEqual([]);
  });
});
