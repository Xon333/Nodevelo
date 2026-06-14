// Local JSON persistence under /data. This app is local-first by design:
// the filesystem is the single source of truth (see README — not Vercel-safe).
import { promises as fs } from "fs";
import path from "path";
import type { AthleteProfile, BlockHistoryEntry, BlockSettings, ComplianceMemory, CurrentBlock, RollingBaselines, ScoreLog, SyncData, TodayAnalysis } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

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

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, file),
    JSON.stringify(value, null, 2) + "\n",
    "utf-8"
  );
}

export async function readAthleteProfile(): Promise<AthleteProfile> {
  return readJson<AthleteProfile>("athlete.json", DEFAULT_PROFILE);
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

const DEFAULT_COMPLIANCE: ComplianceMemory = { byType: {}, updatedAt: new Date(0).toISOString() };

export async function readComplianceMemory(): Promise<ComplianceMemory> {
  return readJson<ComplianceMemory>("compliance-memory.json", DEFAULT_COMPLIANCE);
}

export async function writeComplianceMemory(memory: ComplianceMemory): Promise<void> {
  await writeJson("compliance-memory.json", memory);
}

const DEFAULT_BASELINES: RollingBaselines = {
  avgCtl90d: null,
  avgDecoupling90d: null,
  avgCadence90d: null,
  avgTss90d: null,
  updatedAt: new Date(0).toISOString(),
};

export async function readRollingBaselines(): Promise<RollingBaselines> {
  return readJson<RollingBaselines>("rolling-baselines.json", DEFAULT_BASELINES);
}

export async function writeRollingBaselines(baselines: RollingBaselines): Promise<void> {
  await writeJson("rolling-baselines.json", baselines);
}

const DEFAULT_SCORE_LOG: ScoreLog = { entries: [], updatedAt: new Date(0).toISOString() };

export async function readScoreLog(): Promise<ScoreLog> {
  return readJson<ScoreLog>("score-log.json", DEFAULT_SCORE_LOG);
}

export async function writeScoreLog(log: ScoreLog): Promise<void> {
  await writeJson("score-log.json", log);
}
