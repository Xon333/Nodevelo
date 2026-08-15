// A single shared parser for the zone-expression syntax an athlete note (via the intent schema) can
// carry: a bare digit ("2"), "Z2"/"z2", "zone 2", a range ("Z3-4", "3-4", "Z3–Z4", "zone 3 to 4"), or a
// comma-separated list ("z2,z3", "Z2, Z4"). Every zone-string consumer — grounding (lib/intent-grounding.ts)
// and scoring (lib/intent-scoring.ts) — reads through this ONE parser so they can never silently
// diverge on what counts as valid syntax again.
//
// NV-2 (2026-08-15): they already had, live-confirmed on real overlays — the scorer's own zoneIndex
// accepted a bare "3", but grounding required the exact canonical "Z3" and rejected "3" outright, so an
// athlete's explicitly-stated zone claim was reported as "not grounded in the note". Ranges like "3-4"
// were unparseable by EITHER side.

// Matches one zone atom: an optional "z"/"zone" prefix (case-insensitive via the caller's "i" flag),
// optional whitespace, then a digit 1-7. The prefix is genuinely optional — "2" alone must match.
const ZONE_ATOM_SRC = "(?:z(?:one)?)?\\s*([1-7])";
const SINGLE_RE = new RegExp(`^${ZONE_ATOM_SRC}$`, "i");
const RANGE_RE = new RegExp(`^${ZONE_ATOM_SRC}\\s*(?:-|–|—|to)\\s*${ZONE_ATOM_SRC}$`, "i");

// Parses one zone EXPRESSION (not a whole note) into the canonical "Z<n>" labels it names, widest to
// narrowest: comma list > range > single atom. Returns [] when the expression isn't recognisable —
// never throws, never partially parses (a caller that gets [] should treat the whole expression as
// unparseable, not guess from a partial match).
export function parseZoneExpression(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((part) => parseZoneExpression(part));
    // Fail closed on the WHOLE list if any segment doesn't parse — a malformed list shouldn't
    // silently drop the bad part and pretend it's a well-formed shorter one.
    if (parts.some((zones) => zones.length === 0)) return [];
    return [...new Set(parts.flat())];
  }

  const range = RANGE_RE.exec(trimmed);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    // Fail closed rather than guess a direction — "Z4-2" is not a valid ascending range.
    return lo <= hi ? Array.from({ length: hi - lo + 1 }, (_, i) => `Z${lo + i}`) : [];
  }

  const single = SINGLE_RE.exec(trimmed);
  return single ? [`Z${single[1]}`] : [];
}

// A human-readable label for a parsed zone set, for evidence/debrief text — never for identity (use
// the raw parseZoneExpression() array, or its length===1 element, for that). A contiguous range reads
// as "Z3-Z4"; a non-contiguous list (from a comma expression) reads as "Z2/Z4" so it can never be
// mistaken for a range that also implies the zones between them.
export function formatZoneLabel(raw: string | undefined | null): string {
  const zones = parseZoneExpression(raw);
  if (zones.length === 0) return (raw ?? "").toUpperCase();
  if (zones.length === 1) return zones[0];
  const nums = zones.map((z) => Number(z[1]));
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous ? `${zones[0]}-${zones[zones.length - 1]}` : zones.join("/");
}
