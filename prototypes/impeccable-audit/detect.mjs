#!/usr/bin/env node
// Prototype deterministic design-audit detector — the impeccable idea
// (https://github.com/pbakaus/impeccable) adapted to NodeVelo's Tailwind classes + our locked
// DESIGN.md. No deps, no API, no app coupling: `node detect.mjs <files...>`. Exit 2 if findings.
//
// This is a PROTOTYPE to show the value, not a product. Rules are tuned to OUR system so the output is
// signal, not noise (e.g. tiny-text ignores uppercase eyebrow labels; em-dash uses impeccable's >2
// threshold). It does source-text (regex) checks only — the real tool also renders pages.

import { readFileSync } from "node:fs";

// --- DESIGN.md tokens (a real integration would parse DESIGN.md; inlined here for the prototype) ---
const ALLOWED_HEX = new Set(
  ["ff49c8", "00d4ff", "10b981", "06b6d4", "f59e0b", "f97316", "f43f5e", "d946ef", "8b5cf6"].map((h) => h.toLowerCase())
);
const COLORED_BG = /\bbg-(amber|red|rose|orange|emerald|cyan|fuchsia|violet|green|blue|pink|lime|teal|indigo)-\d{2,3}\b/;
const LIGHT_ONLY = /\b(bg-white|bg-zinc-50|text-zinc-900|text-zinc-800|border-zinc-200)\b/;

// rule id → {category, severity, why}
const RULES = {
  "off-palette-color": ["design-system", "warn", "literal hex outside the DESIGN.md palette — make it a token or zinc/status class"],
  "tiny-text": ["quality", "warn", "sub-12px body text is hard to read (uppercase eyebrow labels are exempt)"],
  "gray-on-color": ["quality", "warn", "muted zinc text on a colored background reads washed out"],
  "gradient-text": ["slop", "advisory", "bg-clip-text gradient — an AI tell (DESIGN.md waives it for the wordmark only)"],
  "em-dash-overuse": ["slop", "advisory", "more than two em-dashes in one string is an AI cadence tell"],
  "native-title-tooltip": ["consistency", "advisory", "informational title= — DESIGN.md standardises on the InfoDot/MetricTip popover (buttons may keep title=)"],
  "light-only-color": ["dual-theme", "warn", "light-mode color with no dark: sibling on the line — a dark-mode regression"],
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
  // em-dash overuse (>2 in the line)
  const dashes = (line.match(/—/g) || []).length;
  if (dashes > 2) out.push(["em-dash-overuse", `${dashes} em-dashes`]);
  // native-title-tooltip (informational title, not on a button)
  if (/\btitle=/.test(line) && !isButton) out.push(["native-title-tooltip", line.match(/title=\{?["'`][^"'`]{0,40}/)?.[0] ?? "title="]);
  // light-only-color (no dark: on the same line)
  if (LIGHT_ONLY.test(line) && !/\bdark:/.test(line)) out.push(["light-only-color", line.match(LIGHT_ONLY)[0]]);

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
