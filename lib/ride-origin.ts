import type { RideOrigin, RideScoreEntry } from "./types";

export function originOf(entry: Pick<RideScoreEntry, "planned">): RideOrigin {
  return entry.planned ? "prescribed" : "unspecified";
}

export function countsAsDrift(origin: RideOrigin, legacy: boolean): boolean {
  return !legacy && origin === "unspecified";
}
