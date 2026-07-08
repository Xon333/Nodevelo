// Split prose into a visible lead of the first `n` sentences and the disclosed remainder
// (UX v2 court rule 3: visible prose ≤ 3 sentences per card, coach note included). Boundaries
// are sentence punctuation (. ! ?) followed by whitespace — decimals ("IF 0.85") never match
// because no whitespace follows the dot; a rare abbreviation split ("e.g. ") just moves the
// fold a sentence early, which is harmless for a truncation seam.
export function splitLeadSentences(text: string, n = 3): { lead: string; rest: string | null } {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter((s) => s !== "");
  if (parts.length <= n) return { lead: text.trim(), rest: null };
  return { lead: parts.slice(0, n).join(" "), rest: parts.slice(n).join(" ") };
}
