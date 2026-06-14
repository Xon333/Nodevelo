// Knowledge base loader. Files are read fresh on every call (never cached in
// memory) so edits made via the Knowledge Base Manager take effect on the
// very next generation.
import { promises as fs } from "fs";
import path from "path";
import type { AthleteProfile } from "./types";

// ---------- athlete_profile.md parser ----------

export interface AthleteMdSnapshot {
  personalData: Record<string, string>;
  performanceData: Record<string, string>;
  powerProfile: Array<{ duration: string; watts: string; wkg: string }>;
  trainingZones: Array<{ zone: string; name: string; power: string; hr: string }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
  goals: Array<{ goal: string; target: string }>;
}

function extractSectionText(content: string, heading: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const result: string[] = [];
  const headingRe = new RegExp(`^##\\s+${heading}`, "i");
  for (const line of lines) {
    if (headingRe.test(line)) { inSection = true; continue; }
    if (inSection) {
      if (/^##\s/.test(line)) break;
      if (line.trim() === "---") break;
      result.push(line);
    }
  }
  return result.join("\n").trim();
}

function parseKvTable(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\s*\|[\s-|]+\|\s*$/.test(line)) continue; // separator row
    const cells = line.split("|").filter(Boolean).map((c) => c.trim());
    if (cells.length >= 2 && cells[0] !== "Parameter" && cells[0] !== "Zone" &&
        cells[0] !== "Duration" && cells[0] !== "Weakpoint" && cells[0] !== "Goal") {
      out[cells[0]] = cells[1];
    }
  }
  return out;
}

function parseRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\s*\|[\s-|]+\|\s*$/.test(l))
    .map((l) => l.split("|").filter(Boolean).map((c) => c.trim()))
    .filter((row) => row.length >= 2);
}

export async function parseAthleteMd(): Promise<AthleteMdSnapshot> {
  let content = "";
  try {
    content = await fs.readFile(path.join(KB_DIR, "athlete_profile.md"), "utf-8");
  } catch {
    return { personalData: {}, performanceData: {}, powerProfile: [], trainingZones: [], weakpoints: [], goals: [] };
  }

  const personalSection = extractSectionText(content, "PERSONAL DATA");
  const perfSection = extractSectionText(content, "PERFORMANCE DATA");
  const powerSection = extractSectionText(content, "POWER PROFILE");
  const zonesSection = extractSectionText(content, "TRAINING ZONES");
  const weakpointsSection = extractSectionText(content, "WEAKPOINTS");
  const goalsSection = extractSectionText(content, "GOALS");

  const powerRows = parseRows(powerSection).filter((r) => r[0] !== "Duration");
  const zoneRows = parseRows(zonesSection).filter((r) => r[0] !== "Zone");
  const wpRows = parseRows(weakpointsSection).filter((r) => r[0] !== "Weakpoint");
  const goalRows = parseRows(goalsSection).filter((r) => r[0] !== "Goal");

  return {
    personalData: parseKvTable(personalSection),
    performanceData: parseKvTable(perfSection),
    powerProfile: powerRows.map((r) => ({
      duration: r[0] ?? "",
      watts: r[1] ?? "",
      wkg: r[2] ?? "",
    })),
    trainingZones: zoneRows.map((r) => ({
      zone: r[0] ?? "",
      name: r[1] ?? "",
      power: r[2] ?? "",
      hr: r[3] ?? "",
    })),
    weakpoints: wpRows.map((r) => ({
      weakpoint: r[0] ?? "",
      detail: r[1] ?? "",
    })),
    goals: goalRows.map((r) => ({
      goal: r[0] ?? "",
      target: r[1] ?? "",
    })),
  };
}

const KB_DIR = path.join(process.cwd(), "knowledge-base");

// Concatenation order required by the spec; bikefit is optional.
const KB_ORDER = [
  "cycling_database.md",
  "training_knowledge.md",
  "nutrition_knowledge.md",
  "athlete_profile.md",
  "bikefit_knowledge.md",
];

function assertSafeName(name: string): void {
  if (name !== path.basename(name) || !name.endsWith(".md")) {
    throw new Error(`Invalid knowledge base file name: ${name}`);
  }
}

export async function listKnowledgeFiles(): Promise<string[]> {
  const entries = await fs.readdir(KB_DIR);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  return mdFiles.sort((a, b) => {
    const ia = KB_ORDER.indexOf(a);
    const ib = KB_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export async function readKnowledgeFile(name: string): Promise<string> {
  assertSafeName(name);
  return fs.readFile(path.join(KB_DIR, name), "utf-8");
}

// Editing only — the manager deliberately supports no create/delete.
export async function writeKnowledgeFile(name: string, content: string): Promise<void> {
  assertSafeName(name);
  const existing = await listKnowledgeFiles();
  if (!existing.includes(name)) {
    throw new Error(`Unknown knowledge base file: ${name}. Creating new files is not supported.`);
  }
  await fs.writeFile(path.join(KB_DIR, name), content, "utf-8");
}

// Full knowledge base as one string for prompt injection, each file prefixed
// with its filename as a section header.
export async function loadKnowledgeBaseContext(): Promise<string> {
  const files = await listKnowledgeFiles();
  const ordered = KB_ORDER.filter((f) => files.includes(f)).concat(
    files.filter((f) => !KB_ORDER.includes(f))
  );
  const sections: string[] = [];
  for (const file of ordered) {
    const content = await fs.readFile(path.join(KB_DIR, file), "utf-8");
    sections.push(`===== FILE: ${file} =====\n\n${content.trim()}`);
  }
  return sections.join("\n\n");
}

// ---------- Block retrospectives ----------
// Stored under knowledge-base/block-retrospectives/. They are NOT pulled into
// loadKnowledgeBaseContext() (listKnowledgeFiles only matches flat .md files),
// so they never bloat the generation prompt. Instead the *latest* file's
// next_block_seeds — editable by the athlete — are injected at generation time.

const RETRO_DIR = path.join(KB_DIR, "block-retrospectives");

async function ensureRetroDir(): Promise<void> {
  await fs.mkdir(RETRO_DIR, { recursive: true });
}

// Newest-first (filenames start with the block start date, so a reverse
// lexicographic sort is chronological).
export async function listRetrospectives(): Promise<string[]> {
  try {
    const entries = await fs.readdir(RETRO_DIR);
    return entries.filter((f) => f.endsWith(".md")).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export async function readRetrospective(name: string): Promise<string> {
  assertSafeName(name);
  return fs.readFile(path.join(RETRO_DIR, name), "utf-8");
}

// Unlike core KB files, retrospectives can be created (one per completed block).
export async function writeRetrospective(name: string, content: string): Promise<void> {
  assertSafeName(name);
  await ensureRetroDir();
  await fs.writeFile(path.join(RETRO_DIR, name), content, "utf-8");
}

// Parse the `next_block_seeds:` YAML list out of the newest retrospective's
// frontmatter. Athlete edits to this list flow straight into the next block.
export async function latestRetrospectiveSeeds(): Promise<string[]> {
  const all = await listRetrospectives();
  // Only date-prefixed retrospectives count for "latest" — ignore any stray
  // notes the athlete may have dropped in (their ISO date prefix sorts correctly).
  const dated = all.filter((f) => /^\d{4}-\d{2}-\d{2}_/.test(f));
  if (dated.length === 0) return [];
  let content = "";
  try {
    content = await fs.readFile(path.join(RETRO_DIR, dated[0]), "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const seeds: string[] = [];
  let inSeeds = false;
  for (const line of lines) {
    if (/^next_block_seeds:\s*$/.test(line)) { inSeeds = true; continue; }
    if (inSeeds) {
      const m = line.match(/^\s+-\s+"?(.*?)"?\s*$/);
      if (m && m[1].trim()) { seeds.push(m[1].trim()); continue; }
      // A non-list line ends the block (next key, closing ---, or blank-then-key).
      if (line.trim() !== "" && !/^\s+-/.test(line)) break;
    }
  }
  return seeds;
}

// athlete.json is the source of truth; this regenerates athlete_profile.md so
// the two stay in sync (non-negotiable #6).
export function athleteProfileToMarkdown(profile: AthleteProfile): string {
  const p = profile.performance;
  const n = profile.nutrition;
  const list = (items: string[]) =>
    items.length > 0 ? items.map((g) => `- ${g}`).join("\n") : "- (none recorded)";
  return `# Athlete Profile

> Generated from athlete.json on ${new Date().toISOString().slice(0, 10)}.
> Edit via the Profile page — manual edits to this file are overwritten on the next profile save.

## Performance

- FTP: ${p.ftp} W
- Max HR: ${p.maxHr} bpm
- Threshold HR: ${p.thresholdHr} bpm
- Weight: ${p.weightKg} kg (target: ${n.targetWeightKg} kg)
- Weekly training availability: ${p.weeklyHoursMin}–${p.weeklyHoursMax} hours

## Goals

${list(profile.goals)}

## Weakpoints to address

${list(profile.weakpoints)}

## Nutrition formula settings

- Base calories: ${n.baseCalories} kcal
- Rest day target: ${n.restDayTarget} kcal
- Training day buffer: ${n.buffer} kcal (auto-adjusts ±150 kcal on 7-day weight trend, capped 0–600)
- Daily targets are computed by the app's deterministic formula: base + activity kJ + buffer on training days, flat target on rest days. Use the pre-computed values supplied with each generation request — never recalculate them.
`;
}

export async function writeAthleteProfileMd(profile: AthleteProfile): Promise<void> {
  await fs.writeFile(
    path.join(KB_DIR, "athlete_profile.md"),
    athleteProfileToMarkdown(profile),
    "utf-8"
  );
}
