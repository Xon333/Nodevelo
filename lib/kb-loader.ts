// Knowledge base loader. Files are read fresh on every call (never cached in
// memory) so edits made via the Knowledge Base Manager take effect on the
// very next generation.
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { withPersistenceAccess } from "./persistence-gate";
import type { Zone } from "./zones";

// ---------- athlete_profile.md parser ----------

export interface AthleteMdSnapshot {
  personalData: Record<string, string>;
  performanceData: Record<string, string>;
  powerProfile: Array<{ duration: string; watts: string; wkg: string }>;
  trainingZones: Array<{ zone: string; name: string; power: string; hr: string }>;
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

async function parseAthleteMdUnlocked(): Promise<AthleteMdSnapshot> {
  let content = "";
  try {
    content = await fs.readFile(path.join(kbDir(), "athlete_profile.md"), "utf-8");
  } catch {
    return { personalData: {}, performanceData: {}, powerProfile: [], trainingZones: [] };
  }

  const personalSection = extractSectionText(content, "PERSONAL DATA");
  const perfSection = extractSectionText(content, "PERFORMANCE DATA");
  const powerSection = extractSectionText(content, "POWER PROFILE");
  const zonesSection = extractSectionText(content, "TRAINING ZONES");

  const powerRows = parseRows(powerSection).filter((r) => r[0] !== "Duration");
  const zoneRows = parseRows(zonesSection).filter((r) => r[0] !== "Zone");

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
  };
}

export function parseAthleteMd(): Promise<AthleteMdSnapshot> {
  return withPersistenceAccess(parseAthleteMdUnlocked);
}

// One-time migration source (Goals/Weakpoints centralization): re-parses whatever GOALS/WEAKPOINTS content
// currently exists in athlete_profile.md, in the NEW structured shape. Migrated goals always get
// focus: "general" — the markdown table never had a Focus column, so there's no tag to recover; the athlete
// re-tags through the new form afterward if they want finer filtering. Never throws on a missing file.
async function parseGoalsWeakpointsForMigrationUnlocked(): Promise<{
  goals: Array<{ goal: string; target: string; focus: "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
}> {
  let content = "";
  try {
    content = await fs.readFile(path.join(kbDir(), "athlete_profile.md"), "utf-8");
  } catch {
    return { goals: [], weakpoints: [] };
  }
  const goalsSection = extractSectionText(content, "GOALS");
  const weakpointsSection = extractSectionText(content, "WEAKPOINTS");
  const goalRows = parseRows(goalsSection).filter((r) => r[0] !== "Goal");
  const wpRows = parseRows(weakpointsSection).filter((r) => r[0] !== "Weakpoint");
  return {
    goals: goalRows.map((r) => ({ goal: r[0] ?? "", target: r[1] ?? "", focus: "general" as const })),
    weakpoints: wpRows.map((r) => ({ weakpoint: r[0] ?? "", detail: r[1] ?? "" })),
  };
}

export function parseGoalsWeakpointsForMigration(): Promise<{
  goals: Array<{ goal: string; target: string; focus: "general" }>;
  weakpoints: Array<{ weakpoint: string; detail: string }>;
}> {
  return withPersistenceAccess(parseGoalsWeakpointsForMigrationUnlocked);
}

// Numeric performance values parsed from athlete_profile.md — the athlete-edited
// source of truth. Used to keep athlete.json's FTP/HR consistent with the markdown
// (e.g. so Intensity Factor uses the same FTP the athlete sees and generation uses).
// Returns only the fields that parse cleanly; missing/garbled values are omitted.
export function readMdPerformance(): Promise<{ ftp?: number; thresholdHr?: number; maxHr?: number }> {
  return withPersistenceAccess(async () => {
    const { performanceData } = await parseAthleteMdUnlocked();
    const firstInt = (val: string | undefined): number | undefined => {
      const m = val?.match(/\d+/);
      return m ? parseInt(m[0], 10) : undefined;
    };
    const findValue = (pred: (key: string) => boolean): string | undefined => {
      const key = Object.keys(performanceData).find((k) => pred(k.trim().toLowerCase()));
      return key ? performanceData[key] : undefined;
    };
    return {
      ftp: firstInt(findValue((k) => k === "ftp")),
      thresholdHr: firstInt(findValue((k) => k.includes("threshold") && k.includes("hr"))),
      maxHr: firstInt(findValue((k) => k.includes("max") && k.includes("hr"))),
    };
  });
}

// Parse one column ("power" or "hr") of athlete_profile.md's TRAINING ZONES table
// into ordered zones. Handles "< 170W", "170–216W" (en-dash or hyphen), "> 432W";
// skips rows with no range (e.g. a "Max" HR cell). Ordered low→high.
async function parseMdZonesUnlocked(field: "power" | "hr"): Promise<Zone[]> {
  const { trainingZones } = await parseAthleteMdUnlocked();
  const out: Zone[] = [];
  for (const z of trainingZones) {
    const s = z[field] ?? "";
    const ints = (s.match(/\d+/g) ?? []).map(Number);
    if (ints.length === 0) continue;
    let lo: number;
    let hi: number | null;
    if (/<|less/i.test(s)) {
      lo = 0;
      hi = ints[0];
    } else if (/>|\+/.test(s)) {
      lo = ints[0];
      hi = null;
    } else if (ints.length >= 2) {
      lo = ints[0];
      hi = ints[1];
    } else {
      lo = ints[0];
      hi = null;
    }
    out.push({ name: `${z.zone} ${z.name}`.trim(), lo, hi });
  }
  return out;
}

export function readMdHrZones(): Promise<Zone[]> {
  return withPersistenceAccess(() => parseMdZonesUnlocked("hr"));
}

export function readMdPowerZones(): Promise<Zone[]> {
  return withPersistenceAccess(() => parseMdZonesUnlocked("power"));
}

function kbDir(): string {
  return process.env.NODEVELO_KB_DIR || path.join(process.cwd(), "knowledge-base");
}

function retroDir(): string {
  return path.join(kbDir(), "block-retrospectives");
}

// Committed skeleton (schema + the section anchors the prompt cites). The real KB under
// knowledge-base/ is gitignored personal data and overrides this per-file; the defaults only fill
// gaps, so a fresh clone / CI doesn't hard-fail and the repo documents the expected structure.
const KB_DEFAULTS_DIR = path.join(process.cwd(), "knowledge-base-defaults");

async function atomicWriteMarkdown(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tmp, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// .md files in a dir, or [] if the dir is absent (a fresh clone has no knowledge-base/).
async function listMd(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

// Read a KB file, preferring the user's local copy and falling back to the committed default.
async function readKbWithFallback(name: string): Promise<string | null> {
  for (const dir of [kbDir(), KB_DEFAULTS_DIR]) {
    try {
      return await fs.readFile(path.join(dir, name), "utf-8");
    } catch {
      // try the next source
    }
  }
  return null;
}

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

async function listKnowledgeFilesUnlocked(): Promise<string[]> {
  // Union of the user's local files (any .md) and the committed defaults — so the editor + generation
  // see the full set even before a coach has dropped in their own KB, and never throw on a missing
  // dir. The defaults contribution is restricted to the canonical KB names so the defaults' README
  // (and any non-KB file) never lands in the prompt or the editor list.
  const local = await listMd(kbDir());
  const defaults = (await listMd(KB_DEFAULTS_DIR)).filter((f) => KB_ORDER.includes(f));
  const names = new Set([...local, ...defaults]);
  return [...names].sort((a, b) => {
    const ia = KB_ORDER.indexOf(a);
    const ib = KB_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function listKnowledgeFiles(): Promise<string[]> {
  return withPersistenceAccess(listKnowledgeFilesUnlocked);
}

async function readKnowledgeFileUnlocked(name: string): Promise<string> {
  assertSafeName(name);
  const content = await readKbWithFallback(name);
  if (content === null) throw new Error(`Knowledge base file not found: ${name}`);
  return content;
}

export function readKnowledgeFile(name: string): Promise<string> {
  return withPersistenceAccess(() => readKnowledgeFileUnlocked(name));
}

// Editing only — the manager deliberately supports no create/delete. Editing a file that currently
// exists only as a default writes a local override (the first local file may need the dir created).
export function writeKnowledgeFile(name: string, content: string): Promise<void> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    const existing = await listKnowledgeFilesUnlocked();
    if (!existing.includes(name)) {
      throw new Error(`Unknown knowledge base file: ${name}. Creating new files is not supported.`);
    }
    await atomicWriteMarkdown(path.join(kbDir(), name), content);
  });
}

// Legacy normalizer retained for stored athlete-profile compatibility. Goals/weakpoints now live in
// AthleteProfile JSON; deterministic generation does not consume the markdown copy.
export function stripGoalsWeakpointsSections(content: string): string {
  return content
    .replace(/\n+## +GOALS\b[\s\S]*?(?=\n## |$)/, "")
    .replace(/\n+## +WEAKPOINTS\b[\s\S]*?(?=\n## |$)/, "")
    .trim();
}

// Legacy display normalizer: drop Related-notes footers and flatten wikilinks to readable text.
export function stripObsidianSyntax(content: string): string {
  return content
    // Drop the Related-notes footer (and the `---` rule preceding it) through the
    // next top-level heading or end of file.
    .replace(/\n+(?:---\s*\n+)?## +Related notes\b[\s\S]*?(?=\n## |$)/g, "")
    // Flatten remaining inline wikilinks to plain text.
    .replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
      const [link, alias] = inner.split("|");
      if (alias) return alias.trim();
      const hashIdx = link.indexOf("#");
      return (hashIdx >= 0 ? link.slice(hashIdx + 1) : link).trim();
    })
    .trim();
}

// ---------- Block retrospectives ----------
// Stored under knowledge-base/block-retrospectives/ as athlete-visible history. Neither these files
// nor their legacy `next_block_seeds` field are inputs to deterministic block compilation.

// Newest-first (filenames start with the block start date, so a reverse
// lexicographic sort is chronological).
async function listRetrospectivesUnlocked(): Promise<string[]> {
  try {
    const entries = await fs.readdir(retroDir());
    return entries.filter((f) => f.endsWith(".md")).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export function listRetrospectives(): Promise<string[]> {
  return withPersistenceAccess(listRetrospectivesUnlocked);
}

async function readRetrospectiveUnlocked(name: string): Promise<string> {
  assertSafeName(name);
  return fs.readFile(path.join(retroDir(), name), "utf-8");
}

export function readRetrospective(name: string): Promise<string> {
  return withPersistenceAccess(() => readRetrospectiveUnlocked(name));
}

// Unlike core KB files, retrospectives can be created (one per completed block).
export function writeRetrospective(name: string, content: string): Promise<void> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    await atomicWriteMarkdown(path.join(retroDir(), name), content);
  });
}

// Moved verbatim from app/api/retrospective/route.ts (which now imports this) so filename
// derivation has exactly one owner.
export function slugifyGoal(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function retroFileId(startDate: string, goal: string): string {
  return `${startDate}_${slugifyGoal(goal)}`;
}

// The frontmatter region of a retro markdown file: ONLY the lines between a leading `---` and the
// next `---`. Files not starting with `---` (or with an unterminated delimiter) have none. Both the
// seed gate and the seeds list must be read from here — a prose line in the narrative body reading
// `seeds_approved: true` must never open the acknowledgement parser from body prose.
function retroFrontmatterBounds(content: string): { lines: string[]; close: number } | null {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close === -1) return null;
  return { lines, close };
}

function retroFrontmatterLines(content: string): string[] | null {
  const bounds = retroFrontmatterBounds(content);
  return bounds ? bounds.lines.slice(1, bounds.close) : null;
}

// Legacy history parser retained for stored retrospective compatibility and the acknowledgement
// workflow. The parsed values are not consumed by deterministic block compilation.
export function parseRetroSeeds(content: string): string[] {
  const fmLines = retroFrontmatterLines(content);
  if (!fmLines || !fmLines.some((l) => /^seeds_approved:\s*true\s*$/.test(l))) return [];
  const seeds: string[] = [];
  let inSeeds = false;
  for (const line of fmLines) {
    if (/^next_block_seeds:\s*$/.test(line)) { inSeeds = true; continue; }
    if (inSeeds) {
      const quoted = line.match(/^\s+-\s+"((?:\\.|[^"])*)"\s*$/);
      if (quoted) {
        const seed = quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        if (seed.trim()) seeds.push(seed);
        continue;
      }
      const plain = line.match(/^\s+-\s+(.*?)\s*$/);
      if (plain && plain[1].trim()) { seeds.push(plain[1].trim()); continue; }
      if (line.trim() !== "" && !/^\s+-/.test(line)) break;
    }
  }
  return seeds;
}

// Pure transform: flip an existing flag, or insert one right after the opening delimiter — strictly
// within the frontmatter region; body text is never modified.
export function approveSeedsInMarkdown(content: string): string {
  const bounds = retroFrontmatterBounds(content);
  if (!bounds) return content;
  const { lines, close } = bounds;
  for (let i = 1; i < close; i++) {
    if (/^seeds_approved:\s*true\s*$/.test(lines[i])) return content;
    if (/^seeds_approved:/.test(lines[i])) {
      lines[i] = "seeds_approved: true";
      return lines.join("\n");
    }
  }
  lines.splice(1, 0, "seeds_approved: true");
  return lines.join("\n");
}

export function markRetroSeedsApproved(name: string): Promise<boolean> {
  return withPersistenceAccess(async () => {
    assertSafeName(name);
    const file = path.join(retroDir(), name);
    const content = await fs.readFile(file, "utf-8");
    if (!retroFrontmatterBounds(content)) return false;
    const next = approveSeedsInMarkdown(content);
    if (next !== content) await atomicWriteMarkdown(file, next);
    return true;
  });
}
