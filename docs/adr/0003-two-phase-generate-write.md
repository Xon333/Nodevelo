# ADR-0003 · Generation proposes; write commits

**Context.** A generation can fail, disappoint, or be regenerated several times. Persisting or pushing calendar events on generate would corrupt state and burn Intervals.icu writes on plans the athlete never accepted.

**Decision.** `POST /api/generate` returns a `GeneratedPlan` and persists nothing (except the season re-plan, CAS-guarded, only after success — HR-58). Acceptance is explicit: `POST /api/write` pushes calendar events (idempotent upserts, rollback on partial failure), archives the old block's lived days, records interventions, then writes `current-block.json`.

**Consequences.** Regeneration is free and safe. The write route carries the transactional complexity (snapshot → upsert → rollback-or-archive → CAS write → stale-event cleanup). Docs/tools must never assume "generate created the block."
