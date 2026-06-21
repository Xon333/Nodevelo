// Athlete-quirk extraction (Track D, lean slice). Mines the athlete's own ride notes
// (activityDescription, already durable in last-sync.json) for RECURRING patterns — symptoms,
// equipment gremlins, psych states, conditions — so the coach recalls history without RAG.
//
// Deterministic, pure TS, no AI. `compromise` does the NLP work (sentence segmentation, so a
// multi-clause note is scanned clause-by-clause); a curated domain lexicon supplies the cycling
// specificity compromise has no notion of. Negation-aware (a clause with "no"/"didn't" doesn't tag
// the symptom). Output is HINTS, not facts (pattern-matching is noisy) — only patterns seen on ≥2
// distinct rides survive. Regenerated in full each sync, so it carries no ledger/backup semantics.
import nlp from "compromise";
import type { AthleteQuirkStore, QuirkCategory, QuirkEntry } from "./types";

interface LexEntry {
  pattern: string; // canonical tag emitted
  category: QuirkCategory;
  re: RegExp; // matched against a lowercased clause (no `g` flag — used with .test)
}

// Curated, deliberately small. Each regex tolerates morphology (cramp/cramping/cramped) via
// word-prefix matching. Tuned conservative on noisy tokens (heat/cold) to limit false positives.
const QUIRK_LEXICON: LexEntry[] = [
  // symptoms
  { pattern: "cramp", category: "symptom", re: /\bcramp\w*/ },
  { pattern: "bonk", category: "symptom", re: /\bbonk\w*|\bhit the wall\b/ },
  { pattern: "knee pain", category: "symptom", re: /\bknee\b[^.]{0,14}\b(pain|ache|sore|hurt|niggl)\w*|\b(pain|ache|sore|hurt|niggl)\w*[^.]{0,14}\bknee\b/ },
  { pattern: "back pain", category: "symptom", re: /\b(low(er)?\s+)?back\b[^.]{0,14}\b(pain|ache|sore|hurt|tight|spasm)\w*/ },
  { pattern: "nausea", category: "symptom", re: /\bnause\w*|\bqueasy\b|\bsick to (my|the) stomach\b/ },
  { pattern: "saddle sore", category: "symptom", re: /\bsaddle[\s-]*sore\w*/ },
  // equipment
  { pattern: "ghost resistance", category: "equipment", re: /\bghost[\s-]*resistance\b|\bresistance\s+(spik|jump|surg)\w*/ },
  { pattern: "chain issue", category: "equipment", re: /\bchain\b[^.]{0,16}\b(drop|skip|slip|snap|jam|grind|suck)\w*|\bdropped (my|the) chain\b/ },
  { pattern: "puncture", category: "equipment", re: /\bpunctur\w*|\bflat\s+t[yi]re\b|\bflatted\b/ },
  { pattern: "creak", category: "equipment", re: /\bcreak\w*/ },
  { pattern: "shifting issue", category: "equipment", re: /\bdi2\b[^.]{0,16}\b(dead|flat|drop|fail)\w*|\bshift\w*\s+(issue|problem|fault|fail)\w*|\bwon'?t shift\b|\bghost shift\w*/ },
  { pattern: "power meter dropout", category: "equipment", re: /\bpower\s*meter\b[^.]{0,16}\b(drop|cut|spik|zero|die|dead)\w*|\bpm dropout\b/ },
  // psyche
  { pattern: "low motivation", category: "psyche", re: /\bunmotivat\w*|\bno motivation\b|\bcouldn'?t get going\b|\bmentally (flat|tough|hard|done)\b|\bdread\w*/ },
  { pattern: "indoor aversion", category: "psyche", re: /\bhate\w*\s+(the\s+)?(turbo|trainer|indoor)\w*|\bindoor\b[^.]{0,12}\b(boring|dread|slog|grind)\w*|\bturbo\b[^.]{0,12}\b(boring|dread|hate|slog)\w*/ },
  // conditions
  { pattern: "heat", category: "condition", re: /\bin the heat\b|\bsweltering\b|\bhumid\w*|\boverheat\w*|\bheat\b[^.]{0,12}\b(killed|got to me|cooked|sapped)\b/ },
  { pattern: "headwind", category: "condition", re: /\bheadwind\w*|\binto the wind\b|\bblock headwind\b|\bbrutal wind\b/ },
  { pattern: "cold", category: "condition", re: /\bfreezing\b|\bbitter(ly)? cold\b|\bnumb (hands|feet|fingers|toes)\b/ },
];

// A clause containing one of these before/around the match negates it ("no cramp", "didn't bonk").
const NEGATOR = /\b(no|not|never|without|none|avoid\w*|didn'?t|don'?t|wasn'?t|weren'?t|haven'?t|hadn'?t|couldn'?t)\b/;

const MAX_ACTIVITIES = 200; // cost/relevance bound — scan the most recent notes only
const EVIDENCE_MAX = 120;

interface Acc {
  category: QuirkCategory;
  rideIds: Set<string>; // distinct rides → frequency
  firstSeen: string;
  lastSeen: string;
  evidence: string;
}

// Split a sentence into clauses so a negation in one clause ("dropped the chain but no cramps")
// doesn't suppress a real hit in another.
function clauses(sentence: string): string[] {
  return sentence.split(/[,;]|\bbut\b|\balthough\b|\bthough\b|\bhowever\b|\bwhereas\b/);
}

export function extractQuirks(
  activities: Array<{ id: string; date: string; description: string | null }>,
  now: string = new Date().toISOString()
): AthleteQuirkStore {
  const withNotes = activities
    .filter((a) => a.description && a.description.trim().length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ACTIVITIES);

  const acc = new Map<string, Acc>();

  for (const act of withNotes) {
    const sentences: string[] = nlp(act.description as string).sentences().out("array");
    // Track which patterns this single ride matched, so frequency counts distinct rides not mentions.
    const matchedHere = new Set<string>();
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      for (const lex of QUIRK_LEXICON) {
        if (matchedHere.has(lex.pattern)) continue;
        // The pattern must appear in a clause that is NOT negated.
        const hitClause = clauses(lower).find((c) => lex.re.test(c) && !NEGATOR.test(c));
        if (!hitClause) continue;
        matchedHere.add(lex.pattern);
        const snippet = sentence.trim().replace(/\s+/g, " ").slice(0, EVIDENCE_MAX);
        const existing = acc.get(lex.pattern);
        if (existing) {
          existing.rideIds.add(act.id);
          if (act.date < existing.firstSeen) existing.firstSeen = act.date;
          if (act.date > existing.lastSeen) {
            existing.lastSeen = act.date;
            existing.evidence = snippet; // keep the most-recent mention as evidence
          }
        } else {
          acc.set(lex.pattern, {
            category: lex.category,
            rideIds: new Set([act.id]),
            firstSeen: act.date,
            lastSeen: act.date,
            evidence: snippet,
          });
        }
      }
    }
  }

  const entries: QuirkEntry[] = [...acc.entries()]
    .map(([pattern, a]) => ({
      pattern,
      category: a.category,
      frequency: a.rideIds.size,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      evidence: a.evidence,
    }))
    .filter((e) => e.frequency >= 2) // recurring only — single mentions are noise
    .sort((a, b) => b.frequency - a.frequency || b.lastSeen.localeCompare(a.lastSeen));

  return { entries, extractedAt: now, engine: "compromise+lexicon" };
}

// Pure formatter for the generation prompt. Empty → "" (caller concatenates nothing). The phrasing
// is the AI-containment guardrail: these are HINTS the coach may weave in, never asserted facts.
export function formatQuirksForPrompt(entries: QuirkEntry[]): string {
  if (!entries.length) return "";
  const items = entries
    .slice(0, 8)
    .map((e) => `${e.pattern} (${e.category}, ${e.frequency}×, last ${e.lastSeen})`)
    .join("; ");
  return (
    "\nRECURRING PATTERNS (auto-derived from ride notes — hints for pacing/cueing, not clinical " +
    `facts; pattern-matching is noisy): ${items}.`
  );
}
