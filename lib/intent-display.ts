// Debrief copy for Phase 2b's intent overlay (Phase 2c). Design §13/§5.3 specify two of the four
// Not-scored strings verbatim; the other two, and the medium-confidence caption, are this file's own
// wording — Phase 2b's plan Handoff boundary is explicit that "the wording is 2c's; 2b ships the
// discriminator only." Pure string formatting, no React, so it's testable without jsdom.
import type { IntentInterpretation, NotScoredReason, StructuredIntent } from "./types";

export function formatIntentUsed(intent: StructuredIntent): string {
  if (intent.phases.length === 0) return intent.primaryPurpose;
  return intent.phases.map((p) => p.description).join(" → ");
}

// NV-4 (2026-08-15): "nothing measurable to verify" used to be shown for four different situations —
// each now gets its own message so the athlete can tell "you didn't state anything checkable" apart
// from "you did, but the data couldn't confirm it."
const NOT_SCORED_MESSAGES: Record<NotScoredReason, string> = {
  "no-intent-found": "Not scored — no intent found",
  "intent-unreliable": "Not scored — intent could not be determined reliably",
  "interpreter-failed": "Not scored — the ride note couldn't be parsed",
  "no-measurable-objectives": "Not scored — nothing measurable to verify",
  "target-not-grounded": "Not scored — the stated target wasn't clearly grounded in your note",
  "insufficient-scope": "Not scored — not enough of the ride matched the stated target",
  "target-not-matched": "Not scored — nothing in the ride data matched the stated target",
};

export function notScoredMessage(reason: NotScoredReason): string {
  return NOT_SCORED_MESSAGES[reason];
}

// Design §5.3: medium confidence still scores supported objectives — this is not a Not-scored state,
// it's a disclosure shown alongside a real number. High/low confidence need no caption: high is
// unqualified, low is already fully covered by the "intent-unreliable" Not-scored message.
export function confidenceCaption(confidence: IntentInterpretation["confidence"]): string | null {
  if (confidence !== "medium") return null;
  return "Limited basis — only objectives directly supported by the note and data were scored.";
}

// Design §7 step 5, verbatim. Segment-scoped drift (design §7 steps 2-4, "Aerobic drift 3.8% —
// opening 45-minute Z2 segment") is not implemented by any phase through 2c — this is the only
// aerobic-drift string a self-directed ride's debrief can show.
export const AEROBIC_DRIFT_NOT_MEASURABLE = "Aerobic drift not measurable — no sufficiently steady aerobic segment";
