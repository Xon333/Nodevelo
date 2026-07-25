# Start here

The front door to NodeVelo's documentation. Every doc has one job; this page tells you which one answers your question.

**What is NodeVelo?** A local-first AI cycling coach for one athlete. Next.js 16 app, no database — JSON files + markdown knowledge base on disk. Deterministic TypeScript engines compute every number; Claude only arranges sessions and phrases advice. Syncs with Intervals.icu.

**Coding right now, not reading for pleasure?** Skip everything below and go straight to **[DEV_QUICKSTART.md](DEV_QUICKSTART.md)** — a one-page lookup table, not a doc to read through.

## Where do I go?

| Your question | Read |
|---|---|
| "Map the whole repo for me" | [ATLAS.md](ATLAS.md) — systems, folders, entry points, critical files |
| "What does this domain term mean?" | [GLOSSARY.md](GLOSSARY.md) |
| "How does subsystem X work?" | [systems/](#the-systems-shelf) — one doc per subsystem, with diagrams |
| "Which file does X? Who imports it?" | [reference/FILE_INDEX.md](reference/FILE_INDEX.md) |
| "Where are the LLM calls / prompts?" | [reference/PROMPT_INDEX.md](reference/PROMPT_INDEX.md) |
| "What must I never break?" | [reference/INVARIANTS.md](reference/INVARIANTS.md) |
| "How do I make change X?" | [workflows.md](workflows.md) — step-by-step recipes |
| "Why is it built this way?" | [adr/](adr/) — architecture decision records |
| "I'm an AI agent, orient me fast" | [AI_CONTEXT.md](AI_CONTEXT.md) |
| "Why the design decisions, in prose?" | [../README.md](../README.md) — the architectural manual |
| "What can the app do?" | [../FEATURES.md](../FEATURES.md) — capability catalogue |
| "What's next / open work?" | [../ROADMAP.md](../ROADMAP.md) (forward-only; stable IDs #1–4, §5–7, Tracks A–C) |
| "What already shipped?" | [../ARCHIVE.md](../ARCHIVE.md) (keyed lookup by heading, not linear reading) |
| "Live bug list?" | [../todo.md](../todo.md) |
| "Visual tokens / component rules?" | [../DESIGN.md](../DESIGN.md), governed by [../UX-CONSTITUTION.md](../UX-CONSTITUTION.md) |
| "Daily commands / runbooks?" | [../WORKFLOW.md](../WORKFLOW.md) |

## The systems shelf

| Doc | Covers |
|---|---|
| [systems/generation-pipeline.md](systems/generation-pipeline.md) | Season → block → workout: the whole `/api/generate` pipeline, deterministic/AI seam, validators |
| [systems/ai-layer.md](systems/ai-layer.md) | Anthropic integration: models, prompt caching, tool schemas, cost tracking, debugging |
| [systems/scoring-and-learning.md](systems/scoring-and-learning.md) | Ride → execution score → ledger → athlete model → insights → interventions → calibration |
| [systems/daily-loop.md](systems/daily-loop.md) | Morning check, readiness, athlete state fusion, coach snapshot, disposition |
| [systems/season-engine.md](systems/season-engine.md) | Macro periodization: rolling vs event-anchored, the coverage selector |
| [systems/data-and-sync.md](systems/data-and-sync.md) | JSON persistence (atomic writes, `.bak`, locks), Intervals.icu sync, calendar mirror, backup |
| [systems/knowledge-system.md](systems/knowledge-system.md) | Knowledge base, block retrospectives, the two feedback channels into generation |
| [systems/frontend.md](systems/frontend.md) | Pages, component ownership, client state, design-system pointers |

## Reading paths

**New engineer (~1 hour):** [ATLAS.md](ATLAS.md) → [../README.md](../README.md) "The core idea" section → [systems/generation-pipeline.md](systems/generation-pipeline.md) → [systems/scoring-and-learning.md](systems/scoring-and-learning.md) → skim [GLOSSARY.md](GLOSSARY.md) → run `npm run dev` (setup in README).

**AI coding agent:** [AI_CONTEXT.md](AI_CONTEXT.md), then the one systems doc for the area you're changing, then [reference/INVARIANTS.md](reference/INVARIANTS.md) before editing.

**Owner returning after a break:** [../ROADMAP.md](../ROADMAP.md) "State of the app" banner → [../todo.md](../todo.md) → `git log --oneline -20` → [ATLAS.md](ATLAS.md) if anything looks unfamiliar.

## Ownership rules (who documents what)

One fact, one home. When docs used to duplicate each other, the owner is now:

- **What a page/feature does** → [../FEATURES.md](../FEATURES.md). README's Pages table stays a *contract* table (route ↔ component ↔ API); DESIGN.md §8 owns only *layout hierarchy* (fold-1/supporting/collapsed).
- **Per-file facts** (purpose, size, importers) → [reference/FILE_INDEX.md](reference/FILE_INDEX.md). README keeps a grouped overview only.
- **How a subsystem works** → its `docs/systems/` doc. README keeps the *why* (design pillars, tradeoffs).
- **Open work** → ROADMAP.md only. **Shipped work** → ARCHIVE.md only. **Point-in-time reports** → under `docs/`, never the repo root.
- **Agent operating rules** → CLAUDE.md / AGENTS.md (not part of this docs tree; different category).

Conventions for maintaining all of this live in the `docs-sweep` skill (`.claude/skills/docs-sweep/SKILL.md`): ROADMAP is forward-only with stable never-renumbered IDs; CONTINUE.md is session-handoff only (written by `/handoff`, often stale between handoffs — that's by design); `docs/superpowers/plans/` are immutable execution records.
