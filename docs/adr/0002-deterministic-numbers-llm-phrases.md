# ADR-0002 · Deterministic numbers; the LLM only arranges and phrases

**Context.** LLMs confabulate numbers. A coach whose figures can't be trusted teaches the athlete to ignore it.

**Decision.** Every number — nutrition targets, week hours, zones, readiness, execution scores, calibration values — is computed by TypeScript engines. The model receives them as facts (the nutrition reference table it must *copy from*, the coach snapshot, exact week targets) and contributes only session arrangement and prose. Post-hoc, deterministic checks verify the model respected the numbers (`nutrition-validate` even auto-repairs the kcal figure it copied wrong).

**Consequences.** `lib/coach-snapshot.ts` exists so all LLM surfaces read *one* resolved bundle and can't disagree. Prompt builders are pure/offline-testable. The retrospective schema's own comment states the contract: "the math/validation stay in TS; the model only phrases." Cost: large prompt-assembly code and the three-copy protocol-band sync burden ([INVARIANTS #17](../reference/INVARIANTS.md)).
