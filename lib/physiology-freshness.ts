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
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(iso.slice(0, 10) + "T00:00:00Z")) / 86_400_000);
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const status = asRecord(value);
  const validDate = (candidate: unknown) => candidate === undefined || (typeof candidate === "string" && Number.isFinite(Date.parse(candidate)));
  const validLocalDate = (candidate: unknown) => candidate === undefined || (typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate) && Number.isFinite(Date.parse(`${candidate}T00:00:00Z`)));
  return (
    validDate(status.lastAttemptAt) &&
    validLocalDate(status.lastAttemptDate) &&
    (status.lastOutcome === undefined ||
      status.lastOutcome === "confirmed" ||
      status.lastOutcome === "unavailable" ||
      status.lastOutcome === "invalid") &&
    (status.lastDetail === undefined || typeof status.lastDetail === "string") &&
    validDate(status.lastConfirmedAt) &&
    validLocalDate(status.lastConfirmedDate) &&
    validDate(status.markedObsoleteAt)
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
  mutate: (status: PhysiologyStatus) => PhysiologyStatus | Promise<PhysiologyStatus>,
  allowRecoveredLive: boolean
): Promise<PhysiologyStatus> {
  return updateJsonFile<unknown>(STATUS_FILE, {}, (raw, { liveCorrupt }) => {
    if (liveCorrupt && !allowRecoveredLive) return raw;
    if (!isPhysiologyStatus(raw)) return raw;
    return mutate(raw);
  }) as Promise<PhysiologyStatus>;
}

export async function recordPhysiologyCheck(
  now: string,
  outcome: "confirmed" | "unavailable" | "invalid",
  detail?: string,
  localDate?: string
): Promise<void> {
  await updatePhysiologyStatus((status) => {
    const next: PhysiologyStatus = {
      ...status,
      lastAttemptAt: now,
      ...(localDate ? { lastAttemptDate: localDate } : {}),
      lastOutcome: outcome,
      ...(detail !== undefined ? { lastDetail: detail } : {}),
      ...(outcome === "confirmed" ? { lastConfirmedAt: now, ...(localDate ? { lastConfirmedDate: localDate } : {}) } : {}),
    };
    if (outcome === "confirmed") delete next.markedObsoleteAt;
    return next;
  }, outcome === "confirmed");
}

export async function markPhysiologyObsolete(): Promise<void> {
  await updatePhysiologyStatus((status) => ({ ...status, markedObsoleteAt: new Date().toISOString() }), true);
}

export async function clearPhysiologyObsolete(): Promise<void> {
  await updatePhysiologyStatus((status) => {
    const { markedObsoleteAt: _drop, ...rest } = status;
    return rest;
  }, false);
}

export function validateSnapshotConsistency(
  snapshot: PhysiologySnapshot
): { ok: true } | { ok: false; reason: string } {
  if (!isFiniteNumber(snapshot.ftp) || snapshot.ftp <= 0) {
    return { ok: false, reason: `FTP ${String(snapshot.ftp)} is not a positive number` };
  }
  for (const [label, value] of [["effectiveFrom", snapshot.effectiveFrom], ["capturedAt", snapshot.capturedAt]] as const) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      return { ok: false, reason: `${label} is not a valid date` };
    }
  }
  for (const [label, value] of [["lthr", snapshot.lthr], ["maxHr", snapshot.maxHr]] as const) {
    if (value !== null && (!isFiniteNumber(value) || value <= 0)) {
      return { ok: false, reason: `${label} is not positive` };
    }
  }
  if (snapshot.powerZonePct.some((value) => !isFiniteNumber(value) || value <= 0) || snapshot.hrZones.some((value) => !isFiniteNumber(value) || value <= 0)) {
    return { ok: false, reason: "physiology zone bounds are not positive finite numbers" };
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
    return { state: "malformed", reason: "physiology.json does not parse", lastConfirmedAt: status?.lastConfirmedAt ?? null, ...(status?.lastConfirmedDate ? { lastConfirmedDate: status.lastConfirmedDate } : {}) };
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

  const confirmedAt = status?.lastConfirmedAt ?? null;
  const consistency = validateSnapshotConsistency(store.current);
  if (!consistency.ok) {
    return { state: "inconsistent", reason: consistency.reason, lastConfirmedAt: confirmedAt, ...(status?.lastConfirmedDate ? { lastConfirmedDate: status.lastConfirmedDate } : {}) };
  }
  if (status?.markedObsoleteAt) {
    return { state: "obsolete", markedObsoleteAt: status.markedObsoleteAt, lastConfirmedAt: confirmedAt, ...(status.lastConfirmedDate ? { lastConfirmedDate: status.lastConfirmedDate } : {}) };
  }

  const confirmedAge = status?.lastConfirmedDate ? ageDays(status.lastConfirmedDate, today) : null;
  const attemptAge = status?.lastAttemptDate ? ageDays(status.lastAttemptDate, today) : null;
  if ((confirmedAge !== null && confirmedAge < 0) || (attemptAge !== null && attemptAge < 0)) {
    return { state: "malformed", reason: "physiology freshness dates are in the future", lastConfirmedAt: confirmedAt };
  }

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
      ...(status.lastConfirmedDate ? { lastConfirmedDate: status.lastConfirmedDate } : {}),
    };
  }

  if (confirmedAge === null || confirmedAge > PHYSIOLOGY_STALE_DAYS) {
    return { state: "stale", lastConfirmedAt: confirmedAt, ...(status?.lastConfirmedDate ? { lastConfirmedDate: status.lastConfirmedDate } : {}), ageDays: confirmedAge };
  }

  return {
    state: "fresh",
    confirmedAt: confirmedAt!,
    ...(status?.lastConfirmedDate ? { confirmedDate: status.lastConfirmedDate } : {}),
    effectiveFrom: store.current.effectiveFrom,
  };
}

export function assessPhysiologyFreshnessFromReads(
  physiology: Pick<Awaited<ReturnType<typeof import("./physiology").readPhysiologyWithStatus>>, "store" | "corruptFallback" | "fileExisted">,
  statusRead: Awaited<ReturnType<typeof readPhysiologyStatus>>,
  today: string
): PhysiologyFreshness {
  return assessPhysiologyFreshness({
    store: physiology.store,
    corruptFallback: physiology.corruptFallback,
    fileExisted: physiology.fileExisted,
    statusCorrupt: statusRead.corruptFallback || statusRead.liveCorrupt,
    status: statusRead.status,
    today,
  });
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
      return "Physiology was marked obsolete. Re-sync from Intervals.icu (or clear the marker on Profile) before generating a block.";
    default:
      return null;
  }
}

export function physiologyGenerationWarning(f: PhysiologyFreshness): string | null {
  if (f.state === "sync-failed") {
    return `Generating on physiology last confirmed ${f.lastConfirmedDate ?? "at an unknown time"}; the latest check failed (${f.lastDetail}).`;
  }
  if (f.state === "stale") {
    return `Physiology has not been confirmed in ${f.ageDays ?? "an unknown number of"} days; zones and TSS may be outdated.`;
  }
  return null;
}
