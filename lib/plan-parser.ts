// Parses the AI's strictly-formatted plan text into structured PlannedDay
// objects and converts them to Intervals.icu event payloads.
import type { IntervalsEventPayload, PlannedDay, WorkoutType } from "./types";

const TYPE_ALIASES: Record<string, WorkoutType> = {
  z2: "Z2",
  endurance: "Z2",
  threshold: "Threshold",
  "sweet spot": "Threshold",
  sweetspot: "Threshold",
  vo2max: "VO2max",
  "vo2 max": "VO2max",
  vo2: "VO2max",
  sit: "SIT",
  sprint: "SIT",
  recovery: "Recovery",
  strength: "Strength",
  rest: "Rest",
};

const WEEK_RE = /^\s*WEEK\s+(\d+)\s*[:\-–]\s*(.*)$/i;
const DAY_RE = /^\s*DAY\s+(\d{4}-\d{2}-\d{2})[^:]*:\s*(.*)$/i;
const FIELD_RE = /^\s*(TYPE|DURATION|WORKOUT|DESCRIPTION)\s*:\s*(.*)$/i;
const OVERVIEW_RE = /^\s*BLOCK OVERVIEW\s*:?\s*$/i;
// A valid workout step needs a duration token: 10m, 30s, 1h, 1h30m, 5', 30"
const STEP_DURATION_RE = /\d+\s*(h|m|s|'|")/i;

interface ParseResult {
  overview: string;
  days: PlannedDay[];
  warnings: string[];
}

interface DraftDay {
  date: string;
  name: string;
  weekNumber: number;
  weekTheme: string;
  type: string;
  duration: string;
  workoutLines: string[];
  descriptionLines: string[];
}

function normaliseType(rawType: string, dayLabel: string, warnings: string[]): WorkoutType {
  const key = rawType.trim().toLowerCase().replace(/\s+/g, " ");
  const direct = TYPE_ALIASES[key];
  if (direct) return direct;
  const partial = Object.keys(TYPE_ALIASES).find((alias) => key.includes(alias));
  if (partial) {
    warnings.push(`${dayLabel}: unknown TYPE "${rawType}" mapped to ${TYPE_ALIASES[partial]}.`);
    return TYPE_ALIASES[partial];
  }
  warnings.push(`${dayLabel}: unknown TYPE "${rawType}" — defaulted to Z2. Review before writing.`);
  return "Z2";
}

function parseDuration(raw: string, dayLabel: string, warnings: string[]): number {
  const hours = raw.match(/(\d+)\s*h/i);
  const mins = raw.match(/(\d+)\s*m/i);
  if (hours || mins) {
    return (hours ? parseInt(hours[1], 10) * 60 : 0) + (mins ? parseInt(mins[1], 10) : 0);
  }
  const plain = raw.match(/(\d+)/);
  if (plain) return parseInt(plain[1], 10);
  warnings.push(`${dayLabel}: could not parse DURATION "${raw}" — set to 0.`);
  return 0;
}

function finaliseDay(draft: DraftDay, warnings: string[]): PlannedDay {
  const dayLabel = `DAY ${draft.date}`;
  const type = normaliseType(draft.type, dayLabel, warnings);
  const durationMin =
    type === "Rest" && draft.duration.trim() === ""
      ? 0
      : parseDuration(draft.duration, dayLabel, warnings);

  let workoutText = draft.workoutLines.join("\n").trim();
  // Rest days carry no structured workout; tolerate "Rest" / "none" fillers.
  if (type === "Rest" || /^(rest|none|n\/a|-)$/i.test(workoutText)) {
    if (type !== "Rest" && workoutText !== "") {
      warnings.push(`${dayLabel}: ${type} day has no structured workout.`);
    }
    workoutText = type === "Rest" ? "" : workoutText;
  }

  if (type !== "Rest" && type !== "Strength") {
    const stepLines = workoutText.split("\n").filter((l) => l.trim().startsWith("- "));
    if (stepLines.length === 0) {
      warnings.push(`${dayLabel}: no workout step lines found ("- 10m 65%" style).`);
    } else {
      for (const step of stepLines) {
        if (!STEP_DURATION_RE.test(step)) {
          warnings.push(`${dayLabel}: workout step "${step.trim()}" has no duration token.`);
        }
      }
    }
  }

  const description = draft.descriptionLines.join("\n").trim();
  if (description === "") warnings.push(`${dayLabel}: empty DESCRIPTION.`);

  return {
    date: draft.date,
    weekNumber: draft.weekNumber,
    weekTheme: draft.weekTheme,
    name: draft.name.trim() || `${type} session`,
    type,
    durationMin,
    workoutText,
    description,
  };
}

export function parsePlan(raw: string, expectedDates?: string[]): ParseResult {
  const warnings: string[] = [];
  const days: PlannedDay[] = [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  let overviewLines: string[] = [];
  let inOverview = false;
  let currentWeek = 0;
  let currentTheme = "";
  let draft: DraftDay | null = null;
  let activeField: "WORKOUT" | "DESCRIPTION" | null = null;

  const flush = () => {
    if (draft) days.push(finaliseDay(draft, warnings));
    draft = null;
    activeField = null;
  };

  for (const line of lines) {
    const weekMatch = line.match(WEEK_RE);
    if (weekMatch) {
      flush();
      inOverview = false;
      currentWeek = parseInt(weekMatch[1], 10);
      currentTheme = weekMatch[2].trim();
      continue;
    }

    const dayMatch = line.match(DAY_RE);
    if (dayMatch) {
      flush();
      inOverview = false;
      draft = {
        date: dayMatch[1],
        name: dayMatch[2],
        weekNumber: currentWeek || 1,
        weekTheme: currentTheme,
        type: "",
        duration: "",
        workoutLines: [],
        descriptionLines: [],
      };
      continue;
    }

    if (OVERVIEW_RE.test(line)) {
      inOverview = true;
      continue;
    }

    if (draft) {
      const fieldMatch = line.match(FIELD_RE);
      if (fieldMatch) {
        const field = fieldMatch[1].toUpperCase();
        const value = fieldMatch[2];
        if (field === "TYPE") {
          draft.type = value;
          activeField = null;
        } else if (field === "DURATION") {
          draft.duration = value;
          activeField = null;
        } else if (field === "WORKOUT") {
          if (value.trim()) draft.workoutLines.push(value);
          activeField = "WORKOUT";
        } else {
          if (value.trim()) draft.descriptionLines.push(value);
          activeField = "DESCRIPTION";
        }
        continue;
      }
      if (activeField === "WORKOUT") {
        // Steps may be indented; strip uniform leading whitespace.
        draft.workoutLines.push(line.replace(/^\s{0,4}/, ""));
        continue;
      }
      if (activeField === "DESCRIPTION") {
        draft.descriptionLines.push(line.trim());
        continue;
      }
      continue;
    }

    if (inOverview && line.trim()) overviewLines.push(line.trim());
  }
  flush();

  if (days.length === 0) {
    warnings.push("No DAY entries could be parsed from the AI output.");
  }

  if (expectedDates && expectedDates.length > 0) {
    const got = new Set(days.map((d) => d.date));
    const missing = expectedDates.filter((d) => !got.has(d));
    const extra = days.filter((d) => !expectedDates.includes(d.date)).map((d) => d.date);
    if (missing.length > 0) warnings.push(`Missing days: ${missing.join(", ")}.`);
    if (extra.length > 0) warnings.push(`Unexpected days outside the block: ${extra.join(", ")}.`);
  }

  const duplicates = days
    .map((d) => d.date)
    .filter((date, i, all) => all.indexOf(date) !== i);
  if (duplicates.length > 0) {
    warnings.push(`Duplicate DAY entries for: ${[...new Set(duplicates)].join(", ")}.`);
  }

  return { overview: overviewLines.join(" ").trim(), days, warnings };
}

// ---------- Intervals.icu event conversion ----------

// For WORKOUT events Intervals.icu parses "- 10m 65%" step lines out of the
// description; plain-text lines (our nutrition block) remain as notes.
export function planDayToEvent(day: PlannedDay): IntervalsEventPayload {
  const startDateLocal = `${day.date}T00:00:00`;
  if (day.type === "Rest") {
    return {
      category: "NOTE",
      start_date_local: startDateLocal,
      name: day.name || "Rest day",
      description: day.description,
    };
  }
  const isStrength = day.type === "Strength";
  const description = [day.workoutText.trim(), day.description.trim()]
    .filter(Boolean)
    .join("\n\n");
  return {
    category: "WORKOUT",
    start_date_local: startDateLocal,
    name: day.name,
    type: isStrength ? "WeightTraining" : "Ride",
    description,
    // Rides get their time from parsed steps; strength has no steps.
    ...(isStrength && day.durationMin > 0 ? { moving_time: day.durationMin * 60 } : {}),
  };
}
