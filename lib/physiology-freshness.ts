import type { PhysiologySnapshot, PhysiologyStatus, PhysiologyStore } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

export function isPhysiologySnapshot(value: unknown): value is PhysiologySnapshot {
  const snapshot = asRecord(value);
  return (
    typeof snapshot.effectiveFrom === "string" &&
    typeof snapshot.capturedAt === "string" &&
    (snapshot.source === "intervals" || snapshot.source === "manual") &&
    isFiniteNumber(snapshot.ftp) &&
    isNullableFiniteNumber(snapshot.lthr) &&
    isNullableFiniteNumber(snapshot.maxHr) &&
    isFiniteNumberArray(snapshot.powerZonePct) &&
    isFiniteNumberArray(snapshot.hrZones) &&
    typeof snapshot.hrZonesAreBpm === "boolean" &&
    isStringArray(snapshot.powerZoneNames) &&
    isStringArray(snapshot.hrZoneNames)
  );
}

export function isPhysiologyStore(value: unknown): value is PhysiologyStore {
  const store = asRecord(value);
  return isPhysiologySnapshot(store.current) && Array.isArray(store.history) && store.history.every(isPhysiologySnapshot);
}

export function isPhysiologyStatus(value: unknown): value is PhysiologyStatus {
  const status = asRecord(value);
  return (
    (status.lastAttemptAt === undefined || typeof status.lastAttemptAt === "string") &&
    (status.lastOutcome === undefined ||
      status.lastOutcome === "confirmed" ||
      status.lastOutcome === "unavailable" ||
      status.lastOutcome === "invalid") &&
    (status.lastDetail === undefined || typeof status.lastDetail === "string") &&
    (status.lastConfirmedAt === undefined || typeof status.lastConfirmedAt === "string") &&
    (status.markedObsoleteAt === undefined || typeof status.markedObsoleteAt === "string")
  );
}
