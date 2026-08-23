// The publication gate (publication-gate trust-contract plan, Task 1): ONE place that runs every
// post-generation validator exactly once and buckets their outputs by emitter into
//   blockers    — publication refused; no override exists for any of these;
//   preferences — lower-confidence coaching heuristics, publishable only via an explicit
//                 informed athlete override;
//   advisories  — informational only; the route folds these into `warnings`.
// Severity is a property of the validator's fact, decided here by WHO emitted it — never by
// parsing message strings. Validators remain the sole owners of their facts (INVARIANTS #33);
// this module only classifies. Pure: no IO, no mutation — same input → same verdict.
//
// Also owns `canonical`, the recursive key-sort + JSON.stringify helper behind the persisted
// verdict hash: sha256(canonical({ days, blockParams })) over the post-repair days array exactly
// as placed in the response. Canonicalisation is what makes the hash immune to client round-trip
// key-order differences.

import { createHash } from "node:crypto";
import type { BlockSettings, PlannedDay, SeasonEvent, SeasonFocus, SeasonPlan } from "./types";
import type { DurabilityInsertEnvelope } from "./calibration";
import { splitPlanProtocol } from "./workout-validate";
import {
  validateEventTaper,
  validateRecoveryWeekDensity,
  validateSchedule,
  validateSkeletonConformance,
  validateWeekSequencing,
} from "./schedule-validate";
import { validateWeekHours, type BlockSkeleton, type WeekTarget } from "./block-skeleton";
import { validateSessionRequirements, type SessionRequirements } from "./session-requirements";
import { validateBlockFocus, validateFocusMatch, validatePrimaryQualityCadence, validateSeasonFit } from "./season";

// Recursive key-sort + stringify. Arrays keep order (order is meaningful); object keys sort so
// byte-equality survives a JSON round-trip that reordered keys. Keys whose value is undefined are
// SKIPPED, matching JSON.stringify's own semantics — a plan that round-trips through the client
// loses its undefined-valued keys entirely, so emitting them here (as null) would hash-mismatch
// every such plan at write time (Task 4 compares client-round-tripped hashes).
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export function verdictHash(days: PlannedDay[], blockParams: unknown): string {
  return createHash("sha256").update(canonical({ days, blockParams })).digest("hex");
}

export interface PublicationGateArgs {
  days: PlannedDay[];
  truncated: boolean;
  expectedDayCount: number;
  ftp: number;
  envelope: DurabilityInsertEnvelope;
  blockSettings: BlockSettings;
  weekTargets: WeekTarget[];
  blockSkeleton: BlockSkeleton;
  events: SeasonEvent[];
  requirements: SessionRequirements;
  // Which season family runs: event-anchored → validateSeasonFit/validateFocusMatch against the
  // replanned arc; rolling → validateBlockFocus/validatePrimaryQualityCadence against the chosen
  // focus; null skips the season family entirely (mirrors the route's own branch flags).
  seasonContext: { mode: "event-anchored"; plan: SeasonPlan } | { mode: "rolling"; focus: SeasonFocus } | null;
}

export interface GateVerdict {
  blockers: string[];
  preferences: string[];
  advisories: string[];
}

export function evaluatePublicationGate(args: PublicationGateArgs): GateVerdict {
  const blockers: string[] = [];
  const preferences: string[] = [];
  const advisories: string[] = [];

  // ---- Structural/integrity checks (new, owned here): malformed output never reaches the calendar.
  if (args.truncated) {
    blockers.push("STRUCTURE: The AI response hit the token limit and may be incomplete.");
  }
  if (args.days.length !== args.expectedDayCount) {
    blockers.push(`STRUCTURE: Expected ${args.expectedDayCount} days but the plan carries ${args.days.length}.`);
  }
  const sortedDates = args.days.map((d) => d.date).sort();
  const duplicateDates = sortedDates.filter((d, i) => i > 0 && d === sortedDates[i - 1]);
  if (duplicateDates.length > 0) {
    blockers.push(
      `STRUCTURE: Duplicate day date(s) — ${[...new Set(duplicateDates)].join(", ")}. Each calendar date must appear exactly once.`
    );
  }
  // Non-contiguous sequence: after sorting, consecutive unique dates must step exactly +1 day.
  const uniqueSortedDates = [...new Set(sortedDates)];
  for (let i = 1; i < uniqueSortedDates.length; i++) {
    const gapDays =
      (Date.parse(`${uniqueSortedDates[i]}T12:00:00Z`) - Date.parse(`${uniqueSortedDates[i - 1]}T12:00:00Z`)) / 86_400_000;
    if (gapDays !== 1) {
      blockers.push(
        `STRUCTURE: Dates are not contiguous — no plan day between ${uniqueSortedDates[i - 1]} and ${uniqueSortedDates[i]}.`
      );
    }
  }

  // ---- Protocol facts (splitPlanProtocol): violations AND hazards are publication blockers;
  // duration-consistency advisories are informational (dead in the generate path post-reconcile).
  const protocol = splitPlanProtocol(args.days, args.ftp, args.envelope);
  blockers.push(...protocol.violations);
  blockers.push(...protocol.hazards);
  advisories.push(...protocol.advisories);

  // ---- Spacing/budget (validateSchedule's typed halves). Sole per-finding exception
  // (ADR-recorded): with qualitySessionsPerLoadingWeek >= 3 the skeleton's canonical placement is
  // best-effort and may produce adjacency BY DESIGN — regeneration cannot beat a deterministic
  // placement limit — so the back-to-back finding degrades to an informed-override preference.
  // Decided here by emitter + settings; at the default budget (<=2) adjacency stays a hard blocker.
  const schedule = validateSchedule(args.days, args.blockSettings, args.ftp, args.weekTargets, args.events);
  const adjacencyIsPreference = args.blockSettings.qualitySessionsPerLoadingWeek >= 3;
  (adjacencyIsPreference ? preferences : blockers).push(...schedule.spacing);
  blockers.push(...schedule.budget);

  // ---- Remaining blocker-owned validators, each called exactly once.
  blockers.push(...validateEventTaper(args.days, args.events, args.ftp, args.blockSettings));
  blockers.push(...validateWeekHours(args.days, args.weekTargets));
  blockers.push(...validateSkeletonConformance(args.days, args.blockSkeleton));
  blockers.push(...validateRecoveryWeekDensity(args.days, args.weekTargets, args.blockSettings, args.ftp, args.events));
  blockers.push(...validateWeekSequencing(args.days));

  // ---- Preference-owned validators.
  preferences.push(...validateSessionRequirements(args.days, args.requirements));
  if (args.seasonContext?.mode === "event-anchored") {
    preferences.push(...validateSeasonFit(args.days, args.seasonContext.plan, args.ftp));
    preferences.push(...validateFocusMatch(args.days, args.seasonContext.plan, args.ftp));
  } else if (args.seasonContext?.mode === "rolling") {
    preferences.push(...validateBlockFocus(args.days, args.seasonContext.focus, args.ftp));
    preferences.push(...validatePrimaryQualityCadence(args.days, args.seasonContext.focus, args.weekTargets, args.ftp));
  }

  return { blockers, preferences, advisories };
}
