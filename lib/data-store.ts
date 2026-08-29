// Local JSON persistence under /data. This app is local-first by design:
// the filesystem is the single source of truth (see README — not Vercel-safe).
// Crash-safe atomic writes + backup/recovery live in ./json-store.
import type { AthleteProfile, AthleteQuirkStore, BlockHistoryEntry, BlockSettings, CalibrationStore, CurrentBlock, CurrentBlockDay, DispositionLog, GenerationVerdict, IntentOverlay, IntentOverlayStore, InterventionLog, LedgerRebuildMarker, LoadingLogStore, MorningCheckLog, RollingBaselines, ScoreLog, SeasonPlan, SyncData, TodayAnalysis, WeeklyEnvelope, WorkoutLibraryStore } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";
import { emptyCalibration } from "./calibration";
import { parseGoalsWeakpointsForMigration, readMdPerformance } from "./kb-loader";
import { DEFAULT_NEAT_MULTIPLIER } from "./nutrition";
import { readPhysiology } from "./physiology";
import { readJsonFile as readJson, readJsonFileWithStatus, updateJsonFile as updateJson, writeJsonFile as writeJson } from "./json-store";

export const DEFAULT_PROFILE: AthleteProfile = {
  performance: {
    ftp: 200,
    maxHr: 190,
    thresholdHr: 170,
    weightKg: 75,
    weeklyHoursMin: 6,
    weeklyHoursMax: 10,
    dateOfBirth: null,
    heightCm: null,
    sex: null,
  },
  goals: [],
  weakpoints: [],
  nutrition: {
    baseCalories: 2000,
    restDayTarget: 2600,
    buffer: 300,
    targetWeightKg: 75,
    targetRateKgPerWeek: null,
    neat: {
      multiplier: DEFAULT_NEAT_MULTIPLIER,
      confidence: "low",
      source: "default",
      windowDays: null,
      loggedDays: null,
      weighIns: null,
      solvedAt: null,
      imbalance: null,
      stale: false,
      // Matches nonDerivedNeatCalibration: the population prior belongs to the net formulation
      // (`k × RMR + exercise-above-rest` is the standard TDEE decomposition), so a profile that has
      // never calibrated still nets its burn. Only a DERIVED record carries the historical gross-basis
      // accident — and shapeMergeProfile's `nutrition` merge is shallow, so an on-disk `neat` replaces
      // this wholesale rather than inheriting this `basis`. That is what keeps the migration honest.
      basis: "net",
    },
    dayTypeNeat: null,
  },
  goalsMigratedAt: null,
  updatedAt: new Date(0).toISOString(),
};

// HR-43: an old-format athlete.json — reachable via restoring a backup predating a later field
// (app/api/import/route.ts), or any hand-edited/partial file — parses back missing fields this type
// declares required. Every downstream field access (applyGoalsMigration's `profile.goals.length`, the
// FTP overlay's `profile.performance.ftp = ...`) then crashes outright, and since the crash happens
// before the self-healing migration write below ever runs, every profile-dependent route 500s
// persistently with no way to recover short of hand-editing the file. Shape-merge the parsed value over
// DEFAULT_PROFILE BEFORE any field is read — missing fields fill in with defaults instead of `undefined`.
// Deliberately does not reuse DEFAULT_PROFILE's own array/object references for the array fields (a
// shared mutable reference across every fallback read would be the same class of footgun HR-49 already
// flags for `DEFAULT_PROFILE.performance`).
export function shapeMergeProfile(parsed: unknown): AthleteProfile {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<AthleteProfile>;
  return {
    ...DEFAULT_PROFILE,
    ...p,
    performance: { ...DEFAULT_PROFILE.performance, ...p.performance },
    nutrition: { ...DEFAULT_PROFILE.nutrition, ...p.nutrition },
    // HR-49: cloned, not reused as-is — when `parsed` IS the DEFAULT_PROFILE fallback itself (the
    // no-file-yet case), `p.goals`/`p.weakpoints` are literally `DEFAULT_PROFILE.goals`/`.weakpoints`;
    // returning that reference directly would still leave the shared module-level arrays reachable
    // through every fallback read's result, one `.push()` away from the exact cross-request pollution
    // this function exists to prevent for `performance`/`nutrition`.
    goals: Array.isArray(p.goals) ? [...p.goals] : [],
    weakpoints: Array.isArray(p.weakpoints) ? [...p.weakpoints] : [],
  };
}

// Pure migration decision, separated from readAthleteProfile's file IO so the flag-gating logic (the
// trickiest part — never re-import after the flag is set, never overwrite already-non-empty data) is
// testable without mocking the filesystem. `parseMd` is injected so the test can supply a fake.
export async function applyGoalsMigration(
  profile: AthleteProfile,
  parseMd: () => Promise<{ goals: AthleteProfile["goals"]; weakpoints: AthleteProfile["weakpoints"] }>
): Promise<AthleteProfile> {
  // Loose check (not `!== null`): a real on-disk athlete.json written before this field existed
  // parses back with the key entirely absent (`undefined`), which a strict null-check would wrongly
  // treat as "already migrated" and skip forever.
  if (profile.goalsMigratedAt) return profile;
  const now = new Date().toISOString();
  if (profile.goals.length > 0 || profile.weakpoints.length > 0) {
    return { ...profile, goalsMigratedAt: now };
  }
  const { goals, weakpoints } = await parseMd();
  return { ...profile, goals, weakpoints, goalsMigratedAt: now };
}

export async function readAthleteProfile(): Promise<AthleteProfile> {
  const { value: fromDisk, corruptFallback } = await readJsonFileWithStatus<unknown>("athlete.json", DEFAULT_PROFILE);
  let profile = shapeMergeProfile(fromDisk);
  if (!profile.goalsMigratedAt) {
    if (corruptFallback) {
      // HR-42: never self-heal-write a migration derived from a genuinely corrupt double-read (both
      // athlete.json and its .bak unreadable) — that would permanently overwrite whatever was
      // recoverable with factory defaults the instant this route runs. Still return the in-memory
      // migrated profile so this response isn't broken; just don't persist it until the underlying
      // corruption is actually fixed (a legitimate future read then self-heals normally).
      profile = await applyGoalsMigration(profile, parseGoalsWeakpointsForMigration);
    } else {
      // The read above takes NO lock (readJsonFileWithStatus is deliberately lock-free), and the old
      // self-heal then called writeAthleteProfile, which locks only the byte-write. Anything a
      // concurrent LOCKED writer persisted in that gap was silently discarded — and because this
      // rewrites the whole document, it discarded the WHOLE profile, not one field. Measured before
      // this fix: a freshly derived NEAT calibration lost, and an athlete's manual override lost
      // after the UI had already shown "Saved".
      //
      // Route it through updateAthleteProfile so the read, the migration and the write share one
      // lock — the same HR-40/51/52 precedent the rest of this file follows. applyGoalsMigration
      // re-checks goalsMigratedAt against the freshly-locked value, so a writer that already
      // migrated while we waited is a no-op rather than a second migration.
      profile = await updateAthleteProfile((current) =>
        applyGoalsMigration(current, parseGoalsWeakpointsForMigration)
      );
    }
  }
  // Overlay FTP/HR so IF/execution scoring, trends and generation all agree on the same
  // numbers. Precedence: athlete.json defaults < athlete_profile.md (fallback) < the
  // physiology store (the source of truth, synced from Intervals.icu).
  const md = await readMdPerformance();
  if (md.ftp !== undefined && md.ftp > 0) profile.performance.ftp = md.ftp;
  if (md.thresholdHr !== undefined && md.thresholdHr > 0) profile.performance.thresholdHr = md.thresholdHr;
  if (md.maxHr !== undefined && md.maxHr > 0) profile.performance.maxHr = md.maxHr;
  const phys = await readPhysiology();
  if (phys?.current) {
    const c = phys.current;
    if (c.ftp > 0) profile.performance.ftp = c.ftp;
    if (c.lthr !== null && c.lthr > 0) profile.performance.thresholdHr = c.lthr;
    if (c.maxHr !== null && c.maxHr > 0) profile.performance.maxHr = c.maxHr;
  }
  return profile;
}

export async function writeAthleteProfile(profile: AthleteProfile): Promise<void> {
  await writeJson("athlete.json", profile);
}

// HR-50: transactional read-modify-write on athlete.json's RAW (un-overlaid) shape — unlike
// readAthleteProfile, which layers live md/physiology FTP/HR data on top for display/scoring. A
// caller persisting a profile edit (nutrition, goals, weakpoints) must mutate the raw stored value,
// never the overlaid one — baking transient physiology-sync data back into athlete.json as if it were
// saved user input. The read happens inside the per-file lock (mirrors updateScoreLog/updateCalibration),
// so a concurrent PUT or the goals-migration self-heal write can't clobber each other. Shape-merges
// over DEFAULT_PROFILE first (HR-43) so an old-format file can't crash `mutate`; stamps `updatedAt`
// centrally so callers can't forget it.
// The mutator may be async: updateJsonFile awaits it INSIDE the lock, so a mutation needing its own
// IO (e.g. readAthleteProfile's goals migration, which parses athlete_profile.md) can still be
// atomic with respect to the read-modify-write rather than having to compute outside the lock.
export async function updateAthleteProfile(
  mutate: (profile: AthleteProfile) => AthleteProfile | Promise<AthleteProfile>
): Promise<AthleteProfile> {
  return updateJson<AthleteProfile>("athlete.json", DEFAULT_PROFILE, async (current) => ({
    ...(await mutate(shapeMergeProfile(current))),
    updatedAt: new Date().toISOString(),
  }));
}

export async function readLastSync(): Promise<SyncData | null> {
  return readJson<SyncData | null>("last-sync.json", null);
}

export async function writeLastSync(sync: SyncData): Promise<void> {
  await writeJson("last-sync.json", sync);
}

// Publication gate (Phase: publication-gate trust contract). The verdict of the MOST RECENT
// generation, persisted as a single slot so /api/write can verify the plan it's about to publish
// was actually gated (hash match) and refuse on blockers. Ephemeral by design — a fresh generation
// overwrites it (latest-wins), and a lost/corrupt record fails SAFE: readGenerationVerdict returns
// null and /api/write refuses the write as "no verdict" until the athlete regenerates.
//
// NOT in json-store.ts's CRITICAL set, deliberately: CRITICAL means "cannot be re-derived from a
// fresh sync" (ledgers, human decisions like intent-overlays/workout-library). A verdict is fully
// re-derivable — re-running the gate on the same days/blockParams reproduces it byte-for-byte from
// canonical hashing — and is only ever valid for one generation cycle anyway. Same treatment as the
// other single-slot ephemeral stores (last-sync.json, today-analysis.json): atomic writes via the
// per-file lock, no .bak rotation, corrupt file reads back as null.
export async function readGenerationVerdict(): Promise<GenerationVerdict | null> {
  return readJson<GenerationVerdict | null>("generation-gate.json", null);
}

// Single-slot latest-wins save. writeJson takes the per-file lock for the whole atomic write, so
// two concurrent saves serialize and the file is always exactly ONE complete record (the last to
// acquire the lock) — never interleaved bytes. That's the correct semantics here: each save is a
// whole-record replacement, not a merge, so there's no lost-update hazard a read-modify-write
// (updateJson) would be needed for; plain last-writer-wins IS latest-wins. Persisted verbatim —
// the caller owns the record's content, including `createdAt`, matching writeLastSync/writeTodayAnalysis.
export async function saveGenerationVerdict(record: GenerationVerdict): Promise<void> {
  await writeJson("generation-gate.json", record);
}

export async function readCurrentBlock(): Promise<CurrentBlock | null> {
  return readJson<CurrentBlock | null>("current-block.json", null);
}

export async function writeCurrentBlock(block: CurrentBlock | null): Promise<void> {
  await writeJson("current-block.json", block);
}

// Transactional read-modify-write on the current block (HR-4) — the read happens inside the per-file
// lock, so a mutate that only touches specific days (a reschedule move, a sync reconcile) can't lose a
// concurrent writer's change to some other day the way a stale-read-then-plain-write can.
//
// HR-35: `expectedCreatedAt` re-runs the UXA-24 version check INSIDE the lock, immediately before
// `mutate` runs — not just once by the route handler before its own (possibly slow: a network
// round-trip, a sequential write loop) work started. Every block-mutating route already reads the
// block and checks `expectedBlockCreatedAt` up front, but that's check-THEN-act: a second mutation
// landing in the window between the check and this write previously still applied against a now-stale
// premise. Passing the same expected value through here turns it into a real compare-and-swap —
// `undefined` (the caller sent no version) skips the check entirely, matching blockChangedResponse's
// own "no version supplied" semantics; a mismatch no-ops (returns `cur` unchanged) instead of silently
// overwriting the newer, already-applied write.
export async function updateCurrentBlock(
  mutate: (cur: CurrentBlock | null) => CurrentBlock | null,
  expectedCreatedAt?: string | null
): Promise<CurrentBlock | null> {
  return updateJson<CurrentBlock | null>("current-block.json", null, (cur) => {
    if (expectedCreatedAt !== undefined && (cur?.createdAt ?? null) !== expectedCreatedAt) return cur;
    return mutate(cur);
  });
}

// Phase 3a §8. Read-compute-write as ONE atomic operation. weekly-envelope.json is CRITICAL-backed
// because it preserves the athlete's current week envelope across partial updates; resolveWeeklyEnvelope's
// own read of `current` happens INSIDE updateJson's lock, so two concurrent syncs can never both read the
// same base and clobber each other's midweek reduction (external review, 2026-08-12).
export async function updateWeeklyEnvelope(
  mutate: (current: WeeklyEnvelope | null) => WeeklyEnvelope
): Promise<WeeklyEnvelope> {
  return updateJson<WeeklyEnvelope | null>("weekly-envelope.json", null, mutate) as Promise<WeeklyEnvelope>;
}

// Merges only `touchedDays` (by date) onto the fresh on-disk block. Any other writer's change to a
// date NOT in `touchedDays` survives — used by every partial-block writer (persistMirroredMove,
// the sync inbound-reconcile) instead of each hand-rolling stale-read-then-blind-overwrite.
// HR-31: previously took a `fallback: CurrentBlock` second-guess for when the on-disk read came back
// null (the caller's own pre-write snapshot) and wrote THAT back — meaning if the block was
// concurrently cleared (the athlete deleted it while this writer's own network round-trip was in
// flight), the merge silently resurrected the deleted block. A cleared block is a real, terminal
// state — no-op instead. `fallback` served no other purpose, so it's gone from the signature too.
export async function mergeCurrentBlockDays(
  touchedDays: CurrentBlockDay[],
  expectedCreatedAt?: string | null
): Promise<CurrentBlock | null> {
  const touchedContent = new Map(touchedDays.map((d) => [d.date, d]));
  return updateCurrentBlock((cur) => {
    if (!cur) return null;
    return { ...cur, days: cur.days.map((d) => touchedContent.get(d.date) ?? d) };
  }, expectedCreatedAt);
}

type StoredBlockSettings = Partial<BlockSettings> & {
  weeklyHoursMin?: number;
  weeklyHoursMax?: number;
};

// Shape-normalize legacy settings in one place. Missing fields parse as `undefined`, so every fallback
// is nullish rather than an `=== null` migration check. The legacy loading range is read-compatible
// only: neither old field survives the returned shape or the next locked update.
function normalizeBlockSettings(stored: StoredBlockSettings): BlockSettings {
  const legacyTarget = stored.weeklyHoursMax ?? DEFAULT_BLOCK_SETTINGS.targetWeeklyHours;
  const { weeklyHoursMin: _legacyMin, weeklyHoursMax: _legacyMax, ...current } = stored;
  return {
    ...DEFAULT_BLOCK_SETTINGS,
    ...current,
    targetWeeklyHours: stored.targetWeeklyHours ?? legacyTarget,
    maxAvailableHours: stored.maxAvailableHours ?? legacyTarget,
    lapButtonSteps: stored.lapButtonSteps ?? false,
    autoSyncOnOpen: stored.autoSyncOnOpen ?? DEFAULT_BLOCK_SETTINGS.autoSyncOnOpen,
    polarisedApproach: stored.polarisedApproach ?? DEFAULT_BLOCK_SETTINGS.polarisedApproach,
  };
}

export async function readBlockSettings(): Promise<BlockSettings> {
  return normalizeBlockSettings(await readJson<StoredBlockSettings>("block-settings.json", DEFAULT_BLOCK_SETTINGS));
}

// HR-52: transactional read-modify-write on block-settings.json — the read happens inside the
// per-file lock, so two concurrent PUTs (e.g. two open tabs saving Settings) can't each compute their
// own `updated` from the same stale `current` and clobber one another's unrelated field changes.
// `mutate` may throw to signal a validation failure — nothing is written and the lock is released for
// the next caller, same as `updateJsonFile`'s own throw-on-error contract.
export async function updateBlockSettings(
  mutate: (current: BlockSettings) => BlockSettings | Promise<BlockSettings>
): Promise<BlockSettings> {
  return updateJson<BlockSettings>("block-settings.json", DEFAULT_BLOCK_SETTINGS, async (current) => ({
    ...(await mutate(normalizeBlockSettings(current))),
    updatedAt: new Date().toISOString(),
  }));
}

export async function readBlockHistory(): Promise<BlockHistoryEntry[]> {
  return readJson<BlockHistoryEntry[]>("block-history.json", []);
}

export async function appendBlockHistory(entry: BlockHistoryEntry): Promise<void> {
  // Routes through updateBlockHistory so this read-modify-write is one locked critical section — closes
  // the lost-update race a concurrent updateBlockHistory caller (e.g. the sync route's execution-
  // outcome backfill, ROADMAP season-architecture-redesign §8) could otherwise hit against this
  // function's previously-unlocked read.
  await updateBlockHistory((history) => {
    const existing = history.find((h) => h.id === entry.id);
    // HR-37 + Phase 1: field-preserving on id-collision — a DELETE/write-replace's bare archive (no
    // retrospective, no closeout) can race a slow retrospective's own archive for the SAME block id
    // (both key off `block.createdAt`). Whichever landed second used to win wholesale under plain
    // filter+prepend, silently dropping the retrospective narrative, structured reflections,
    // compliance, and seeds the instant a bare entry happened to land after the rich one. An entry
    // lacking BOTH `retrospective` and `closeout` may never displace one that has either — a
    // DEGRADED closeout (deterministic, Claude-free) carries closeout but no retrospective and is
    // exactly as irreplaceable. Keep the richer entry's content, still bumped to the front.
    const isRich = (e: BlockHistoryEntry | undefined): e is BlockHistoryEntry => Boolean(e && (e.retrospective || e.closeout));
    const winner = isRich(existing) && !isRich(entry) ? existing : entry;
    // Deduplicate by id to avoid duplicates on retry.
    const filtered = history.filter((h) => h.id !== entry.id);
    // SUB-1: raised from 20 — discarded/superseded blocks now archive too (not just completed ones), so
    // churn is higher than "one entry per real block"; 20 was evicting real history (compliance, retro,
    // reflections, and now per-day prescriptions) well within a season. 200 gives ample headroom at
    // negligible local-JSON cost.
    return [winner, ...filtered].slice(0, 200);
  });
}

// Transactional read-modify-write on block history (mirrors updateCurrentBlock/updateScoreLog) — the
// read happens inside the per-file lock, so this and appendBlockHistory (which now delegates here)
// can't race each other and lose an update.
export async function updateBlockHistory(
  mutate: (entries: BlockHistoryEntry[]) => BlockHistoryEntry[]
): Promise<BlockHistoryEntry[]> {
  return updateJson<BlockHistoryEntry[]>("block-history.json", [], mutate);
}

export async function readTodayAnalysis(): Promise<TodayAnalysis | null> {
  return readJson<TodayAnalysis | null>("today-analysis.json", null);
}

export async function writeTodayAnalysis(analysis: TodayAnalysis | null): Promise<void> {
  await writeJson("today-analysis.json", analysis);
}


const DEFAULT_BASELINES: RollingBaselines = {
  avgCtl90d: null,
  avgDecoupling90d: null,
  avgTss90d: null,
  avgWeeklyHours90d: null,
  ridesPerWeek90d: null,
  updatedAt: new Date(0).toISOString(),
};

export async function readRollingBaselines(): Promise<RollingBaselines> {
  return readJson<RollingBaselines>("rolling-baselines.json", DEFAULT_BASELINES);
}

export async function writeRollingBaselines(baselines: RollingBaselines): Promise<void> {
  await writeJson("rolling-baselines.json", baselines);
}

// Mixed derived + athlete-owned store: sync can regenerate derived values, but manualOverride cannot
// be reconstructed, so calibration.json is CRITICAL-backed.
export async function readCalibration(): Promise<CalibrationStore> {
  return readJson<CalibrationStore>("calibration.json", emptyCalibration());
}

// Transactional read-modify-write on the calibration store — guards the Model page's contest/correct
// override POST from racing a concurrent sync's re-derive (which preserves manualOverride).
export async function updateCalibration(
  mutate: (cur: CalibrationStore) => CalibrationStore
): Promise<CalibrationStore> {
  return updateJson<CalibrationStore>("calibration.json", emptyCalibration(), mutate);
}

const DEFAULT_QUIRKS: AthleteQuirkStore = { entries: [], extractedAt: new Date(0).toISOString(), engine: "" };

// Derived store (Track D): mined from ride notes, regenerated in full each sync — like rolling
// baselines, it carries no backup/ledger semantics.
export async function readQuirks(): Promise<AthleteQuirkStore> {
  return readJson<AthleteQuirkStore>("athlete-quirks.json", DEFAULT_QUIRKS);
}

export async function writeQuirks(store: AthleteQuirkStore): Promise<void> {
  await writeJson("athlete-quirks.json", store);
}

const DEFAULT_SCORE_LOG: ScoreLog = { entries: [], updatedAt: new Date(0).toISOString() };

export async function readScoreLog(): Promise<ScoreLog> {
  return readJson<ScoreLog>("score-log.json", DEFAULT_SCORE_LOG);
}

// Transactional read-modify-write on the ledger (CR-A). The read happens inside the per-file lock,
// so a sync, a disposition POST and the deferred analyze step can't read the same base and clobber
// one another's entries. `mutate` receives the current entries and returns the next set; updatedAt
// is stamped here so callers can't forget it.
export async function updateScoreLog(
  mutate: (entries: ScoreLog["entries"]) => ScoreLog["entries"] | Promise<ScoreLog["entries"]>
): Promise<ScoreLog> {
  return updateJson<ScoreLog>("score-log.json", DEFAULT_SCORE_LOG, async (log) => ({
    entries: await mutate(log.entries),
    updatedAt: new Date().toISOString(),
  }));
}

// One-shot marker for the SYNC-2 ledger rebuild (LEDGER-3). CRITICAL-backed because a destructive
// re-score cannot be inferred from current sync data; the marker itself is the only record that the
// rebuild already happened.
const DEFAULT_LEDGER_REBUILD: LedgerRebuildMarker = { rebuiltAt: null };

export async function readLedgerRebuild(): Promise<LedgerRebuildMarker> {
  return readJson<LedgerRebuildMarker>("ledger-rebuild.json", DEFAULT_LEDGER_REBUILD);
}

export async function writeLedgerRebuild(rebuiltAt: string): Promise<void> {
  await writeJson("ledger-rebuild.json", { rebuiltAt });
}

const DEFAULT_INTERVENTION_LOG: InterventionLog = { records: [], updatedAt: new Date(0).toISOString() };

export async function readInterventionLog(): Promise<InterventionLog> {
  return readJson<InterventionLog>("intervention-log.json", DEFAULT_INTERVENTION_LOG);
}

// Transactional read-modify-write on the intervention log (HR-36) — the read happens inside the
// per-file lock, so a block write's fresh-intervention merge (app/api/write/route.ts) and a sync's
// outcome-validation pass (app/api/sync/route.ts) can't read the same base and clobber each other's
// changes the way two unlocked read-modify-writes on this CRITICAL store previously could.
export async function updateInterventionLog(
  mutate: (log: InterventionLog) => InterventionLog
): Promise<InterventionLog> {
  return updateJson<InterventionLog>("intervention-log.json", DEFAULT_INTERVENTION_LOG, mutate);
}

const DEFAULT_DISPOSITIONS: DispositionLog = { entries: [], updatedAt: new Date(0).toISOString() };

export async function readDispositions(): Promise<DispositionLog> {
  return readJson<DispositionLog>("dispositions.json", DEFAULT_DISPOSITIONS);
}

// Transactional read-modify-write on the disposition log (CR-A) — guards two near-simultaneous
// disposition POSTs from clobbering each other.
export async function updateDispositions(
  mutate: (entries: DispositionLog["entries"]) => DispositionLog["entries"]
): Promise<DispositionLog> {
  return updateJson<DispositionLog>("dispositions.json", DEFAULT_DISPOSITIONS, (log) => ({
    entries: mutate(log.entries),
    updatedAt: new Date().toISOString(),
  }));
}

const DEFAULT_WORKOUT_LIBRARY: WorkoutLibraryStore = { entries: [] };

export function readWorkoutLibrary(): Promise<WorkoutLibraryStore> {
  return readJson<WorkoutLibraryStore>("workout-library.json", DEFAULT_WORKOUT_LIBRARY);
}

// workout-library.json is in json-store.ts's CRITICAL set — a double-corrupt read refuses to persist
// the empty fallback as truth (throws) rather than silently wiping a promoted library.
export function updateWorkoutLibrary(
  mutate: (store: WorkoutLibraryStore) => WorkoutLibraryStore | Promise<WorkoutLibraryStore>
): Promise<WorkoutLibraryStore> {
  return updateJson<WorkoutLibraryStore>("workout-library.json", DEFAULT_WORKOUT_LIBRARY, mutate);
}

const DEFAULT_MORNING_CHECKS: MorningCheckLog = { entries: [], updatedAt: new Date(0).toISOString() };

// Morning checks are CRITICAL-backed because they preserve the athlete's own per-day confirmation
// history; a fresh sync cannot reconstruct those answers.
export async function readMorningChecks(): Promise<MorningCheckLog> {
  return readJson<MorningCheckLog>("morning-check.json", DEFAULT_MORNING_CHECKS);
}

export async function writeMorningChecks(log: MorningCheckLog): Promise<void> {
  await writeJson("morning-check.json", log);
}

const DEFAULT_LOADING_LOG: LoadingLogStore = { entries: [] };

// Loading logs are CRITICAL-backed because they capture athlete-owned loading history and notes that
// are not derivable from the synced ride data.
export async function readLoadingLog(): Promise<LoadingLogStore> {
  return readJson<LoadingLogStore>("loading-log.json", DEFAULT_LOADING_LOG);
}

export async function writeLoadingLog(store: LoadingLogStore): Promise<void> {
  await writeJson("loading-log.json", store);
}

// Phase 2a: the permanent intent-overlay store. Append-oriented and CRITICAL-backed — an approved
// overlay is a human decision, not a re-derivable computation. Transactional update so a sync, the
// deferred analyze step and a future review action can't clobber one another (why updateScoreLog exists).
const DEFAULT_INTENT_OVERLAYS: IntentOverlayStore = { overlays: [], updatedAt: new Date(0).toISOString() };

export async function readIntentOverlays(): Promise<IntentOverlayStore> {
  return readJson<IntentOverlayStore>("intent-overlays.json", DEFAULT_INTENT_OVERLAYS);
}

export async function updateIntentOverlayStore(
  mutate: (store: IntentOverlayStore) => IntentOverlayStore | Promise<IntentOverlayStore>
): Promise<IntentOverlayStore> {
  return updateJson<IntentOverlayStore>("intent-overlays.json", DEFAULT_INTENT_OVERLAYS, async (store) => ({
    ...await mutate(store),
    updatedAt: new Date().toISOString(),
  }));
}

export async function updateIntentOverlays(
  mutate: (overlays: IntentOverlay[]) => IntentOverlay[] | Promise<IntentOverlay[]>
): Promise<IntentOverlayStore> {
  return updateIntentOverlayStore(async (store) => ({
    ...store,
    overlays: await mutate(store.overlays),
  }));
}

const DEFAULT_SEASON_PLAN: SeasonPlan = {
  objective: "",
  events: [],
  periods: [],
  updatedAt: new Date(0).toISOString(),
};

// Season plans are CRITICAL-backed because they hold the athlete's chosen season structure; sync
// cannot recreate that intent if it is lost.
export async function readSeasonPlan(): Promise<SeasonPlan> {
  return readJson<SeasonPlan>("season-plan.json", DEFAULT_SEASON_PLAN);
}

export async function writeSeasonPlan(plan: SeasonPlan): Promise<void> {
  await writeJson("season-plan.json", { ...plan, updatedAt: new Date().toISOString() });
}

// HR-58: transactional read-modify-write on season-plan.json, with an optional CAS guard. The read
// happens inside the per-file lock, so /api/generate's post-success persist and /api/season's PUT
// (the "Season form" save) can't each compute their own `next` from the same stale `current` and
// silently clobber one another. `expectedUpdatedAt`, when passed, additionally rejects the mutate
// (returns `current` unchanged) if the live `updatedAt` no longer matches what the caller's own
// upstream read saw — the caller's `mutate` was itself derived from that earlier snapshot, so a
// mismatch means someone else wrote in between and this mutation is now based on stale state.
export async function updateSeasonPlan(
  mutate: (current: SeasonPlan) => SeasonPlan,
  expectedUpdatedAt?: string
): Promise<SeasonPlan> {
  return updateJson<SeasonPlan>("season-plan.json", DEFAULT_SEASON_PLAN, (current) => {
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) return current;
    return { ...mutate(current), updatedAt: new Date().toISOString() };
  });
}
