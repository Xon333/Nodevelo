#!/usr/bin/env node
// Prototype deterministic design-audit detector — the impeccable idea
// (https://github.com/pbakaus/impeccable) adapted to NodeVelo's Tailwind classes + our locked
// DESIGN.md. No deps, no API, no app coupling: `node detect.mjs <files...>`. Exit 2 if findings.
//
// This is a PROTOTYPE to show the value, not a product. Rules are tuned to OUR system so the output is
// signal, not noise (e.g. tiny-text ignores uppercase eyebrow labels; em-dash uses impeccable's >2
// threshold). It does source-text (regex) checks only — the real tool also renders pages.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- DESIGN.md-aware palette: the allowed hexes are READ from the repo-root DESIGN.md (every #rrggbb
// it documents), with an inlined fallback. This is what makes the off-palette check trustworthy —
// it checks code against the actual design doc, so a sanctioned token (e.g. #7fe7ff) is never flagged.
const FALLBACK_HEX = ["ff49c8", "00d4ff", "7fe7ff", "10b981", "06b6d4", "f59e0b", "f97316", "f43f5e", "d946ef", "8b5cf6"];
function loadAllowedHex() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const hexes = [...readFileSync(join(root, "DESIGN.md"), "utf8").matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase());
    if (hexes.length) return new Set(hexes);
  } catch {
    /* fall through to the inlined set */
  }
  return new Set(FALLBACK_HEX);
}
const ALLOWED_HEX = loadAllowedHex();
const COLORED_BG = /\bbg-(amber|red|rose|orange|emerald|cyan|fuchsia|violet|green|blue|pink|lime|teal|indigo)-\d{2,3}\b/;
const LIGHT_ONLY = /\b(bg-white|bg-zinc-50|text-zinc-900|text-zinc-800|border-zinc-200)\b/;

// rule id → {category, severity, why}
const RULES = {
  "off-palette-color": ["design-system", "warn", "literal hex not in DESIGN.md's palette — make it a token or zinc/status class"],
  "tiny-text": ["quality", "warn", "sub-12px body text is hard to read (uppercase eyebrow labels are exempt)"],
  "gray-on-color": ["quality", "warn", "muted zinc text on a colored background reads washed out"],
  "gradient-text": ["slop", "advisory", "bg-clip-text gradient — an AI tell (DESIGN.md waives it for the wordmark only)"],
  "em-dash-overuse": ["slop", "advisory", "more than two em-dashes in one string is an AI cadence tell (no-data — glyphs exempt)"],
  "native-title-tooltip": ["consistency", "advisory", "native title= on a DOM element — prefer InfoDot/MetricTip for a labelled metric explanation (per-datum detail is fine)"],
  "light-only-color": ["dual-theme", "warn", "light-mode color with no dark: sibling — a dark-mode regression (toggle knobs / status dots exempt)"],
  "muted-contrast": ["a11y", "warn", "text-zinc-400 as a light-mode color reads ~3.5:1 on white (under WCAG AA 4.5:1) — use text-zinc-500 dark:text-zinc-400"],
};

function scanLine(line) {
  const out = [];
  const isButton = /<button\b/.test(line) || /aria-label=/.test(line);

  // off-palette-color
  for (const m of line.matchAll(/\[#([0-9a-fA-F]{3,8})\]/g)) {
    const hex = m[1].toLowerCase();
    if (hex.length === 6 && !ALLOWED_HEX.has(hex)) out.push(["off-palette-color", `[#${m[1]}]`]);
  }
  // tiny-text — only when NOT an uppercase label
  for (const m of line.matchAll(/text-\[(\d+)px\]/g)) {
    if (Number(m[1]) < 12 && !/\buppercase\b/.test(line)) out.push(["tiny-text", `${m[0]} (no uppercase label)`]);
  }
  // gray-on-color
  if (/\btext-zinc-(400|500)\b/.test(line) && COLORED_BG.test(line)) {
    out.push(["gray-on-color", `${line.match(/text-zinc-(400|500)/)[0]} + ${line.match(COLORED_BG)[0]}`]);
  }
  // gradient-text
  if (/\bbg-clip-text\b/.test(line)) out.push(["gradient-text", "bg-clip-text"]);
  // em-dash overuse — >2 inside a SINGLE quoted string (real body copy), not glyphs/labels summed
  // across one JSX line. The lone "—" no-data placeholder glyph is exempt.
  for (const m of line.matchAll(/"[^"]*"|'[^']*'|`[^`]*`/g)) {
    const s = m[0].slice(1, -1);
    const n = (s.match(/—/g) || []).length;
    if (s !== "—" && n > 2) out.push(["em-dash-overuse", `${n} em-dashes in one string`]);
  }
  // native-title-tooltip — genuine native title= on a DOM element. Skips component props
  // (<Section title=…>, <Card title=…>) and buttons; per DESIGN.md a native title is fine for dense
  // per-datum detail, so this is a gentle "prefer InfoDot for a labelled metric explanation" nudge.
  const isComponentProp = /<[A-Z][A-Za-z]*\b[^>]*\btitle=/.test(line) || /\b(Section|Card|Tile)\b[^>]*\btitle=/.test(line);
  if (/\btitle=/.test(line) && !isButton && !isComponentProp) {
    out.push(["native-title-tooltip", line.match(/title=\{?["'`][^"'`]{0,40}/)?.[0] ?? "title="]);
  }
  // light-only-color (no dark: on the same line) — a real dark-mode gap. Exempts the toggle-knob /
  // status-dot pattern (a small absolute rounded-full element is theme-agnostic by design).
  const isKnob = /\babsolute\b/.test(line) && /\brounded-full\b/.test(line);
  if (LIGHT_ONLY.test(line) && !/\bdark:/.test(line) && !isKnob) out.push(["light-only-color", line.match(LIGHT_ONLY)[0]]);

  // muted-contrast (A11Y-1) — a text-zinc-400 class whose variant chain is NOT dark-gated applies in
  // light mode, where zinc-400 on white is ~2.6:1 (under WCAG AA 4.5:1). Inspect the whole token's
  // variant chain (not just an immediate dark:) so compound dark-only variants — dark:hover:text-zinc-400,
  // dark:disabled:text-zinc-400 — are correctly exempt. The AA muted pattern is text-zinc-500
  // dark:text-zinc-400. Knob/dot is theme-agnostic; gray-on-color is flagged above.
  if (!isKnob && !COLORED_BG.test(line)) {
    for (const m of line.matchAll(/(?:^|[^\w:-])((?:[\w-]+:)*text-zinc-400)\b/g)) {
      if (!m[1].split(":").includes("dark")) {
        out.push(["muted-contrast", `${m[1]} light-mode <4.5:1 — use text-zinc-500 dark:text-zinc-400`]);
        break;
      }
    }
  }

  return out;
}

let total = 0;
const counts = {};
for (const file of process.argv.slice(2)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`! cannot read ${file}`);
    continue;
  }
  const lines = text.split("\n");
  const findings = [];
  lines.forEach((line, i) => {
    for (const [id, snippet] of scanLine(line)) findings.push({ id, line: i + 1, snippet });
  });
  // file-level: arbitrary-value sprawl (one-off [..] magic values that bypass the scale)
  const arb = new Set([...text.matchAll(/(?:bg|text|border|w|h|gap|p[xytrbl]?|m[xytrbl]?|top|left|right|bottom|leading|tracking|rounded|shadow|min-w|max-w|min-h|max-h)-\[[^\]]+\]/g)].map((m) => m[0]));
  if (findings.length === 0 && arb.size <= 14) continue;

  console.log(`\n${file}`);
  for (const f of findings) {
    const [cat, sev] = RULES[f.id];
    counts[f.id] = (counts[f.id] || 0) + 1;
    total++;
    console.log(`  ${sev.padEnd(8)} ${f.id.padEnd(20)} L${f.line}  ${f.snippet}`);
  }
  if (arb.size > 14) console.log(`  advisory arbitrary-sprawl      —    ${arb.size} distinct one-off [..] values (scale drift)`);
}

console.log(`\n— ${total} line-level findings ${Object.keys(counts).length ? "(" + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ") + ")" : ""}`);
process.exit(total > 0 ? 2 : 0);
