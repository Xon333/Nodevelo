// Intervals.icu REST API client. All fetch calls to intervals.icu live here.
// Auth per official docs: HTTP Basic, username "API_KEY", password = the key.
// Endpoints per https://intervals.icu/api/v1/docs
import type {
  ActivitySummary,
  ExecutedInterval,
  FitnessMetrics,
  IntervalsEventPayload,
  PhysiologySnapshot,
  PowerCurvePoint,
  SyncData,
  WellnessEntry,
} from "./types";
import { parseSportSettings } from "./physiology";

const BASE_URL = "https://intervals.icu/api/v1";

// Per-request network timeout (CR-B). Without it a hung Intervals.icu socket hangs the whole sync
// indefinitely — and with auto-sync-on-open that's a spinner that never resolves. 20s is generous
// for the largest list (6 months of activities) while still failing fast on a dead connection.
const REQUEST_TIMEOUT_MS = 20_000;

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
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
      // Abort a stalled request instead of hanging forever (CR-B). The caller's own catch turns
      // this into the same IntervalsApiError path as any other network failure.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new IntervalsApiError(
      timedOut
        ? `Intervals.icu request timed out after ${REQUEST_TIMEOUT_MS / 1000}s for ${pathname}.`
        : `Intervals.icu request failed for ${pathname}: ${e instanceof Error ? e.message : "network error"}`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntervalsApiError(
      `Intervals.icu request failed (${res.status} ${res.statusText}) for ${pathname}: ${body.slice(0, 300)}`,
      res.status
    );
  }
  // A 2xx with an empty or non-JSON body is an upstream anomaly — degrade to null rather than
  // throwing a cryptic parse error mid-sync. Every caller guards with asRecord/Array.isArray,
  // so null flows through as "no data" (graceful) instead of crashing the request.
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

// A power reading of exactly 0 is "no power" (e.g. a sensor dropout serialised as 0), not a real 0 W
// effort — treat it as absent so a `??` fallback isn't masked and IF isn't computed off a phantom zero (API-1).
function numPos(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

// Like num(), but also accepts a numeric string — some intervals.icu fields (e.g. decoupling) can
// serialise as strings depending on endpoint/version; a bare typeof-number guard would silently drop
// them (API-2). Non-numeric or empty strings still → null.
function numLoose(value: unknown): number | null {
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return num(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Zone-time arrays from Intervals come in two shapes depending on endpoint/version: a raw
// seconds array, or an array of objects ({ secs } | { time } | { seconds }). Parse both so
// time-in-zone (polarization, trend-pulse zones) doesn't silently fall back to average power.
function zoneSecs(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const arr = value.map((v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const n = o.secs ?? o.time ?? o.seconds ?? o.s;
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    }
    return 0;
  });
  return arr.some((v) => v > 0) ? arr : null;
}

function localDate(value: unknown): string {
  // "2026-06-01T09:30:00" -> "2026-06-01"
  return str(value).slice(0, 10);
}

// ---------- reads ----------

// Per-sample stream for one activity (e.g. "watts" or "heartrate"), so the metric can
// be re-bucketed into the athlete's own zones. Best-effort: [] on any failure.
async function fetchActivityStream(activityId: string, type: string): Promise<number[]> {
  if (!activityId) return [];
  try {
    const data = await icuFetch(`/activity/${encodeURIComponent(activityId)}/streams?types=${type}`);
    let raw: unknown = null;
    if (Array.isArray(data)) {
      const s = data.find((entry) => asRecord(entry).type === type);
      raw = s ? asRecord(s).data : null;
    } else {
      const rec = asRecord(data);
      raw = asRecord(rec[type]).data ?? rec[type];
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  } catch {
    return [];
  }
}

export function fetchHrStream(activityId: string): Promise<number[]> {
  return fetchActivityStream(activityId, "heartrate");
}

export function fetchPowerStream(activityId: string): Promise<number[]> {
  return fetchActivityStream(activityId, "watts");
}

// The activity's intervals as curated in Intervals.icu (where the athlete adjusts
// detection). Best-effort: [] on failure. Field names tolerate API shape variation.
export async function fetchIntervals(activityId: string): Promise<ExecutedInterval[]> {
  if (!activityId) return [];
  try {
    const data = await icuFetch(`/activity/${encodeURIComponent(activityId)}/intervals`);
    const rec = asRecord(data);
    const list = Array.isArray(data) ? data : Array.isArray(rec.icu_intervals) ? rec.icu_intervals : [];
    return (list as unknown[]).map((it) => {
      const iv = asRecord(it);
      return {
        type: str(iv.type).toUpperCase(),
        durationSec: num(iv.moving_time) ?? num(iv.elapsed_time) ?? 0,
        avgWatts: num(iv.average_watts) ?? num(iv.icu_average_watts),
        npWatts: numPos(iv.weighted_average_watts) ?? numPos(iv.icu_weighted_avg_watts),
        avgHr: num(iv.average_heartrate) ?? num(iv.icu_average_hr),
        startIndex: num(iv.start_index),
        endIndex: num(iv.end_index),
      };
    });
  } catch {
    return [];
  }
}

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
      // intervals.icu exposes normalized/weighted power as `icu_weighted_avg_watts` (NOT
      // `icu_normalized_power`, which it doesn't return), max power as `icu_pm_p_max`, and decoupling
      // as a bare `decoupling`. The old keys read null on every ride — which silently dropped IF back
      // to raw avg watts (a VO2 day read as recovery) and zeroed decoupling/its baseline. Old keys
      // kept as defensive fallbacks.
      normalizedPower: numPos(a.icu_weighted_avg_watts) ?? numPos(a.icu_normalized_power),
      maxWatts: num(a.icu_pm_p_max) ?? num(a.max_watts),
      // The FTP intervals.icu APPLIED to this ride (its own per-activity record, which can differ from
      // the current settings FTP). The authoritative per-ride scoring anchor (RV-5); 0/absent → null so
      // scoring falls back to the effective-dated physiology store.
      // Deliberately `icu_ftp`, NOT `icu_eftp`: eFTP is the per-ride *estimated* FTP (fluctuates with the
      // day's effort) — not the athlete's actual set FTP. Never fall back to it here.
      icuFtp: numPos(a.icu_ftp),
      avgHr: num(a.average_heartrate),
      maxHr: num(a.max_heartrate),
      kj: joules !== null ? Math.round(joules / 1000) : null,
      trainingLoad: num(a.icu_training_load),
      rpe: num(a.icu_rpe),
      carbsIngestedG: num(a.carbs_ingested), // "CHO In" — athlete-logged carbohydrate intake (g), often unset
      decoupling: numLoose(a.decoupling) ?? numLoose(a.icu_power_hr_decoupling),
      efficiencyFactor: num(a.icu_efficiency_factor),
      // Z2-isolated Pw:HR + the Z2 minutes behind it — the athlete-state aerobic signal (see ActivitySummary).
      powerHrZ2: numPos(a.icu_power_hr_z2),
      powerHrZ2Mins: num(a.icu_power_hr_z2_mins),
      description: str(a.description) || null,
      avgCadence: num(a.average_cadence),
      distanceMeters: num(a.distance),
      elevationGain: num(a.total_elevation_gain),
      powerZoneTimes: zoneSecs(a.icu_power_zone_times ?? a.icu_zone_times),
      hrZoneTimes: zoneSecs(a.icu_hr_zone_times),
    };
  });
}

// The athlete's per-sport settings (FTP, power/HR zones, threshold/max HR) — the source of
// truth for physiology. Best-effort: null on any failure so a missing endpoint never breaks
// sync. The Ride setting is selected and mapped to a snapshot in parseSportSettings.
export async function fetchSportSettings(
  today: string = new Date().toISOString().slice(0, 10)
): Promise<PhysiologySnapshot | null> {
  try {
    const data = await icuFetch(athletePath(`/sport-settings`));
    return parseSportSettings(data, today);
  } catch {
    return null;
  }
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
      // Subjective self-report (Intervals.icu 1–4, higher = worse — see WellnessEntry). Sourced here so
      // the morning read comes from the athlete's existing Intervals.icu logging, not a separate form.
      soreness: num(w.soreness),
      fatigue: num(w.fatigue),
      stress: num(w.stress),
      mood: num(w.mood),
      motivation: num(w.motivation),
      injury: num(w.injury),
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

// Reduce a per-second power curve to the spec's key durations (nearest point), dropping targets
// the athlete has no data near (e.g. no 60-min effort). The match tolerance is a clamped percentage
// (RV2-13): a flat 20% is ±1s at a 5s target (too strict — drops valid points) and ±12min at 60min
// (too loose — would match a 48-min effort to the 60-min slot). Clamp to [5s, 120s].
const CURVE_MATCH_MIN_TOL_SEC = 5;
const CURVE_MATCH_MAX_TOL_SEC = 120;
function reduceToKeyDurations(full: PowerCurvePoint[]): PowerCurvePoint[] {
  if (full.length === 0) return [];
  return POWER_CURVE_DURATIONS_SEC.flatMap((target) => {
    let best: PowerCurvePoint | null = null;
    for (const p of full) {
      if (best === null || Math.abs(p.durationSec - target) < Math.abs(best.durationSec - target)) {
        best = p;
      }
    }
    const tol = Math.min(CURVE_MATCH_MAX_TOL_SEC, Math.max(CURVE_MATCH_MIN_TOL_SEC, target * 0.2));
    if (!best || Math.abs(best.durationSec - target) > tol) return [];
    return [{ durationSec: target, watts: Math.round(best.watts) }];
  });
}

async function fetchCurve(spec: string): Promise<PowerCurvePoint[]> {
  const data = await icuFetch(athletePath(`/power-curves?curves=${spec}&type=Ride`));
  return reduceToKeyDurations(extractCurve(data));
}

// Best efforts over the last 84 days — the recent-form curve (intervention markers, generation).
export function fetchPowerCurve(): Promise<PowerCurvePoint[]> {
  return fetchCurve("84d");
}

// All-time best efforts — the athlete's true PRs. Monotonic (only rises), so it's the stable
// baseline for PR detection + the Profile "all-time PRs" display.
export function fetchPowerCurveAllTime(): Promise<PowerCurvePoint[]> {
  return fetchCurve("all");
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

// 26 weeks (~6 months). Wide enough for a meaningful CTL trajectory (CTL has a 42-day
// time constant), to make the "90-day" rolling baselines honest, and to give the second
// brain multiple blocks of trend history. Cost is one larger activities/wellness JSON list
// per sync — no extra per-activity stream calls — so app performance is unaffected.
export const SYNC_WINDOW_DAYS = 182;

// All-time best efforts only ever rise, so the stored all-time curve must be monotonic — PR detection
// and the Profile "all-time PRs" both depend on it. Merge the fresh fetch with the previous all-time,
// taking the higher watts per duration: this preserves every known best even if a fetch is missing or
// returns a partial/regressed curve, which the old `fresh || 84-day` fallback did not (it mislabelled
// recent efforts as all-time and could surface a false PR "drop"). The 84-day recent curve is used
// only as a last resort on the very first sync, when there's no prior all-time yet. (CR-H)
export function resolveAllTimeCurve(
  freshAllTime: PowerCurvePoint[],
  prevAllTime: PowerCurvePoint[],
  recentCurve: PowerCurvePoint[]
): PowerCurvePoint[] {
  if (freshAllTime.length === 0 && prevAllTime.length === 0) return recentCurve;
  const best = new Map<number, number>();
  for (const p of prevAllTime) best.set(p.durationSec, p.watts);
  for (const p of freshAllTime) {
    const cur = best.get(p.durationSec);
    if (cur === undefined || p.watts > cur) best.set(p.durationSec, p.watts);
  }
  return [...best.entries()]
    .map(([durationSec, watts]) => ({ durationSec, watts }))
    .sort((a, b) => a.durationSec - b.durationSec);
}

export async function runFullSync(prevAllTime: PowerCurvePoint[] = []): Promise<SyncData> {
  const newest = new Date().toISOString().slice(0, 10);
  const oldestDate = new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 3600 * 1000);
  const oldest = oldestDate.toISOString().slice(0, 10);

  const [activities, wellness, powerCurve, allTime] = await Promise.all([
    fetchActivities(oldest, newest),
    fetchWellness(oldest, newest),
    fetchPowerCurve(),
    fetchPowerCurveAllTime().catch(() => [] as PowerCurvePoint[]),
  ]);

  return {
    syncedAt: new Date().toISOString(),
    activities,
    wellness,
    powerCurve,
    powerCurveAllTime: resolveAllTimeCurve(allTime, prevAllTime, powerCurve),
    fitness: latestFitness(wellness),
  };
}

// A sync that returns NO activities AND NO wellness when the previous sync had data is almost always
// an upstream hiccup (auth blip, response-shape change, partial outage) — not a real account reset.
// Persisting it would blank the dashboard and recompute the 90-day rolling baselines from an empty
// list, and the silent empty would be indistinguishable from a legitimately empty account (CR-C).
// Callers use this to refuse the overwrite and surface a real error instead of quietly wiping data.
export function isSuspectEmptySync(prev: SyncData | null, fresh: SyncData): boolean {
  if (!prev) return false; // first sync — an empty result is just an empty/new account, nothing to guard
  const prevHadData = prev.activities.length > 0 || prev.wellness.length > 0;
  const freshEmpty = fresh.activities.length === 0 && fresh.wellness.length === 0;
  return prevHadData && freshEmpty;
}

// ---------- writes ----------

// Delete one calendar event by id (DELETE /athlete/{id}/events/{eventId}). Used to roll back a
// partially-written block and to clear a block's planned-workout events when it's discarded/replaced
// (RV-9). Throws IntervalsApiError on failure so the bulk wrapper can report which ids didn't delete.
export async function deleteEvent(eventId: number): Promise<void> {
  await icuFetch(athletePath(`/events/${encodeURIComponent(String(eventId))}`), { method: "DELETE" });
}

// Best-effort bulk delete: deletes sequentially (don't hammer the API, mirroring the write loop) and
// returns which ids succeeded vs. failed, so a caller can surface the rare leftover instead of throwing.
export async function deleteEvents(eventIds: number[]): Promise<{ deleted: number[]; failed: number[] }> {
  const deleted: number[] = [];
  const failed: number[] = [];
  for (const id of eventIds) {
    try {
      await deleteEvent(id);
      deleted.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}

export async function createEvent(event: IntervalsEventPayload): Promise<number | null> {
  // Upsert on the stable `uid` when the payload carries one. Block writes stamp a deterministic
  // `nodevelo-<date>` uid (see planDayToEvent), so a retried/partially-failed block write UPDATES the
  // events it already created instead of duplicating them — the write becomes idempotent and safely
  // retryable. Ad-hoc events without a uid (coach notes, manual note write-back) keep create semantics.
  const upsert = typeof event.uid === "string" && event.uid.length > 0;
  const data = await icuFetch(athletePath(`/events?upsertOnUid=${upsert}`), {
    method: "POST",
    body: JSON.stringify(event),
  });
  return num(asRecord(data).id);
}
