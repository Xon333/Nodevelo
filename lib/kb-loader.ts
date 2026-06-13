// Knowledge base loader. Files are read fresh on every call (never cached in
// memory) so edits made via the Knowledge Base Manager take effect on the
// very next generation.
import { promises as fs } from "fs";
import path from "path";
import type { AthleteProfile } from "./types";

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
