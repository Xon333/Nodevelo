# 04 · Knowledge — the corpus that grounds generation

**Why this exists:** the app splits memory into two kinds treated oppositely — **durable intent** (goals, weakpoints, PRs, coaching notes: athlete-owned, hand-edited, never recomputed) and **synced physiology** (FTP, zones, weight: Intervals.icu-owned, never hand-edited, always reconciled). This layer holds the intent side plus the sports-science reference the LLM reads, and the feedback channels that let blocks learn from each other. **Where it sits:** feeds [06-generation](06-generation.md)'s prompt; written by the retrospective flow; edited on the Knowledge page. **Tradeoff:** markdown is athlete-friendly but structurally fragile — hence the parsers, strippers, and the JSON migration of goals/weakpoints.

Owner module: `lib/kb-loader.ts` (always reads fresh from disk — never memoized, so KB edits apply on the next generation). Goals/weakpoints migrated out of the markdown into structured `AthleteProfile.goals`/`weakpoints` JSON (edited on `/profile`, seeded once from the old tables); the markdown's own GOALS/WEAKPOINTS sections are stripped pre-prompt so a stale copy can never leak alongside the live data. `athlete_profile.md` keeps only true manual input — personal data, all-time PRs, coaching notes — and its header says exactly what is synced from where.

## The two directories

| | `knowledge-base/` | `knowledge-base-defaults/` |
|---|---|---|
| Git | **ignored** — the athlete's personal corpus | committed skeleton |
| Content | Real coaching knowledge, edited via the Knowledge page (`/api/knowledge`, edit-only — no create/delete of core files) or by hand | Thin stubs so a fresh clone never hard-fails, and so the §-anchor references cited in prompt hard-rules exist somewhere in-repo |
| Resolution | `readKbWithFallback` prefers this… | …and falls back here per-file |

Files, concatenated into the prompt in `KB_ORDER`: `cycling_database.md`, `training_knowledge.md`, `nutrition_knowledge.md`, `athlete_profile.md` (+ `bikefit_knowledge.md` if present), each under a `===== FILE: x.md =====` header. Before injection: `stripObsidianSyntax` (drops `## Related notes`, flattens `[[wikilinks]]`) and `stripGoalsWeakpointsSections` (goals/weakpoints now live in `athlete.json` and are injected separately — the markdown sections would be stale duplicates).

`athlete_profile.md` is also **structurally parsed** (`parseAthleteMd`) to keep `athlete.json` performance numbers in sync — but live *zones* come from the physiology store (synced from Intervals.icu), not the markdown.

## Block retrospectives (the durable corpus)

One file per completed block: `knowledge-base/block-retrospectives/<startDate>_<goal-slug>.md`, written by `POST /api/retrospective` (prose body = Claude's narrative; frontmatter = the contract below). Deliberately **excluded** from `loadKnowledgeBaseContext` so history never bloats every prompt.

### Frontmatter contract

Committed reference for the schema (the live `SCHEMA.md` sits inside the gitignored tree): `id`, `goal`, `start_date` / `end_date`, `length_weeks`, `status`, `planned_hours` / `actual_hours`, `compliance_pct`, `ctl_start` / `ctl_end`, `compliance_by_type`, **`next_block_seeds`** (YAML list — athlete-editable steering), `generated_at`.

## The two feedback channels (easy to describe incompletely — don't)

One retrospective call feeds the next generation through **two unrelated stores**:

1. **Seeds** — `kb-loader.latestRetrospectiveSeeds` parses `next_block_seeds:` from the *newest* retrospective file only → injected as "PREVIOUS BLOCK PRIORITIES". Athlete-editable by hand in the file.
2. **Structured reflections** — `generateStructuredRetrospective` (forced tool-use, `lib/retrospective-schema.ts`: hypothesis → observation → root cause → adjusted strategy per matured intervention) persisted on `BlockHistoryEntry.structuredReflections` (JSON, **not** the markdown) → re-injected via `formatReflectionsForPrompt` as "COACH REFLECTIONS FROM LAST BLOCK". Degrades to `[]` on any failure.

Debugging "what prior-block context fed this generation" therefore requires checking **both** the newest retrospective file and the newest block-history entry.

## Rules

- KB files are the athlete's voice — agents don't rewrite `knowledge-base/` content on their own initiative.
- `knowledge-base-defaults/` **is** in docs-sweep scope (real user-facing copy, not fixture).
- Protocol numbers in `training_knowledge.md` have two hand-synced shadows (prompt hard rules, validator bands) — see [INVARIANTS](../INVARIANTS.md).
