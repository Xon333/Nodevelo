# ADR-0007 · Append-only execution ledger with provenance stamps

**Context.** The learning loop (athlete model, calibration, interventions) is only honest if its evidence can't shift under it. If improving the scorer retro-scored history, every trend would be an artifact of the latest code.

**Decision.** `data/score-log.json` is append-only: one entry per date, frozen once the day passes, stamped with the exact inputs used (FTP, calibration values, fuel, NP fallback, form state). Scoring changes apply forward. Named invariants LEDGER-1 (a rebuild can never un-plan a frozen entry) and LEDGER-2 (append-only merge) are enforced in `score-log.ts`; the one-shot corrective rebuild is gated by `data/ledger-rebuild.json` (truthy check) and was run once, with a manual pre-rebuild snapshot kept on disk.

**Consequences.** Trends are comparable across scorer versions; "compromised" dispositions exclude entries from teaching without erasing them. Cost: schema evolution needs idempotent backfills (`sync-ledger.ts`) instead of rewrites, and old entries carry old logic's scores forever — by design.
