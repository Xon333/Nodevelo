#!/usr/bin/env node
// HR-64: INVARIANTS.md #31 calls markdown anchors load-bearing but nothing enforced it — this
// does. Validates relative links and same-repo #anchors across every tracked .md file.
//
// docs/superpowers/plans/ is exempt: INVARIANTS #27 makes those files immutable, and several
// intentionally reference an ARCHIVE.md entry that didn't exist yet when the plan was written.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".worktrees", ".claude", ".agents", ".superpowers",
  "prototypes", "coverage", "knowledge-base", "data",
]);
const EXEMPT_PREFIX = path.join(root, "docs", "superpowers", "plans") + path.sep;

function slugify(heading) {
  const stripped = heading.replace(/[^\p{L}\p{N} -]/gu, "");
  return stripped.toLowerCase().trim().replace(/ /g, "-");
}

function collectMarkdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = collectMarkdownFiles(root);
const headingSlugs = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const slugs = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) slugs.add(slugify(m[1]));
  headingSlugs.set(file, slugs);
}

const broken = [];
for (const file of files) {
  if (file.startsWith(EXEMPT_PREFIX)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#L)/.test(target)) continue;
    const [rel, anchor] = target.split("#");
    const abs = rel ? path.resolve(path.dirname(file), rel) : file;
    if (rel && !fs.existsSync(abs)) {
      broken.push(`${path.relative(root, file)}  ->  missing file  ${target}`);
      continue;
    }
    if (anchor && abs.endsWith(".md")) {
      const slugs = headingSlugs.get(abs);
      if (slugs && !slugs.has(anchor)) {
        broken.push(`${path.relative(root, file)}  ->  bad anchor  ${target}`);
      }
    }
  }
}

if (broken.length > 0) {
  console.error(`check-links: ${broken.length} broken link(s):\n${broken.join("\n")}`);
  process.exit(1);
}
console.log(`check-links: ${files.length} markdown files, no broken links`);
