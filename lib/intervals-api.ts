// Intervals.icu REST API client. All fetch calls to intervals.icu live here.
// Auth per official docs: HTTP Basic, username "API_KEY", password = the key.
// Endpoints per https://intervals.icu/api/v1/docs
import type {
  ActivitySummary,
  FitnessMetrics,
  IntervalsEventPayload,
  PowerCurvePoint,
  SyncData,
  WellnessEntry,
} from "./types";

const BASE_URL = "https://intervals.icu/api/v1";

// Best-effort durations requested by the spec: 5s … 60min.
export const POWER_CURVE_DURATIONS_SEC = [5, 15, 30, 60, 120, 300, 1200, 1800, 3600];

export class IntervalsApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "IntervalsApiError";
  }
}

function getConfig(): { athleteId: string; apiKey: string } | null {
  const athleteId = process.env.INTERVALS_ATHLETE_ID;
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!athleteId || !apiKey) return null;
  return { athleteId, apiKey };
}

export function isIntervalsConfigured(): boolean {
  return getConfig() !== null;
}

async function icuFetch(pathname: string, init?: RequestInit): Promise<unknown> {
  const config = getConfig();
  if (!config) {
    throw new IntervalsApiError(
      "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local."
    );
  }
  const auth = Buffer.from(`API_KEY:${config.apiKey}`).toString("base64");
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntervalsApiError(
      `Intervals.icu request failed (${res.status} ${res.statusText}) for ${pathname}: ${body.slice(0, 300)}`,
      res.status
    );
  }
  return res.json();
}

function athletePath(suffix: string): string {
  const config = getConfig();
  // icuFetch re-validates; this fallback keeps the type checker happy.
  const id = config?.athleteId ?? "";
  return `/athlete/${encodeURIComponent(id)}${suffix}`;
}

// ---------- defensive JSON helpers ----------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numArr(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const arr = value.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  return arr.some((v) => v > 0) ? arr : null;
}

function localDate(value: unknown): string {
  // "2026-06-01T09:30:00" -> "2026-06-01"
  return str(value).slice(0, 10);
}

// ---------- reads ----------

export async function fetchActivities(oldest: string, newest: string): Promise<ActivitySummary[]> {
  const data = await icuFetch(athletePath(`/activities?oldest=${oldest}&newest=${newest}`));
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const a = asRecord(item);
    const joules = num(a.icu_joules);
    return {
      id: String(a.id ?? ""),
      date: localDate(a.start_date_local),
      type: str(a.type, "Unknown"),
      name: str(a.name, "Untitled"),
      movingTimeSec: num(a.moving_time) ?? 0,
      avgWatts: num(a.icu_average_watts),
      normalizedPower: num(a.icu_normalized_power),
      maxWatts: num(a.max_watts),
      avgHr: num(a.average_heartrate),
      maxHr: num(a.max_heartrate),
      kj: joules !== null ? Math.round(joules / 1000) : null,
      trainingLoad: num(a.icu_training_load),
      rpe: num(a.icu_rpe),
      decoupling: num(a.icu_power_hr_decoupling),
      description: str(a.description) || null,
      avgCadence: num(a.average_cadence),
      distanceMeters: num(a.distance),
      elevationGain: num(a.total_elevation_gain),
      powerZoneTimes: numArr(a.icu_power_zone_times),
      hrZoneTimes: numArr(a.icu_hr_zone_times),
    };
  });
}

export async function fetchWellness(oldest: string, newest: string): Promise<WellnessEntry[]> {
  const data = await icuFetch(athletePath(`/wellness?oldest=${oldest}&newest=${newest}`));
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const w = asRecord(item);
    const sleepSecs = num(w.sleepSecs);
    return {
      date: localDate(w.id),
      weightKg: num(w.weight),
      hrv: num(w.hrv),
      sleepHours: sleepSecs !== null ? Math.round((sleepSecs / 3600) * 10) / 10 : null,
      sleepQuality: num(w.sleepQuality),
      kcalConsumed: num(w.kcalConsumed),
      ctl: num(w.ctl),
      atl: num(w.atl),
    };
  });
}

// The power-curves response shape is not pinned down in the public docs, so
// extraction tolerates the curve living at the top level or in a list, with
// watts under "watts", "values" or "power".
function extractCurve(data: unknown): PowerCurvePoint[] {
  const candidates: unknown[] = [data];
  const root = asRecord(data);
  for (const key of ["list", "curves", "powerCurves"]) {
    const value = root[key];
    if (Array.isArray(value)) candidates.push(...value);
  }
  for (const candidate of candidates) {
    const c = asRecord(candidate);
    const secs = c.secs;
    const watts = c.watts ?? c.values ?? c.power;
    if (
      Array.isArray(secs) &&
      Array.isArray(watts) &&
      secs.length > 0 &&
      secs.length === watts.length
    ) {
      const points: PowerCurvePoint[] = [];
      for (let i = 0; i < secs.length; i++) {
        const s = num(secs[i]);
        const w = num(watts[i]);
        if (s !== null && w !== null) points.push({ durationSec: s, watts: w });
      }
      return points;
    }
  }
  return [];
}

export async function fetchPowerCurve(): Promise<PowerCurvePoint[]> {
  // Best efforts over the last 84 days of rides.
  const data = await icuFetch(athletePath(`/power-curves?curves=84d&type=Ride`));
  const full = extractCurve(data);
  if (full.length === 0) return [];
  // Reduce the per-second curve to the spec's key durations (nearest point).
  return POWER_CURVE_DURATIONS_SEC.flatMap((target) => {
    let best: PowerCurvePoint | null = null;
    for (const p of full) {
      if (best === null || Math.abs(p.durationSec - target) < Math.abs(best.durationSec - target)) {
        best = p;
      }
    }
    // Drop targets the athlete has no data near (e.g. no 60min effort).
    if (!best || Math.abs(best.durationSec - target) > target * 0.2) return [];
    return [{ durationSec: target, watts: Math.round(best.watts) }];
  });
}

function latestFitness(wellness: WellnessEntry[]): FitnessMetrics {
  const sorted = [...wellness].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted.find((w) => w.ctl !== null && w.atl !== null);
  if (!latest || latest.ctl === null || latest.atl === null) {
    return { ctl: null, atl: null, tsb: null };
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    ctl: round1(latest.ctl),
    atl: round1(latest.atl),
    tsb: round1(latest.ctl - latest.atl),
  };
}

const SYNC_WINDOW_DAYS = 56; // 8 weeks

export async function runFullSync(): Promise<SyncData> {
  const newest = new Date().toISOString().slice(0, 10);
  const oldestDate = new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 3600 * 1000);
  const oldest = oldestDate.toISOString().slice(0, 10);

  const [activities, wellness, powerCurve] = await Promise.all([
    fetchActivities(oldest, newest),
    fetchWellness(oldest, newest),
    fetchPowerCurve(),
  ]);

  return {
    syncedAt: new Date().toISOString(),
    activities,
    wellness,
    powerCurve,
    fitness: latestFitness(wellness),
  };
}

// ---------- writes ----------

export async function createEvent(event: IntervalsEventPayload): Promise<number | null> {
  const data = await icuFetch(athletePath(`/events?upsertOnUid=false`), {
    method: "POST",
    body: JSON.stringify(event),
  });
  return num(asRecord(data).id);
}
