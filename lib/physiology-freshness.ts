import type {
  PhysiologyFreshness,
  PhysiologySnapshot,
  PhysiologyStatus,
  PhysiologyStore,
} from "./types";
import { readJsonFileWithStatus, updateJsonFile } from "./json-store";

const STATUS_FILE = "physiology-status.json";

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

function isStrictlyAscendingFiniteNumberArray(value: unknown): value is number[] {
  return (
    isFiniteNumberArray(value) &&
    value.every((entry, index) => index === 0 || entry > value[index - 1])
  );
}

export const PHYSIOLOGY_STALE_DAYS = 90;

function parseDateValue(label: string, value: string): number | { reason: string } {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : { reason: `${label} "${value}" is not a valid date` };
}

function ageDays(iso: string, today: string): number {
  return Math.floor((Date.parse(today) - Date.parse(iso)) / 86_400_000);
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

export async function readPhysiologyStatus(): Promise<{
  status: PhysiologyStatus;
  corruptFallback: boolean;
  liveCorrupt: boolean;
}> {
  const { value, corruptFallback, liveCorrupt, enoent } = await readJsonFileWithStatus<unknown>(STATUS_FILE, null);
  const valid = !enoent && isPhysiologyStatus(value);
  return {
    status: valid ? value : {},
    corruptFallback: corruptFallback || (!enoent && !valid),
    liveCorrupt,
  };
}

async function updatePhysiologyStatus(
  mutate: (status: PhysiologyStatus) => PhysiologyStatus | Promise<PhysiologyStatus>
): Promise<PhysiologyStatus> {
  return updateJsonFile<unknown>(STATUS_FILE, {}, (raw) => mutate(isPhysiologyStatus(raw) ? raw : {})) as Promise<PhysiologyStatus>;
}

export async function recordPhysiologyCheck(
  now: string,
  outcome: "confirmed" | "unavailable" | "invalid",
  detail?: string
): Promise<void> {
  await updatePhysiologyStatus((status) => {
    const next: PhysiologyStatus = {
      ...status,
      lastAttemptAt: now,
      lastOutcome: outcome,
      ...(detail !== undefined ? { lastDetail: detail } : {}),
      ...(outcome === "confirmed" ? { lastConfirmedAt: now } : {}),
    };
    if (outcome === "confirmed") delete next.markedObsoleteAt;
    return next;
  });
}

export async function markPhysiologyObsolete(): Promise<void> {
  await updatePhysiologyStatus((status) => ({ ...status, markedObsoleteAt: new Date().toISOString() }));
}

export async function clearPhysiologyObsolete(): Promise<void> {
  await updatePhysiologyStatus((status) => {
    const { markedObsoleteAt: _drop, ...rest } = status;
    return rest;
  });
}

export function validateSnapshotConsistency(
  snapshot: PhysiologySnapshot
): { ok: true } | { ok: false; reason: string } {
  if (!isFiniteNumber(snapshot.ftp) || snapshot.ftp <= 0) {
    return { ok: false, reason: `FTP ${String(snapshot.ftp)} is not a positive number` };
  }
  if (!isStrictlyAscendingFiniteNumberArray(snapshot.powerZonePct)) {
    return { ok: false, reason: "power-zone bounds are not strictly ascending" };
  }
  if (!isStrictlyAscendingFiniteNumberArray(snapshot.hrZones)) {
    return { ok: false, reason: "HR-zone bounds are not strictly ascending" };
  }
  if (
    !snapshot.hrZonesAreBpm &&
    snapshot.hrZones.length > 0 &&
    snapshot.lthr === null &&
    snapshot.maxHr === null
  ) {
    return { ok: false, reason: "percent-of-LTHR HR zones have no LTHR/max-HR anchor" };
  }
  if (snapshot.lthr !== null && snapshot.maxHr !== null && snapshot.lthr > snapshot.maxHr) {
    return { ok: false, reason: `LTHR ${snapshot.lthr} exceeds max HR ${snapshot.maxHr}` };
  }
  return { ok: true };
}

export function assessPhysiologyFreshness(input: {
  store: PhysiologyStore | null;
  corruptFallback: boolean;
  fileExisted: boolean;
  statusCorrupt: boolean;
  status: PhysiologyStatus | undefined;
  today: string;
}): PhysiologyFreshness {
  const { store, corruptFallback, fileExisted, statusCorrupt, status, today } = input;

  if (corruptFallback) {
    return { state: "malformed", reason: "physiology.json does not parse" };
  }
  if (statusCorrupt) {
    return { state: "malformed", reason: "physiology freshness records are unreadable" };
  }
  if (store === null && fileExisted) {
    return {
      state: "malformed",
      reason: "physiology.json parsed but has no usable current snapshot",
    };
  }

  const parsedToday = parseDateValue("today", today);
  if (typeof parsedToday !== "number") {
    return { state: "malformed", reason: parsedToday.reason };
  }

  for (const [label, value] of [
    ["lastAttemptAt", status?.lastAttemptAt],
    ["lastConfirmedAt", status?.lastConfirmedAt],
    ["markedObsoleteAt", status?.markedObsoleteAt],
  ] as const) {
    if (value === undefined) {
      continue;
    }
    const parsed = parseDateValue(label, value);
    if (typeof parsed !== "number") {
      return { state: "malformed", reason: parsed.reason };
    }
  }

  if (store === null) {
    return { state: "missing" };
  }

  const consistency = validateSnapshotConsistency(store.current);
  if (!consistency.ok) {
    return { state: "inconsistent", reason: consistency.reason };
  }

  if (status?.markedObsoleteAt) {
    return { state: "obsolete", markedObsoleteAt: status.markedObsoleteAt };
  }

  const confirmedAt = status?.lastConfirmedAt ?? null;
  const confirmedAge = confirmedAt === null ? null : ageDays(confirmedAt, today);
  const attemptAge = status?.lastAttemptAt ? ageDays(status.lastAttemptAt, today) : null;

  if (
    status?.lastOutcome &&
    status.lastOutcome !== "confirmed" &&
    attemptAge !== null &&
    attemptAge <= PHYSIOLOGY_STALE_DAYS &&
    confirmedAge !== null &&
    confirmedAge <= PHYSIOLOGY_STALE_DAYS
  ) {
    return {
      state: "sync-failed",
      lastAttemptAt: status.lastAttemptAt!,
      lastDetail: status.lastDetail ?? "the last physiology check did not succeed",
      lastConfirmedAt: confirmedAt,
    };
  }

  if (confirmedAge === null || confirmedAge > PHYSIOLOGY_STALE_DAYS) {
    return { state: "stale", lastConfirmedAt: confirmedAt, ageDays: confirmedAge };
  }

  return {
    state: "fresh",
    confirmedAt: confirmedAt!,
    effectiveFrom: store.current.effectiveFrom,
  };
}

export function physiologyGenerationBlock(f: PhysiologyFreshness): string | null {
  switch (f.state) {
    case "missing":
      return "Physiology has never been established: connect Intervals.icu and run a sync before generating a block.";
    case "malformed":
      return `Physiology store is unreadable (${f.reason}). Restore its backup or re-sync before generating a block.`;
    case "inconsistent":
      return `Physiology data is internally inconsistent (${f.reason}). Refresh from Intervals.icu before generating a block.`;
    case "obsolete":
      return `Physiology was marked obsolete on ${f.markedObsoleteAt.slice(0, 10)}. Re-sync from Intervals.icu (or clear the marker on Profile) before generating a block.`;
    default:
      return null;
  }
}

export function physiologyGenerationWarning(f: PhysiologyFreshness): string | null {
  if (f.state === "sync-failed") {
    return `Generating on physiology last confirmed ${
      f.lastConfirmedAt ? f.lastConfirmedAt.slice(0, 10) : "at an unknown time"
    }; the latest check failed (${f.lastDetail}).`;
  }
  if (f.state === "stale") {
    return `Physiology has not been confirmed in ${f.ageDays ?? "an unknown number of"} days; zones and TSS may be outdated.`;
  }
  return null;
}
