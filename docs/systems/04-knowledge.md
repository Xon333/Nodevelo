# 04 · Knowledge — athlete-owned reference and block history

**Why this exists:** athlete-owned reference notes and completed-block history remain readable and editable without competing with Intervals.icu-owned physiology. **Where it sits:** written by retrospective closeout and edited on the Knowledge page. Deterministic generation reads typed application data, not these markdown files. **Tradeoff:** markdown is athlete-friendly but structurally fragile, so compatibility parsers remain for historical files and acknowledgement stamps.

Owner module: `lib/kb-loader.ts`. Goals/weakpoints migrated out of markdown into structured `AthleteProfile.goals`/`weakpoints` JSON (edited on `/profile`, seeded once from old tables). `athlete_profile.md` remains a legacy/manual reference, while physiology comes from the effective-dated store synced from Intervals.icu.

## The two directories

| | `knowledge-base/` | `knowledge-base-defaults/` |
|---|---|---|
| Git | **ignored** — the athlete's personal corpus | committed skeleton |
| Content | Athlete reference notes, edited via the Knowledge page (`/api/knowledge`, edit-only — no create/delete of core files) or by hand | Thin stubs so a fresh clone never hard-fails |
| Resolution | `readKbWithFallback` prefers this… | …and falls back here per-file |

`KB_ORDER` controls editor/list ordering and per-file fallback: `cycling_database.md`, `training_knowledge.md`, `nutrition_knowledge.md`, `athlete_profile.md` (+ `bikefit_knowledge.md` if present). Legacy syntax helpers remain available for stored content, but there is no all-files prompt/context loader.

`athlete_profile.md` is also **structurally parsed** (`parseAthleteMd`) to keep `athlete.json` performance numbers in sync — but live *zones* come from the physiology store (synced from Intervals.icu), not the markdown.

## Block retrospectives (the durable corpus)

One file per completed block: `knowledge-base/block-retrospectives/<startDate>_<goal-slug>.md`, written by `POST /api/retrospective` (prose body = optional Claude narrative; frontmatter = the contract below). These files are history only and never enter block compilation.

### Frontmatter contract

Committed reference for the schema (the live `SCHEMA.md` sits inside the gitignored tree): `id`, `goal`, `start_date` / `end_date`, `length_weeks`, `status`, optional early-end fields, execution evidence fields, legacy **`seeds_approved`**, legacy `next_block_seeds` (deterministic evidence-templated closeout priorities), and `generated_at`. The route writes `seeds_approved: false`; acknowledgement flips it to `true` for workflow/history only.

## The two retrospective note channels

One closeout writes two unrelated history records. Neither is a planning input, before or after acknowledgement:

1. **Closeout priorities** — `block-closeout.deriveCloseoutSeeds` produces deterministic notes from frozen ledger evidence. They are stored under the legacy `next_block_seeds` name. `parseRetroSeeds` and the `seeds_approved` transform remain for file compatibility and acknowledgement; there is no newest-file generation loader.
2. **Structured reflections** — `generateStructuredRetrospective` optionally phrases intervention outcomes into `BlockHistoryEntry.structuredReflections` (JSON, not markdown). `reflectionsApprovedAt` records athlete acknowledgement. There is no formatter or selector that injects reflections into generation.

`POST /api/history` updates both stamps in a failure-safe, idempotent sequence. The action means “reviewed and acknowledged,” not “grant planning authority.”

## Rules

- KB files are the athlete's voice — agents don't rewrite `knowledge-base/` content on their own initiative.
- `knowledge-base-defaults/` **is** in docs-sweep scope (real user-facing copy, not fixture).
- Protocol prose in `training_knowledge.md` is explanatory. Execution authority lives in `workout-templates.ts` and `workout-validate.ts` (INVARIANT 17).

## Common modifications

| Change | Where |
|---|---|
| KB file set / display order | `lib/kb-loader.ts` — `KB_ORDER` |
| Retrospective schema | The frontmatter contract above + `kb-loader.ts` parsers |
