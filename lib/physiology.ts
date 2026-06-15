// The physiology store: the single source of truth for time-varying physiology
// (FTP, power/HR zones, threshold/max HR). Pulled from Intervals.icu sport-settings on
// sync and effective-dated, so every analysis can be anchored to the FTP/zones that were
// live when a ride happened — past entries never silently re-shift when FTP changes.
//
// Pure logic (parse / resolve / as-of / reconcile) is exported for testing; file IO lives
// here too (like kb-loader) to avoid a data-store ↔ physiology import cycle.
import { promises as fs } from "fs";
import path from "path";
import type { PhysiologySnapshot, PhysiologyStore } from "./types";
import type { Zone } from "./zones";
import { readMdHrZones, readMdPowerZones } from "./kb-loader";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = "physiology.json";

// ---------- defensive helpers ----------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

// Intervals stores zones as ascending upper bounds. Coerce to numbers, drop a leading 0
// (some responses include it, some don't), and keep them strictly ascending.
function cleanBounds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const nums = value.map((v) => num(v)).filter((v): v is number => v !== null);
  const trimmed = nums[0] === 0 ? nums.slice(1) : nums;
  const out: number[] = [];
  for (const b of trimmed) {
    if (b > 0 && (out.length === 0 || b > out[out.length - 1])) out.push(b);
  }
  return out;
}

// ---------- parse Intervals sport-settings → snapshot ----------

// Intervals.icu /athlete/{id}/sport-settings returns a list of per-sport settings. We take
// the Ride/VirtualRide setting (the one that carries cycling FTP + power zones). power_zones
// are % of FTP; hr_zones are bpm or % of LTHR. Returns null if no usable FTP is present.
export function parseSportSettings(raw: unknown, today: string): PhysiologySnapshot | null {
  const rootList = Array.isArray(raw)
    ? raw
    : (() => {
        const r = asRecord(raw);
        const candidate = r.sportSettings ?? r.list ?? r.settings;
        return Array.isArray(candidate) ? candidate : [];
      })();
  const settings = rootList.map(asRecord);
  if (settings.length === 0) return null;

  const hasRideType = (s: Record<string, unknown>) => {
    const types = strArr(s.types);
    return types.includes("Ride") || types.includes("VirtualRide");
  };
  const ride =
    settings.find((s) => hasRideType(s) && num(s.ftp) !== null) ??
    settings.find((s) => num(s.ftp) !== null);
  if (!ride) return null;

  const ftp = num(ride.ftp);
  if (ftp === null || ftp <= 0) return null;

  const hrBounds = cleanBounds(ride.hr_zones);
  // HR zones as % of LTHR top out around 130%; absolute bpm reach ~190–210. Use that gap
  // to tell them apart (Intervals doesn't expose a unit flag).
  const hrZonesAreBpm = hrBounds.length > 0 && Math.max(...hrBounds) > 150;

  return {
    effectiveFrom: today,
    capturedAt: new Date().toISOString(),
    source: "intervals",
    ftp,
    lthr: num(ride.lthr),
    maxHr: num(ride.max_hr),
    powerZonePct: cleanBounds(ride.power_zones),
    hrZones: hrBounds,
    hrZonesAreBpm,
    powerZoneNames: strArr(ride.power_zone_names),
    hrZoneNames: strArr(ride.hr_zone_names),
  };
}

// ---------- resolve a snapshot → absolute zones ----------

// Ascending upper bounds → contiguous zones; the final zone is open (hi = null).
function boundsToZones(uppers: number[], names: string[]): Zone[] {
  const out: Zone[] = [];
  let lo = 0;
  uppers.forEach((hi, i) => {
    out.push({ name: names[i] ?? `Z${i + 1}`, lo, hi });
    lo = hi;
  });
  out.push({ name: names[uppers.length] ?? `Z${uppers.length + 1}`, lo, hi: null });
  return out;
}

export function resolvePowerZones(s: PhysiologySnapshot): Zone[] {
  if (s.powerZonePct.length === 0 || s.ftp <= 0) return [];
  return boundsToZones(
    s.powerZonePct.map((pct) => Math.round((pct / 100) * s.ftp)),
    s.powerZoneNames
  );
}

export function resolveHrZones(s: PhysiologySnapshot): Zone[] {
  if (s.hrZones.length === 0) return [];
  const anchor = s.lthr ?? s.maxHr;
  const uppers = s.hrZonesAreBpm
    ? s.hrZones
    : anchor
      ? s.hrZones.map((pct) => Math.round((pct / 100) * anchor))
      : s.hrZones;
  return boundsToZones(uppers, s.hrZoneNames);
}

// ---------- effective-dating + reconciliation (pure) ----------

// The snapshot in effect on `date`: the latest whose effectiveFrom ≤ date. Dates before the
// earliest snapshot resolve to the earliest (best-effort anchor for old rides).
export function physiologyAsOf(store: PhysiologyStore | null, date: string): PhysiologySnapshot | null {
  if (!store) return null;
  const all = [...store.history, store.current].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let pick: PhysiologySnapshot | null = all[0] ?? null;
  for (const s of all) {
    if (s.effectiveFrom <= date) pick = s;
    else break;
  }
  return pick;
}

// Two snapshots describe the same physiology if FTP and the zone definitions match.
function samePhysiology(a: PhysiologySnapshot, b: PhysiologySnapshot): boolean {
  return (
    a.ftp === b.ftp &&
    a.lthr === b.lthr &&
    a.maxHr === b.maxHr &&
    JSON.stringify(a.powerZonePct) === JSON.stringify(b.powerZonePct) &&
    JSON.stringify(a.hrZones) === JSON.stringify(b.hrZones)
  );
}

// Fold an incoming snapshot into the store. Unchanged → keep the existing effective date.
// Changed → archive the old current and start the incoming one effective today.
export function reconcile(
  prev: PhysiologyStore | null,
  incoming: PhysiologySnapshot,
  today: string
): { store: PhysiologyStore; changed: boolean } {
  if (!prev) {
    return { store: { current: incoming, history: [] }, changed: false };
  }
  if (samePhysiology(prev.current, incoming)) {
    // No physiological change — refresh metadata/source but keep the original effective date.
    const merged: PhysiologySnapshot = {
      ...incoming,
      effectiveFrom: prev.current.effectiveFrom,
      capturedAt: prev.current.capturedAt,
    };
    return { store: { current: merged, history: prev.history }, changed: false };
  }
  return {
    store: {
      current: { ...incoming, effectiveFrom: today },
      history: [...prev.history, prev.current],
    },
    changed: true,
  };
}

// ---------- persistence ----------

export async function readPhysiology(): Promise<PhysiologyStore | null> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, FILE), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const r = asRecord(parsed);
    if (!r.current) return null;
    return parsed as PhysiologyStore;
  } catch {
    return null;
  }
}

export async function writePhysiology(store: PhysiologyStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, FILE), JSON.stringify(store, null, 2) + "\n", "utf-8");
}

// ---------- snapshot-first zone reads (md is the fallback) ----------

export async function readPowerZones(): Promise<Zone[]> {
  const store = await readPhysiology();
  if (store) {
    const z = resolvePowerZones(store.current);
    if (z.length > 0) return z;
  }
  return readMdPowerZones();
}

export async function readHrZones(): Promise<Zone[]> {
  const store = await readPhysiology();
  if (store) {
    const z = resolveHrZones(store.current);
    if (z.length > 0) return z;
  }
  return readMdHrZones();
}
