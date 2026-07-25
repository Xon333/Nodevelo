# ADR-0004 · Validators warn — they don't rewrite

**Context.** Post-generation checks (protocol bands, spacing, taper, week hours, sequencing, season fit) could silently "fix" the model's plan — but silent mutation destroys the athlete's ability to judge the coach, and a rewrite can be wronger than the warning.

**Decision.** All plan validators append to `warnings[]` (quality-type protocol breaches surface separately as `protocolViolations`) and never alter the schedule. Exactly two sanctioned mutations exist, both deterministic and visible: `reconcileDurationMin` (stated duration ↔ true step-sum) and `repairNutrition` (kcal rewritten to the formula's own value, recorded in `repairs`). The narrative critic may rewrite **overview prose** only, never the schedule.

**Consequences.** Bad plans surface as informed choices, not silent edits. A structurally invalid tool response is a hard 502 with manual retry — deliberately no self-repair loop for structure. New validators must follow the warn-only contract or argue an ADR change.
