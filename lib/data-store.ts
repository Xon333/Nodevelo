// Local JSON persistence under /data. This app is local-first by design:
// the filesystem is the single source of truth (see README — not Vercel-safe).
// Crash-safe atomic writes + backup/recovery live in ./json-store.
import type { AthleteProfile, AthleteQuirkStore, BlockHistoryEntry, BlockSettings, CalibrationStore, CurrentBlock, DispositionLog, InterventionLog, LedgerRebuildMarker, MorningCheckLog, RollingBaselines, ScoreLog, SyncData, TodayAnalysis } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";
import { emptyCalibration } from "./calibration";
import { readMdPerformance } from "./kb-loader";
import { readPhysiology } from "./physiology";
import { readJsonFile as readJson, updateJsonFile as updateJson, writeJsonFile as writeJson } from "./json-store";

export const DEFAULT_PROFILE: AthleteProfile = {
  performance: {
    ftp: 200,
    maxHr: 190,
    thresholdHr: 170,
    weightKg: 75,
    weeklyHoursMin: 6,
    weeklyHoursMax: 10,
  },
  goals: [],
  weakpoints: [],
  nutrition: {
    baseCalories: 2000,
    restDayTarget: 2600,
    buffer: 300,
    targetWeightKg: 75,
  },
  updatedAt: new Date(0).toISOString(),
};


export async function readAthleteProfile(): Promise<AthleteProfile> {
  const profile = await readJson<AthleteProfile>("athlete.json", DEFAULT_PROFILE);
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

export async function readLastSync(): Promise<SyncData | null> {
  return readJson<SyncData | null>("last-sync.json", null);
}

export async function writeLastSync(sync: SyncData): Promise<void> {
  await writeJson("last-sync.json", sync);
}

export async function readCurrentBlock(): Promise<CurrentBlock | null> {
  return readJson<CurrentBlock | null>("current-block.json", null);
}

export async function writeCurrentBlock(block: CurrentBlock | null): Promise<void> {
  await writeJson("current-block.json", block);
}

export async function readBlockSettings(): Promise<BlockSettings> {
  return readJson<BlockSettings>("block-settings.json", DEFAULT_BLOCK_SETTINGS);
}

export async function writeBlockSettings(settings: BlockSettings): Promise<void> {
  await writeJson("block-settings.json", { ...settings, updatedAt: new Date().toISOString() });
}

export async function readBlockHistory(): Promise<BlockHistoryEntry[]> {
  return readJson<BlockHistoryEntry[]>("block-history.json", []);
}

export async function appendBlockHistory(entry: BlockHistoryEntry): Promise<void> {
  const history = await readBlockHistory();
  // Deduplicate by id to avoid duplicates on retry.
  const filtered = history.filter((h) => h.id !== entry.id);
  await writeJson("block-history.json", [entry, ...filtered].slice(0, 20));
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
  avgCadence90d: null,
  avgTss90d: null,
  avgWeeklyHours90d: null,
  updatedAt: new Date(0).toISOString(),
};

export async function readRollingBaselines(): Promise<RollingBaselines> {
  return readJson<RollingBaselines>("rolling-baselines.json", DEFAULT_BASELINES);
}

export async function writeRollingBaselines(baselines: RollingBaselines): Promise<void> {
  await writeJson("rolling-baselines.json", baselines);
}

// Per-athlete calibration (ROADMAP #2). Derived store — regenerated on sync, like rolling-baselines.
export async function readCalibration(): Promise<CalibrationStore> {
  return readJson<CalibrationStore>("calibration.json", emptyCalibration());
}

export async function writeCalibration(calibration: CalibrationStore): Promise<void> {
  await writeJson("calibration.json", calibration);
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

export async function writeScoreLog(log: ScoreLog): Promise<void> {
  await writeJson("score-log.json", log);
}

// Transactional read-modify-write on the ledger (CR-A). The read happens inside the per-file lock,
// so a sync, a disposition POST and the deferred analyze step can't read the same base and clobber
// one another's entries. `mutate` receives the current entries and returns the next set; updatedAt
// is stamped here so callers can't forget it.
export async function updateScoreLog(
  mutate: (entries: ScoreLog["entries"]) => ScoreLog["entries"]
): Promise<ScoreLog> {
  return updateJson<ScoreLog>("score-log.json", DEFAULT_SCORE_LOG, (log) => ({
    entries: mutate(log.entries),
    updatedAt: new Date().toISOString(),
  }));
}

// One-shot marker for the SYNC-2 ledger rebuild (LEDGER-3) — persisted so a destructive re-score can't
// silently repeat on every sync. Tiny dedicated file; default = never rebuilt.
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

export async function writeInterventionLog(log: InterventionLog): Promise<void> {
  await writeJson("intervention-log.json", log);
}

const DEFAULT_DISPOSITIONS: DispositionLog = { entries: [], updatedAt: new Date(0).toISOString() };

export async function readDispositions(): Promise<DispositionLog> {
  return readJson<DispositionLog>("dispositions.json", DEFAULT_DISPOSITIONS);
}

export async function writeDispositions(log: DispositionLog): Promise<void> {
  await writeJson("dispositions.json", log);
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

const DEFAULT_MORNING_CHECKS: MorningCheckLog = { entries: [], updatedAt: new Date(0).toISOString() };

export async function readMorningChecks(): Promise<MorningCheckLog> {
  return readJson<MorningCheckLog>("morning-check.json", DEFAULT_MORNING_CHECKS);
}

export async function writeMorningChecks(log: MorningCheckLog): Promise<void> {
  await writeJson("morning-check.json", log);
}
