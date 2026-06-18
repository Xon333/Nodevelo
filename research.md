# NodeVelo — research spikes (not committed)

Exploratory findings on bigger architectural directions. **Nothing here is a build commitment** —
it's recorded so the analysis isn't lost and so the same heavyweight ideas aren't re-proposed
without a reason. Committed forward work lives in [ROADMAP.md](ROADMAP.md).

Every idea here is measured against NodeVelo's three standing mandates (see [README](README.md)):
**local-first single-user**, **zero-bloat** (no heavy deps that re-present existing data), and a
**deterministic core** (the AI never owns arithmetic or physiological limits).

---

## The "Second Brain" vision

Could NodeVelo evolve from a static store into a learning / reasoning / connected "second brain",
framed as **Hippocampus** (memory) · **Cortex** (knowledge) · **Prefrontal** (orchestration)?

**Verdict:** the capabilities mostly *already exist* in lean, deterministic form. The real gap is
**signal fusion** ([ROADMAP §5](ROADMAP.md)), not new frameworks. Most of the surveyed libraries
also conflict with the mandates above (and several overlap items already in ROADMAP "Decided
against").

### Anatomy → what already plays each role today

| Brain region | Capability | Already provided by |
|---|---|---|
| Hippocampus / memory | retain + decay history | immutable `score-log` ledger + rolling baselines + `intervention-log`; EWMA (`α=0.35`) **is** recency decay |
| Cortex / knowledge | connect concepts | KB context-dump (small, intentional) + `synthesis.ts` directives |
| Prefrontal / orchestration | decide cyclically | the sync pipeline + synthesis + the intervention validation loop |

### Per-target findings

| Target | Capability it sells | Verdict | Lean path if ever pursued |
|---|---|---|---|
| `langchain-ai/langgraph` | cyclic hypothesis→verify→refine | **Skip the framework**; chase the outcome | signal fusion (ROADMAP §5) + the existing validation loop |
| `mem0ai/mem0` | memory + decay + entity recall | **Skip** — opaque LLM memory vs. the deterministic core | ledger + EWMA + targeted queries over `score-log` |
| `microsoft/graphrag` | KB correlation graph | **Skip** — heavy Python batch pipeline; ≈ the rejected Obsidian/Cytoscape graph | "knowledge connections (lean)" below |
| `logseq` block-refs | live insight references | **Skip** — ≈ the rejected RxDB/sqlite rewrite | insights are already injected at generation; the ledger is the audit trail |
| HRV / raw FIT (`garmin-fit`) | readiness beyond TSB | **Wanted but gated** — no HRV source today | when one exists, prefer synced `wellness.hrv` → rolling baseline in `readiness.ts` |

### Lean spin-offs worth keeping on the radar

These are the genuinely-useful slices the spike surfaced — small, deterministic, mandate-respecting:

- **Knowledge connections (lean).** Surface simple correlations from the *structured* data already
  held — e.g. compromised-reason (sickness/equipment) → next-session execution, or low-fuel weeks →
  decoupling — computed deterministically and shown in Trends/insights. **Not** a graph DB.
- **HRV-based readiness (gated).** Upgrade `readiness.ts` with an HRV rolling baseline once a data
  source exists. Lightest path = the synced `wellness.hrv` field; FIT-file parsing is the heavy one.
- **Signal fusion** is the genuine "reasoning loop" win and already lives at [ROADMAP §5](ROADMAP.md)
  — that's where the LangGraph / Mem0 *intent* should land, in lean deterministic form.

### Deployment note

This spike was reviewed with deployment left undecided. As of today the app is **local-first,
single-user** (see ROADMAP "Decided against" for why the hosted-SaaS migration items are out of
scope). A hosted, multi-tenant pivot would reopen those — but that's a deliberate product decision,
not a prerequisite for any of the lean spin-offs above.
