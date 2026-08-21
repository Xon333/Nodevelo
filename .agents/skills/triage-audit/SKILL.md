---
name: triage-audit
description: Use when the user pastes a large externally-authored AI review, audit, or architecture analysis of the repo and wants it evaluated or incorporated into the backlog.
---

# Triage Audit

## Overview

External reviews (repomix exports, other-LLM audits, pasted mega-prompts) have run roughly 70%
accurate against this repo historically — they often analyze "the repo they expected," not this one.
Ground-truth every claim against the actual code before acting on any of it.

## Procedure

1. Read the full pasted document once before responding.
2. For each distinct claim or recommendation, check it against the actual code — grep or read the
   referenced file/pattern. Don't take the claim's framing at face value.
3. Watch for these specific known failure modes:
   - Claims re-specifying work that's already shipped (check ARCHIVE.md / git log first).
   - References to attachments, images, PDFs, or repos that were never actually provided.
   - Architecture advice for a deployment model this app doesn't use (e.g. serverless or hosted-DB
     suggestions against a local-first, single-user, filesystem-backed app).
4. Produce a claim-by-claim verdict table: claim → accurate / inaccurate / partial → one-line why,
   citing the file that proves it.
5. Only accurate, genuinely valuable claims get routed into ROADMAP.md or todo.md, with a stable ID
   like any other finding (see `docs-sweep` for format).
6. State an overall accuracy read (e.g. "~70% accurate") so the user can calibrate trust in the source.

## Common mistakes

- Accepting a recommendation because it's well-written rather than because it's true for this codebase.
- Routing an unverified claim into the backlog "just in case" — if it wasn't checked, it doesn't get an ID.
